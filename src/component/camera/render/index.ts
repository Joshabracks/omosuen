import { NexusT } from '../../nexus';
import { TextureMapT } from '../../texture-map';
import { TransformT } from '../../transform';
import { castTo } from '../../types';
import { ViewportT } from '../../viewport';
import { CameraT } from '../data';
import { Camera } from '../methods';
import { renderSprites } from './render-sprites';
import { renderPostProcess } from './post-process';
import { renderCellMaps, snapCameraPosition } from './render-cell-maps';

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

  // Project camera 3D world position to 2D axonometric space
  const camIsoX = transform.position.x * ISO_H - transform.position.z * ISO_H;
  const camIsoY =
    transform.position.x * sinA -
    transform.position.y * heightScale +
    transform.position.z * sinA;

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
