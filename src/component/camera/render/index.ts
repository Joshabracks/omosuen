import { NexusT } from '../../nexus';
import { TextureMapT } from '../../texture-map';
import { TransformT } from '../../transform';
import { castTo } from '../../types';
import { ViewportT } from '../../viewport';
import { AtlasManagerT } from '../../atlas-manager';
import { CameraT } from '../data';
import { Camera } from '../methods';
import { renderSprites } from './render-sprites';
import { renderUpscale } from './post-process';
import { renderPresent } from './present';
import { renderCellMaps, snapCameraPosition } from './render-cell-maps';
import { allocateCameraTargets } from './framebuffers';
import { uploadAtlasTextures, uploadAtlasDelta } from './atlas-textures';
import {
  isProfilingEnabled,
  recordComponentUpdate,
} from '../../../loop/profile';

const EMPTY_TEXTURE_MAP_CACHE: Map<string, TextureMapT> = new Map();

/**
 * Renders the scene from the camera's perspective.
 * This is called by the main render loop.
 *
 * @param camera - The camera component
 * @param deltaTime - Time elapsed since last frame in milliseconds
 */
/**
 * Scratch buffers for the per-attachment clears in `render`. Module-level so a
 * frame allocates nothing: `clearBuffer*v` takes a typed array, and building one
 * per frame in the render path is exactly the GC churn this file avoids
 * elsewhere.
 */
const clearColorScratch = new Float32Array(4);
const clearIdsScratch = new Uint32Array(4);
const clearDepthScratch = new Float32Array([1]);

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
  // Registry-backed (see component-lookup-registry.ts): viewport is in the
  // type registry's default opt-in list, and getComponentByTypeAndName
  // consults it directly against camera.viewportRef's *current* value on
  // every call -- always correct even if viewportRef is reassigned, no
  // re-resolve-on-mismatch guard needed (there's no cached key to go stale).
  const viewport = sceneRoot.getComponentByTypeAndName(
    'viewport',
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
  const { sprites, cellMaps, lights, visionSources } =
    Camera.collectRenderables(camera);

  const gl = viewport.gl;

  // Re-allocate the offscreen targets if the viewport has been resized since
  // they were last sized to it. Nothing propagates a viewport resize to a
  // camera -- Viewport.resize only updates the canvas and the GL viewport, and
  // Camera.resize() is documented as the caller's responsibility -- so without
  // this a resized-but-not-told camera renders a stale-sized FBO. Two integer
  // compares per frame, the same staleness idiom as solidityDims/atlasVersion
  // below. Must run before the FBO bind.
  if (
    camera.glResources.fullResolution.width !== viewport.width ||
    camera.glResources.fullResolution.height !== viewport.height
  ) {
    allocateCameraTargets(gl, camera, viewport);
  }

  // PHASE 1: Bind framebuffer for offscreen rendering at base resolution
  // Ensure depth texture isn't bound as a sampler on any unit before binding the FBO.
  // The FBO has this texture as its depth attachment — if it's also bound as a sampler,
  // WebGL detects a feedback loop and silently fails all draw calls.
  // This can happen from: sprite rendering (TEXTURE2), zoom resize (set/index.ts), etc.
  // TEXTURE8 is the same hazard for the FBO's id attachment, which the sprite
  // pass samples so it can carry the cell id underneath it into the composite.
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.activeTexture(gl.TEXTURE8);
  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, camera.glResources.framebuffer);

  // Set viewport to base resolution (smaller than canvas for pixel-perfect zoom)
  const baseWidth = camera.glResources.baseResolution.width;
  const baseHeight = camera.glResources.baseResolution.height;
  gl.viewport(0, 0, baseWidth, baseHeight);

  // Per-attachment clears. gl.clearColor/gl.clear cannot express this: clear
  // colour is float-typed and simply does not reach an integer attachment, and
  // COLOR_BUFFER_BIT over a mixed-format FBO leaves the integer buffer
  // undefined rather than zeroed. clearBuffer*v selects by draw-buffer index,
  // so the drawBuffers set by allocateCameraTargets has to already be in place.
  clearColorScratch[0] = viewport.backgroundColor.x;
  clearColorScratch[1] = viewport.backgroundColor.y;
  clearColorScratch[2] = viewport.backgroundColor.z;
  clearColorScratch[3] = viewport.backgroundColor.w;
  gl.clearBufferfv(gl.COLOR, 0, clearColorScratch);
  gl.clearBufferuiv(gl.COLOR, 1, clearIdsScratch);
  gl.clearBufferfv(gl.DEPTH, 0, clearDepthScratch);

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
    renderUpscale(camera, viewport, gl, subPixelOffset);
    renderPresent(camera, viewport, gl);
    return;
  }

  // Registry-backed (see component-lookup-registry.ts) -- atlas-manager is
  // ComponentUnique.GLOBAL, auto-opted into the type registry, so this is a
  // fast lookup with no per-camera caching needed: there's exactly one
  // atlas-manager to find, scene-wide, and disposeComponent() already keeps
  // the registry itself correct on disposal, so a stale reference is never
  // handed back here.
  const atlasManager = sceneRoot.getComponentByType(
    'atlas-manager',
    true,
  ) as AtlasManagerT | null;

  // textureMapsByKey is atlas-manager's own always-complete registry (kept in
  // sync unconditionally on every compile — see syncTextureMapRegistry in
  // atlas-manager/methods.ts), so it's read directly here rather than
  // maintained as a separate per-camera copy.
  const textureMapCache =
    atlasManager?.textureMapsByKey ?? EMPTY_TEXTURE_MAP_CACHE;

  // Re-upload atlas GL textures if the atlas was (re)compiled since our last
  // upload (e.g. a runtime atlasManager.processTextureMaps()). One int compare
  // per frame; uploads only when the version actually changed. Also covers a
  // camera that initialized before the atlas had compiled.
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

  // The loop's `render` phase is one opaque bucket, and the cell-map sub-
  // timings inside renderCellMaps only cover its streaming/upload work -- not
  // the draw loop, and nothing in post-process or sprites at all. Timing the
  // three stages here closes that gap, so a spike frame's `render` total can
  // be fully accounted for rather than leaving a large unattributed remainder.
  const profiling = isProfilingEnabled();
  const cameraId = camera.id ?? -1;

  // Render cell-maps FIRST (before sprites) with depth writes enabled
  // This populates the depth buffer with solid geometry
  if (cellMaps.length > 0) {
    const t0 = profiling ? performance.now() : 0;
    renderCellMaps(
      camera,
      cellMaps,
      transform,
      sceneRoot,
      gl,
      textureMapCache,
      lights,
      visionSources,
      sinA,
      heightScale,
      cosYaw,
      sinYaw,
    );
    if (profiling) {
      recordComponentUpdate(
        cameraId,
        camera.name,
        'camera:renderCellMaps',
        performance.now() - t0,
      );
    }
  }

  // PHASE 2: Upscale cells into the composite target with pixel-perfect
  // scaling, applying the cliff-edge outline. Sprites draw over this next.
  const postT0 = profiling ? performance.now() : 0;
  renderUpscale(camera, viewport, gl, subPixelOffset);
  if (profiling) {
    recordComponentUpdate(
      cameraId,
      camera.name,
      'camera:postProcess',
      performance.now() - postT0,
    );
  }

  // PHASE 3: Render sprites into the composite target at full resolution (no
  // pixelation), over the upscaled cell image.
  const spritesT0 = profiling ? performance.now() : 0;
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
      visionSources,
      subPixelOffset,
      sinA,
      heightScale,
      cosYaw,
      sinYaw,
    );
  }
  if (profiling) {
    recordComponentUpdate(
      cameraId,
      camera.name,
      'camera:renderSprites',
      performance.now() - spritesT0,
    );
  }

  // PHASE 4: Blit the finished composite to the screen.
  const presentT0 = profiling ? performance.now() : 0;
  renderPresent(camera, viewport, gl);
  if (profiling) {
    recordComponentUpdate(
      cameraId,
      camera.name,
      'camera:present',
      performance.now() - presentT0,
    );
  }
}
