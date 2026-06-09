import type { CameraT } from '../data';
import type { AtlasManagerT } from '../../atlas-manager';
import { AtlasManager } from '../../atlas-manager';

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

    const texture = gl.createTexture();
    if (!texture) {
      console.error(
        `[camera] Camera '${camera.name}' failed to create texture for atlas ${i}`,
      );
      textures[i] = null;
      continue;
    }

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    textures[i] = texture;
  }

  camera.glResources.atlasTextures = textures;
  camera.glResources.atlasVersion = atlasManager.atlasVersion;
}
