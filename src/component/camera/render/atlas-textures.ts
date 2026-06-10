import type { CameraT } from '../data';
import type { AtlasManagerT } from '../../atlas-manager';
import { AtlasManager } from '../../atlas-manager';

/**
 * Creates a new GL texture for a full atlas image (an ImageData or canvas) with
 * the atlas sampling params (NEAREST / CLAMP_TO_EDGE). Returns null on failure.
 */
function createAtlasTexture(
  gl: WebGL2RenderingContext,
  source: TexImageSource,
): WebGLTexture | null {
  const texture = gl.createTexture();
  if (!texture) return null;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

/**
 * (Re)uploads the atlas-manager's compiled atlases into the camera's GL textures
 * and records the uploaded `atlasVersion`. Existing textures are deleted first —
 * this frees GPU memory and correctly handles the atlas count shrinking on a
 * recompile. Used by camera init and by the render path when the atlas version
 * changes at runtime (so a runtime recompile actually reaches the GPU).
 *
 * Upload source depends on the atlas-manager mode:
 * - retain mode: uploaded straight from the live atlas canvases (no getImageData).
 * - release mode: from `am.atlases` ImageData; if those were auto-dropped after a
 *   prior upload, they are rebuilt on demand first (rebuild-on-demand safety net).
 */
export function uploadAtlasTextures(
  gl: WebGL2RenderingContext,
  camera: CameraT,
  atlasManager: AtlasManagerT,
): void {
  // Free any previously-uploaded textures (recompile / count shrink).
  for (const tex of camera.glResources.atlasTextures) {
    if (tex) gl.deleteTexture(tex);
  }

  const retain = atlasManager.config.retainAtlas;

  // Release mode: ensure the CPU atlas exists (it may have been auto-dropped
  // after a previous upload — rebuild it from cached sources + packed layout).
  if (!retain && atlasManager.atlases.length === 0 && atlasManager.compiled) {
    AtlasManager.rebuildAtlases(atlasManager);
  }

  const sources: (TexImageSource | null)[] = retain
    ? atlasManager.atlasCanvases
    : atlasManager.atlases;

  const textures: (WebGLTexture | null)[] = [];
  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    if (!source) {
      textures[i] = null;
      continue;
    }

    const texture = createAtlasTexture(gl, source);
    if (!texture) {
      console.error(
        `[camera] Camera '${camera.name}' failed to create texture for atlas ${i}`,
      );
    }
    textures[i] = texture;
  }

  camera.glResources.atlasTextures = textures;
  camera.glResources.atlasVersion = atlasManager.atlasVersion;
}

/**
 * Uploads only the atlas regions changed since this camera's last-uploaded
 * version (retain mode) — patching the existing GL textures in place via
 * texSubImage2D instead of re-uploading the whole atlas. The changed pixels are
 * read from the retained canvas on demand. A region on an atlas index this
 * camera hasn't allocated yet (a new atlas spawned at runtime) is uploaded in
 * full via texImage2D once.
 *
 * Caller guarantees this camera is at/after `atlasManager.fullVersion` and
 * already has textures; otherwise `uploadAtlasTextures` (full) is used instead.
 */
export function uploadAtlasDelta(
  gl: WebGL2RenderingContext,
  camera: CameraT,
  atlasManager: AtlasManagerT,
): void {
  const fromVersion = camera.glResources.atlasVersion;
  const textures = camera.glResources.atlasTextures;
  const fullyUploaded = new Set<number>();

  for (const region of atlasManager.dirtyRegions) {
    if (region.version <= fromVersion) continue;
    const { atlasIndex, x, y, w, h } = region;

    // An atlas index uploaded in full this pass (newly created) needs no
    // per-region patching for its remaining regions.
    if (fullyUploaded.has(atlasIndex)) continue;

    const canvas = atlasManager.atlasCanvases[atlasIndex];
    if (!canvas) continue;

    // New atlas spawned at runtime → allocate + upload it in full from canvas.
    if (!textures[atlasIndex]) {
      const texture = createAtlasTexture(gl, canvas);
      if (!texture) {
        console.error(
          `[camera] Camera '${camera.name}' failed to create texture for atlas ${atlasIndex}`,
        );
        continue;
      }
      textures[atlasIndex] = texture;
      fullyUploaded.add(atlasIndex);
      continue;
    }

    // Existing atlas → patch just the changed rect in place.
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    const data = ctx.getImageData(x, y, w, h);
    gl.bindTexture(gl.TEXTURE_2D, textures[atlasIndex]);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, gl.RGBA, gl.UNSIGNED_BYTE, data);
  }

  camera.glResources.atlasVersion = atlasManager.atlasVersion;
}
