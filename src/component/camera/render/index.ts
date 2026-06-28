import { NexusT } from '../../nexus';
import { TextureMapT } from '../../texture-map';
import { TransformT } from '../../transform';
import { castTo } from '../../types';
import { ViewportT } from '../../viewport';
import { AtlasManagerT } from '../../atlas-manager';
import { CameraT } from '../data';
import { Camera } from '../methods';
import { renderSprites } from './render-sprites';
import { renderPostProcess } from './post-process';
import { renderCellMaps, snapCameraPosition } from './render-cell-maps';
import { uploadAtlasTextures, uploadAtlasDelta } from './atlas-textures';

// TextureMap lookup cache — keyed by camera component ID
const TEXTURE_MAP_CACHE = new Map<number, Map<string, TextureMapT>>();
const TEXTURE_MAP_CACHE_DIRTY = new Map<number, boolean>();

export function invalidateTextureMapCache(cameraId: number): void {
  TEXTURE_MAP_CACHE_DIRTY.set(cameraId, true);
}

export function invalidateAllTextureMapCaches(): void {
  for (const key of TEXTURE_MAP_CACHE_DIRTY.keys()) {
    TEXTURE_MAP_CACHE_DIRTY.set(key, true);
  }
}

export function clearTextureMapCache(cameraId: number): void {
  TEXTURE_MAP_CACHE.delete(cameraId);
  TEXTURE_MAP_CACHE_DIRTY.delete(cameraId);
}

/**
 * Renders the scene from the camera's perspective.
 * This is called by the main render loop.
 *
 * @param camera - The camera component
 * @param deltaTime - Time elapsed since last frame in milliseconds
 */
export function render(camera: CameraT, _deltaTime: number): void {
  // Skip rendering if camera hasn't finished initializing
  // This is normal during progressive initialization
  if (!camera._initialized) {
    return;
  }

  if (!camera.parent || camera.parent.type !== 'nexus') {
    console.warn(
      `[camera] Camera '${camera.name}' has no parent nexus, cannot render`,
    );
    return;
  }

  const parentNexus = castTo<NexusT>(camera.parent!);

  // Get sibling transform for camera position
  const transform = parentNexus.getComponentByType(
    'transform',
    false,
  ) as TransformT | null;

  if (!transform) {
    console.warn(
      `[camera] Camera '${camera.name}' has no sibling transform component`,
    );
    return;
  }

  // Get viewport to render to (search from scene root, not parent)
  // Viewport is typically a sibling of the camera's parent nexus
  const sceneRoot = castTo<NexusT>(parentNexus.parent!);
  const viewport = sceneRoot.getComponentByName(
    camera.viewportRef,
    true,
  ) as ViewportT | null;

  if (!viewport || !viewport.gl) {
    console.warn(
      `[camera] Camera '${camera.name}' cannot find viewport '${camera.viewportRef}' or WebGL context`,
    );
    return;
  }

  // Collect all renderable components from the tree
  const { sprites, cellMaps, lights } = Camera.collectRenderables(camera);

  const gl = viewport.gl;

  // PHASE 1: Bind framebuffer for offscreen rendering at base resolution
  // Ensure depth texture isn't bound as a sampler on any unit before binding the FBO.
  // The FBO has this texture as its depth attachment — if it's also bound as a sampler,
  // WebGL detects a feedback loop and silently fails all draw calls.
  // This can happen from: sprite rendering (TEXTURE2), zoom resize (set/index.ts), etc.
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, camera.glResources.framebuffer);

  // Set viewport to base resolution (smaller than canvas for pixel-perfect zoom)
  const baseWidth = camera.glResources.baseResolution.width;
  const baseHeight = camera.glResources.baseResolution.height;
  gl.viewport(0, 0, baseWidth, baseHeight);

  // Clear framebuffer with depth buffer reset
  gl.clearColor(
    viewport.backgroundColor.x,
    viewport.backgroundColor.y,
    viewport.backgroundColor.z,
    viewport.backgroundColor.w,
  );
  gl.clearDepth(1.0); // Ensure depth buffer clears to far plane
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  // Compute axonometric projection parameters from camera angle
  const ISO_H = 0.8660254; // cos(30deg) — constant horizontal spread
  const clampedAngle = Math.max(0, Math.min(90, camera.axonometricAngle));
  const angleRad = (clampedAngle * Math.PI) / 180;
  const sinA = Math.sin(angleRad);
  const heightScale = Math.cos(angleRad) * 1.1547005; // cos(a)/cos(30deg)

  // Project camera 3D WORLD position (cached, composed up the ancestry) to 2D
  // axonometric space — used for the world-locked pixel snap.
  const camPos = transform.worldPosition;
  const camIsoX = camPos.x * ISO_H - camPos.z * ISO_H;
  const camIsoY = camPos.x * sinA - camPos.y * heightScale + camPos.z * sinA;

  // Compute camera snap for world-locked pixelation
  const cameraSnap = snapCameraPosition(
    camIsoX,
    camIsoY,
    camera.pixelScale,
    camera.zoom,
  );
  const subPixelOffset = {
    remainderX: cameraSnap.remainderX,
    remainderY: cameraSnap.remainderY,
  };

  // Early return if nothing to render
  if (sprites.length === 0 && cellMaps.length === 0) {
    // Still need to display the empty framebuffer
    renderPostProcess(camera, viewport, gl, subPixelOffset);
    return;
  }

  // Use cached TextureMap lookup, rebuild only when dirty or missing
  if (
    !TEXTURE_MAP_CACHE.has(camera.id!) ||
    TEXTURE_MAP_CACHE_DIRTY.get(camera.id!)
  ) {
    const allTextureMaps = sceneRoot.getComponentsByType(
      'texture-map',
      true,
    ) as TextureMapT[];
    const cache = new Map<string, TextureMapT>();
    for (const tm of allTextureMaps) {
      cache.set(tm.textureMapKey, tm);
    }
    TEXTURE_MAP_CACHE.set(camera.id!, cache);
    TEXTURE_MAP_CACHE_DIRTY.set(camera.id!, false);
  }
  const textureMapCache = TEXTURE_MAP_CACHE.get(camera.id!)!;

  // Re-upload atlas GL textures if the atlas was (re)compiled since our last
  // upload (e.g. a runtime atlasManager.processTextureMaps()). One int compare
  // per frame; uploads only when the version actually changed. Also covers a
  // camera that initialized before the atlas had compiled.
  const atlasManager = sceneRoot.getComponentByType(
    'atlas-manager',
    true,
  ) as AtlasManagerT | null;
  if (
    atlasManager &&
    atlasManager.compiled &&
    camera.glResources.atlasVersion !== atlasManager.atlasVersion
  ) {
    // Retain mode: if this camera already has textures and didn't miss a full
    // rebuild, upload just the changed regions (texSubImage2D). Otherwise
    // (release mode, first upload, or a missed full recompile) full-upload.
    if (
      atlasManager.config.retainAtlas &&
      camera.glResources.atlasVersion >= atlasManager.fullVersion &&
      camera.glResources.atlasTextures.length > 0
    ) {
      uploadAtlasDelta(gl, camera, atlasManager);
    } else {
      uploadAtlasTextures(gl, camera, atlasManager);
    }
  }

  // Release mode (default): once this camera is caught up to the current atlas
  // version, schedule a one-shot drop of the CPU-side atlas ImageData to free
  // memory. Coalesced via _releaseScheduled + deferred with requestAnimationFrame
  // so it runs ONCE after the current frame's renders (all cameras that rendered
  // this frame have uploaded by then); late/new cameras and getAtlas fall back to
  // rebuild-on-demand. Captures the version so a recompile mid-wait isn't dropped.
  if (
    atlasManager &&
    !atlasManager.config.retainAtlas &&
    atlasManager.compiled &&
    atlasManager.atlases.length > 0 &&
    camera.glResources.atlasVersion === atlasManager.atlasVersion &&
    !atlasManager._releaseScheduled &&
    typeof requestAnimationFrame === 'function'
  ) {
    atlasManager._releaseScheduled = true;
    const releasedVersion = atlasManager.atlasVersion;
    requestAnimationFrame(() => {
      if (
        !atlasManager.config.retainAtlas &&
        atlasManager.atlasVersion === releasedVersion
      ) {
        atlasManager.atlases = [];
      }
      atlasManager._releaseScheduled = false;
    });
  }

  // Render cell-maps FIRST (before sprites) with depth writes enabled
  // This populates the depth buffer with solid geometry
  if (cellMaps.length > 0) {
    renderCellMaps(
      camera,
      cellMaps,
      transform,
      sceneRoot,
      gl,
      textureMapCache,
      lights,
      sinA,
      heightScale,
    );
  }

  // PHASE 2: Post-process cells to screen with pixel-perfect upscaling
  renderPostProcess(camera, viewport, gl, subPixelOffset);

  // PHASE 3: Render sprites directly to screen at full resolution (no pixelation)
  if (sprites.length > 0) {
    renderSprites(
      camera,
      viewport,
      sprites,
      cellMaps,
      transform,
      sceneRoot,
      gl,
      textureMapCache,
      lights,
      subPixelOffset,
      sinA,
      heightScale,
    );
  }
}
