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

// AtlasManager lookup cache — keyed by camera component ID, same shape as
// TEXTURE_MAP_CACHE above. Unlike texture-maps, this needs no dirty flag:
// atlas-manager is ComponentUnique.GLOBAL (at most one per scene), so once
// resolved the reference is reused indefinitely. The only way it goes stale
// is disposal -- a scene switch (which disposes the whole old tree) or a
// developer forcing re-init by adding a fresh atlas-manager (GLOBAL
// uniqueness auto-disposes the old one first) -- so staleness is caught by
// checking `_disposed` at read time instead of needing an explicit
// invalidate call from anywhere.
const ATLAS_MANAGER_CACHE = new Map<number, AtlasManagerT>();

export function clearAtlasManagerCache(cameraId: number): void {
  ATLAS_MANAGER_CACHE.delete(cameraId);
}

// Viewport lookup cache — keyed by camera component ID, storing the resolved
// viewport plus the viewportRef key it was resolved for. camera.viewportRef
// is a PROPERTY_ALLOWLIST-exposed, genuinely writable field (camera/data.ts)
// even though nothing in-repo ever reassigns it today, so this isn't a
// resolve-once-forever cache like ATLAS_MANAGER_CACHE above -- each call
// compares the cached key against the camera's *current* viewportRef and
// only re-resolves on mismatch. A miss (no matching viewport) is never
// cached, matching ATLAS_MANAGER_CACHE's behavior, so a camera whose
// viewport hasn't been added to the scene yet keeps retrying instead of
// latching onto a stale null.
const VIEWPORT_CACHE = new Map<
  number,
  { viewportRef: string; viewport: ViewportT }
>();

export function clearViewportCache(cameraId: number): void {
  VIEWPORT_CACHE.delete(cameraId);
}

/**
 * Resolves camera.viewportRef to a ViewportT, cached per camera id with a
 * re-resolve-on-mismatch guard. Shared by every call site that needs a
 * camera's viewport: render's per-frame hot path, plus init/set/dispose's
 * once-per-lifecycle or user-triggered lookups.
 *
 * @param camera - The camera whose viewport to resolve
 * @param sceneRoot - The nexus to search from (caller-computed, since the
 *   exact parent-chain walk differs slightly by call site)
 */
export function resolveViewportCached(
  camera: CameraT,
  sceneRoot: NexusT,
): ViewportT | null {
  const cached = VIEWPORT_CACHE.get(camera.id!);
  if (cached && cached.viewportRef === camera.viewportRef) {
    return cached.viewport;
  }
  const viewport = sceneRoot.getComponentByName(
    camera.viewportRef,
    true,
  ) as ViewportT | null;
  if (viewport) {
    VIEWPORT_CACHE.set(camera.id!, {
      viewportRef: camera.viewportRef,
      viewport,
    });
  } else {
    VIEWPORT_CACHE.delete(camera.id!);
  }
  return viewport;
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
  const viewport = resolveViewportCached(camera, sceneRoot);

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

  // Compute axonometric projection parameters from camera angle + orbit yaw
  // (matches screen-pick/ray.ts's resolveProjection).
  const ISO_H = 0.8660254; // cos(30deg) — constant horizontal spread
  const clampedAngle = Math.max(0, Math.min(90, camera.axonometricAngle));
  const angleRad = (clampedAngle * Math.PI) / 180;
  const sinA = Math.sin(angleRad);
  const heightScale = Math.cos(angleRad) * 1.1547005; // cos(a)/cos(30deg)
  const yawRad = (camera.orbitYaw * Math.PI) / 180;
  const cosYaw = Math.cos(yawRad);
  const sinYaw = Math.sin(yawRad);

  // Project camera 3D WORLD position (cached, composed up the ancestry) to 2D
  // axonometric space — used for the world-locked pixel snap.
  const camPos = transform.worldPosition;
  const camRx = camPos.x * cosYaw + camPos.z * sinYaw;
  const camRz = -camPos.x * sinYaw + camPos.z * cosYaw;
  const camIsoX = camRx * ISO_H - camRz * ISO_H;
  const camIsoY = camRx * sinA - camPos.y * heightScale + camRz * sinA;

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
  //
  // Resolved once per camera and reused (see ATLAS_MANAGER_CACHE above) --
  // re-resolved only if the cached reference was disposed, or if nothing's
  // cached yet (e.g. no atlas-manager exists yet during early scene setup).
  let atlasManager: AtlasManagerT | null =
    ATLAS_MANAGER_CACHE.get(camera.id!) ?? null;
  if (!atlasManager || atlasManager._disposed) {
    atlasManager = sceneRoot.getComponentByType(
      'atlas-manager',
      true,
    ) as AtlasManagerT | null;
    if (atlasManager) {
      ATLAS_MANAGER_CACHE.set(camera.id!, atlasManager);
    } else {
      ATLAS_MANAGER_CACHE.delete(camera.id!);
    }
  }
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
      cosYaw,
      sinYaw,
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
      cosYaw,
      sinYaw,
    );
  }
}
