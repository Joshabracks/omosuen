import { AtlasManagerT } from '../../atlas-manager';
import { CellMapT, CellMap, rebuildDirtyChunks } from '../../cell-map';
import { LightT } from '../../light';
import { NexusT } from '../../nexus';
import { TextureMapT } from '../../texture-map';
import { TransformT } from '../../transform';
import { CameraT } from '../data';
import {
  setAngleUniform,
  setOrbitYawUniform,
  setLightUniforms,
} from './light-uniforms';
import { computeSolidityMap } from './visibility-mask';
import {
  isProfilingEnabled,
  recordComponentUpdate,
} from '../../../loop/profile';

/** A resolved atlas frame: normalized UV bounds, pixel size, and atlas page. */
interface ResolvedFrame {
  bounds: [number, number, number, number];
  size: [number, number];
  atlasIndex: number;
}

/** Warn-once guard for per-side frames that resolve to a different atlas page. */
let warnedCrossAtlasFrame = false;

/** cos(30deg) — constant horizontal spread of the axonometric projection (see unified.vert). */
const ISO_H = 0.8660254;

/**
 * Snaps camera position to FBO pixel boundaries so the pixel grid
 * is locked to world space instead of screen space during panning.
 */
export function snapCameraPosition(
  camX: number,
  camY: number,
  pixelScale: number,
  zoom: number,
): { x: number; y: number; remainderX: number; remainderY: number } {
  if (pixelScale <= 1)
    return { x: camX, y: camY, remainderX: 0, remainderY: 0 };
  const snapSize = pixelScale / zoom;
  const snappedX = Math.floor(camX / snapSize) * snapSize;
  const snappedY = Math.floor(camY / snapSize) * snapSize;
  return {
    x: snappedX,
    y: snappedY,
    remainderX: camX - snappedX,
    remainderY: camY - snappedY,
  };
}

type Vec3 = { x: number; y: number; z: number };

/** Axis-aligned min/max box in world space. */
interface WorldAABB {
  min: Vec3;
  max: Vec3;
}

/** World chunk-coordinate range that could intersect the volume, calculated directly from its AABB -- not scanned from what's resident. */
function chunkCandidateRange(
  aabb: WorldAABB,
  chunkSize: Vec3,
  cellSize: Vec3,
): {
  minCx: number;
  maxCx: number;
  minCy: number;
  maxCy: number;
  minCz: number;
  maxCz: number;
} {
  return {
    minCx: Math.floor(aabb.min.x / (chunkSize.x * cellSize.x)),
    maxCx: Math.floor(aabb.max.x / (chunkSize.x * cellSize.x)),
    minCy: Math.floor(aabb.min.y / (chunkSize.y * cellSize.y)),
    maxCy: Math.floor(aabb.max.y / (chunkSize.y * cellSize.y)),
    minCz: Math.floor(aabb.min.z / (chunkSize.z * cellSize.z)),
    maxCz: Math.floor(aabb.max.z / (chunkSize.z * cellSize.z)),
  };
}

/**
 * True if a chunk's world-space box (`min`/`max`) has no overlap with the
 * render volume -- a trivial separating-axis reject on each of the three
 * world axes (the volume is a plain axis-aligned box, so this replaces what
 * used to be a full oriented-frustum plane test).
 */
function aabbOutsideVolume(min: Vec3, max: Vec3, volume: WorldAABB): boolean {
  return (
    max.x < volume.min.x ||
    min.x > volume.max.x ||
    max.y < volume.min.y ||
    min.y > volume.max.y ||
    max.z < volume.min.z ||
    min.z > volume.max.z
  );
}

/**
 * Residency (window sizing) target, in chunks -- necessarily axis-aligned
 * (CellWindow's grid has no rotation concept), which now matches the render
 * volume's own shape exactly: the volume is already a world-space box
 * centered on the camera, so each axis's chunk radius is just that axis's
 * half-extent converted from world units to chunks.
 */
function worldHalfExtentToChunkRadius(
  halfExtent: Vec3,
  chunkSize: Vec3,
  cellSize: Vec3,
): Vec3 {
  return {
    x: Math.max(1, Math.ceil(halfExtent.x / (chunkSize.x * cellSize.x))),
    y: Math.max(1, Math.ceil(halfExtent.y / (chunkSize.y * cellSize.y))),
    z: Math.max(1, Math.ceil(halfExtent.z / (chunkSize.z * cellSize.z))),
  };
}

let cachedMaxTextureSize: number | null = null;

/** `gl.MAX_TEXTURE_SIZE` never changes for a given context -- query once, cache it. */
function getMaxTextureSize(gl: WebGL2RenderingContext): number {
  if (cachedMaxTextureSize === null) {
    cachedMaxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  }
  return cachedMaxTextureSize;
}

let cachedMaxArrayTextureLayers: number | null = null;

/** `gl.MAX_ARRAY_TEXTURE_LAYERS` never changes for a given context -- query once, cache it. */
function getMaxArrayTextureLayers(gl: WebGL2RenderingContext): number {
  if (cachedMaxArrayTextureLayers === null) {
    cachedMaxArrayTextureLayers = gl.getParameter(
      gl.MAX_ARRAY_TEXTURE_LAYERS,
    ) as number;
  }
  return cachedMaxArrayTextureLayers;
}

/** Warn-once guard for `clampRadiusToTextureLimit` actually binding. */
let warnedTextureClamp = false;

/**
 * `uploadVisibilityTexture`/`uploadCellEmissionColorTexture` (below) pack the
 * window's 3D data into a `TEXTURE_2D_ARRAY` (width=windowSize.x,
 * height=windowSize.y, depth/layers=windowSize.z) -- each axis has its own
 * independent GPU limit (X/Y against `gl.MAX_TEXTURE_SIZE`, Z against
 * `gl.MAX_ARRAY_TEXTURE_LAYERS`), unlike the old 2D-packed layout where Y and
 * Z shared one multiplicative budget. A failed `texImage3D` call leaves the
 * OLD, smaller texture content in place while the shader samples it against
 * the NEW, larger window uniforms -- corrupting reveal/occlusion rendering
 * across most of the map. Must be clamped before a resize is ever applied,
 * not just before upload.
 */
function clampRadiusToTextureLimit(
  radius: { x: number; y: number; z: number },
  chunkSize: { x: number; y: number; z: number },
  maxTextureSize: number,
  maxArrayLayers: number,
): { x: number; y: number; z: number } {
  let rx = radius.x;
  let ry = radius.y;
  let rz = radius.z;
  while ((2 * rx + 1) * chunkSize.x > maxTextureSize && rx > 0) rx--;
  while ((2 * ry + 1) * chunkSize.y > maxTextureSize && ry > 0) ry--;
  while ((2 * rz + 1) * chunkSize.z > maxArrayLayers && rz > 0) rz--;
  return { x: rx, y: ry, z: rz };
}

/**
 * Settle-debounce state for `autoResizeFromZoom`, keyed per cell-map. A
 * `WeakMap` so it never leaks if a cell-map is disposed.
 */
const pendingResize = new WeakMap<
  CellMapT,
  { radius: { x: number; y: number; z: number }; stableFrames: number }
>();
/** ~160ms at 60fps. See the "accepted tradeoff" note where this is used. */
const RESIZE_SETTLE_FRAMES = 10;

/**
 * Extra chunk-radius requested on X/Z (not Y) beyond what the render volume
 * itself needs, so a ring of terrain just outside the visible cull volume is
 * already generated (meshed + GPU-uploaded) before the camera reaches it.
 * The cull test (`aabbOutsideVolume`) is unchanged, so this buffer ring is
 * resident but not drawn until the camera actually reaches it.
 */
const CHUNK_GENERATION_BUFFER = 1;

/**
 * `computeVisibleWindowRadius`'s target is continuous (zoom/tilt/yaw all feed
 * it) and can cross several integer chunk-radius boundaries in a single zoom
 * gesture, since zoom decays smoothly frame-to-frame rather than jumping.
 * Applying every intermediate value would fire a full, expensive resize
 * (WASM store dump/reload + full remesh) per boundary crossed. Instead, only
 * report "apply this" once `target` has been identical for
 * `RESIZE_SETTLE_FRAMES` consecutive frames, coalescing an entire gesture
 * into at most one real resize, right after motion settles. Tradeoff: the
 * window can lag the true needed size by up to ~160ms during fast zooming,
 * meaning the edge could be transiently visible for a moment — standard,
 * expected pop-in for a windowed/streamed world, traded deliberately against
 * resizing on every single frame of a zoom animation.
 */
function shouldApplyResize(
  cellMap: CellMapT,
  target: { x: number; y: number; z: number },
): boolean {
  const pending = pendingResize.get(cellMap);
  const same =
    pending &&
    pending.radius.x === target.x &&
    pending.radius.y === target.y &&
    pending.radius.z === target.z;
  if (same) {
    pending.stableFrames++;
  } else {
    pendingResize.set(cellMap, { radius: { ...target }, stableFrames: 1 });
  }
  return (
    (pendingResize.get(cellMap)?.stableFrames ?? 0) >= RESIZE_SETTLE_FRAMES
  );
}

/**
 * Uploads a per-cell visibility mask as a `TEXTURE_2D_ARRAY` R8 texture,
 * sized to whatever's currently resident in the canonical store (today: the
 * whole map; once the shiftable hot window lands, the window).
 * Texture layout: width = windowX, height = windowY, layers = windowZ.
 * Layer z, texel (x, y) → cell (x, y, z), in window-local coordinates. This
 * is exactly the WASM solidity buffer's own layout (z-outermost, then y,
 * then x -- see `computeSolidityMap`), so the buffer uploads directly with
 * no JS-side repacking.
 */
function uploadVisibilityTexture(
  gl: WebGL2RenderingContext,
  camera: CameraT,
  mask: Uint8Array,
  windowSize: { x: number; y: number; z: number },
): void {
  if (!camera.glResources.visibilityTexture) {
    camera.glResources.visibilityTexture = gl.createTexture();
  }

  gl.activeTexture(gl.TEXTURE3);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, camera.glResources.visibilityTexture);
  // The R8 mask is tightly packed; default UNPACK_ALIGNMENT (4) would expect each
  // row padded to a multiple of 4 bytes and reject maps whose width isn't a multiple
  // of 4 ("ArrayBufferView not big enough"). Force tight row packing.
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage3D(
    gl.TEXTURE_2D_ARRAY,
    0,
    gl.R8,
    windowSize.x,
    windowSize.y,
    windowSize.z,
    0,
    gl.RED,
    gl.UNSIGNED_BYTE,
    mask,
  );
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
}

/**
 * Builds the RGBA8 per-cell emission-color texture data from a cell-map's
 * `emissionColorMap` (packed (r<<16)|(g<<8)|b), flattened `x` + `y·mapX` +
 * `z·mapX·mapY` — the same order the fragment shader unflattens in
 * `cellEmissionColorAt`. Returns the byte buffer and whether any cell is non-black
 * (so an all-black map skips upload + shader term entirely).
 */
function buildCellEmissionColorBytes(cellMap: CellMapT): {
  bytes: Uint8Array;
  hasAny: boolean;
} {
  const packed = cellMap.emissionColorMap.value;
  const bytes = new Uint8Array(packed.length * 4);
  let hasAny = false;
  for (let i = 0; i < packed.length; i++) {
    const p = packed[i] | 0;
    if (p !== 0) hasAny = true;
    bytes[i * 4] = (p >> 16) & 0xff;
    bytes[i * 4 + 1] = (p >> 8) & 0xff;
    bytes[i * 4 + 2] = p & 0xff;
    bytes[i * 4 + 3] = 255;
  }
  return { bytes, hasAny };
}

function uploadCellEmissionColorTexture(
  gl: WebGL2RenderingContext,
  camera: CameraT,
  bytes: Uint8Array,
  windowSize: { x: number; y: number; z: number },
): void {
  if (!camera.glResources.cellEmissionColorTexture) {
    camera.glResources.cellEmissionColorTexture = gl.createTexture();
  }
  // Unit 6 -- deliberately not 4, which the sprite draw path (render-sprites.ts)
  // uses for its own u_emissionTexture (sampler2D). Uniform values persist across
  // draw calls, so sharing a unit with a differently-typed sampler elsewhere in this
  // program throws GL_INVALID_OPERATION ("two textures of different types use the
  // same sampler location") the moment both uniforms have been set at least once.
  gl.activeTexture(gl.TEXTURE6);
  gl.bindTexture(
    gl.TEXTURE_2D_ARRAY,
    camera.glResources.cellEmissionColorTexture,
  );
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage3D(
    gl.TEXTURE_2D_ARRAY,
    0,
    gl.RGBA8,
    windowSize.x,
    windowSize.y,
    windowSize.z,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    bytes,
  );
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
}

/**
 * Renders all cell-maps using chunk-based batched rendering.
 * Each chunk has a pre-built mesh with hidden face culling and greedy meshing applied.
 * Indices are grouped by material for efficient multi-material draw calls.
 */
export function renderCellMaps(
  camera: CameraT,
  cellMaps: CellMapT[],
  cameraTransform: TransformT,
  sceneRoot: NexusT,
  gl: WebGL2RenderingContext,
  textureMapCache: Map<string, TextureMapT>,
  lights: LightT[],
  sinA: number,
  heightScale: number,
  cosYaw: number,
  sinYaw: number,
): void {
  const program = camera.glResources.unifiedProgram;
  if (!program) {
    console.warn('[camera] Unified shader program not initialized');
    return;
  }

  // Enable depth testing for 3D rendering with depth writes enabled
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LESS);
  gl.depthMask(true);

  // Enable backface culling
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);

  gl.useProgram(program);

  // Set render mode to 0 (cells)
  if (camera.glResources.renderModeLocation) {
    gl.uniform1i(camera.glResources.renderModeLocation, 0);
  }

  // Get attribute locations
  const aPosition = gl.getAttribLocation(program, 'a_position');
  const aNormal = gl.getAttribLocation(program, 'a_normal');
  const aUv = gl.getAttribLocation(program, 'a_uv');
  const aOrigPosition = gl.getAttribLocation(program, 'a_origPosition');
  const aEmission = gl.getAttribLocation(program, 'a_emission');

  // Get uniform locations
  const uViewportSize = gl.getUniformLocation(program, 'u_viewportSize');
  const uCameraPosition = gl.getUniformLocation(program, 'u_cameraPosition');
  const uZoom = gl.getUniformLocation(program, 'u_zoom');
  const uCellSize = gl.getUniformLocation(program, 'u_cellSize');
  // Size/origin of the currently-resident cell-map window. Used by the
  // fragment shader's reveal/occlusion sampling (u_windowSize/u_windowOrigin,
  // in cell units) and by the vertex shader's position offset + depth-bias
  // recentering (u_windowSize/u_worldOffset, in world/continuous units).
  // u_windowSize (cell units) is shared between both stages; u_windowOrigin
  // (cell units) and u_worldOffset (world units, cellSize-scaled) are
  // deliberately separate uniforms with different units — do not conflate
  // them.
  const uWindowSize = gl.getUniformLocation(program, 'u_windowSize');
  const uWindowOrigin = gl.getUniformLocation(program, 'u_windowOrigin');
  const uWorldOffset = gl.getUniformLocation(program, 'u_worldOffset');
  const uAlbedoTexture = gl.getUniformLocation(program, 'u_albedoTexture');
  const uNormalTexture = gl.getUniformLocation(program, 'u_normalTexture');
  const uHasNormal = gl.getUniformLocation(program, 'u_hasNormal');

  // Per-side (per-triplanar-plane) frame uniforms.
  // Plane <-> visible side: YZ = +X (south-east), XZ = +Y (up), XY = +Z (south-west)
  const uAlbedoBoundsYZ = gl.getUniformLocation(program, 'u_albedoBoundsYZ');
  const uAlbedoBoundsXZ = gl.getUniformLocation(program, 'u_albedoBoundsXZ');
  const uAlbedoBoundsXY = gl.getUniformLocation(program, 'u_albedoBoundsXY');
  const uAlbedoSizeYZ = gl.getUniformLocation(program, 'u_albedoSizeYZ');
  const uAlbedoSizeXZ = gl.getUniformLocation(program, 'u_albedoSizeXZ');
  const uAlbedoSizeXY = gl.getUniformLocation(program, 'u_albedoSizeXY');
  const uNormalBoundsYZ = gl.getUniformLocation(program, 'u_normalBoundsYZ');
  const uNormalBoundsXZ = gl.getUniformLocation(program, 'u_normalBoundsXZ');
  const uNormalBoundsXY = gl.getUniformLocation(program, 'u_normalBoundsXY');
  const uNormalSizeYZ = gl.getUniformLocation(program, 'u_normalSizeYZ');
  const uNormalSizeXZ = gl.getUniformLocation(program, 'u_normalSizeXZ');
  const uNormalSizeXY = gl.getUniformLocation(program, 'u_normalSizeXY');

  // Per-material emissive texture (Part B) — same per-side layout as albedo/normal.
  const uEmissionTexture = gl.getUniformLocation(program, 'u_emissionTexture');
  const uHasEmissionTexture = gl.getUniformLocation(
    program,
    'u_hasEmissionTexture',
  );
  const uEmissionBoundsYZ = gl.getUniformLocation(
    program,
    'u_emissionBoundsYZ',
  );
  const uEmissionBoundsXZ = gl.getUniformLocation(
    program,
    'u_emissionBoundsXZ',
  );
  const uEmissionBoundsXY = gl.getUniformLocation(
    program,
    'u_emissionBoundsXY',
  );
  const uEmissionSizeYZ = gl.getUniformLocation(program, 'u_emissionSizeYZ');
  const uEmissionSizeXZ = gl.getUniformLocation(program, 'u_emissionSizeXZ');
  const uEmissionSizeXY = gl.getUniformLocation(program, 'u_emissionSizeXY');

  // Per-cell emission (highlight) color texture (Part A).
  const uHasCellEmissionColor = gl.getUniformLocation(
    program,
    'u_hasCellEmissionColor',
  );
  const uCellEmissionColor = gl.getUniformLocation(
    program,
    'u_cellEmissionColor',
  );

  // UV-mode uniforms: when a draw range carries mesh UVs, sample the material's
  // base frame by v_uv instead of triplanar.
  const uUseMeshUV = gl.getUniformLocation(program, 'u_useMeshUV');
  const uAlbedoBoundsBase = gl.getUniformLocation(
    program,
    'u_albedoBoundsBase',
  );
  const uNormalBoundsBase = gl.getUniformLocation(
    program,
    'u_normalBoundsBase',
  );

  // Per-fragment raycasting uniform locations
  const uHasVisibilityMask = gl.getUniformLocation(
    program,
    'u_hasVisibilityMask',
  );
  const uCellSolidity = gl.getUniformLocation(program, 'u_cellSolidity');
  const uRevealTarget = gl.getUniformLocation(program, 'u_revealTarget');

  // Depth-cue uniform locations (AO / cast shadow / height ramp; outline is post-process)
  const uAoWeight = gl.getUniformLocation(program, 'u_aoWeight');
  const uAoRadius = gl.getUniformLocation(program, 'u_aoRadius');
  const uAoScatter = gl.getUniformLocation(program, 'u_aoScatter');
  const uScatterType = gl.getUniformLocation(program, 'u_scatterType');
  const uShadowWeight = gl.getUniformLocation(program, 'u_shadowWeight');
  const uShadowDistance = gl.getUniformLocation(program, 'u_shadowDistance');
  const uShadowScatter = gl.getUniformLocation(program, 'u_shadowScatter');
  const uHeightRampWeight = gl.getUniformLocation(
    program,
    'u_heightRampWeight',
  );
  const uHeightRampMinY = gl.getUniformLocation(program, 'u_heightRampMinY');
  const uHeightRampMaxY = gl.getUniformLocation(program, 'u_heightRampMaxY');
  const uHeightRampLow = gl.getUniformLocation(program, 'u_heightRampLow');
  const uHeightRampHigh = gl.getUniformLocation(program, 'u_heightRampHigh');

  // Set constant uniforms
  const logicalWidth =
    camera.glResources.baseResolution.width * camera.pixelScale;
  const logicalHeight =
    camera.glResources.baseResolution.height * camera.pixelScale;
  gl.uniform2f(uViewportSize, logicalWidth, logicalHeight);

  // Project camera 3D WORLD position (cached, composed up the ancestry) to 2D
  // axonometric space — same projection the vertex shader applies to every vertex.
  const camPos = cameraTransform.worldPosition;
  const camRx = camPos.x * cosYaw + camPos.z * sinYaw;
  const camRz = -camPos.x * sinYaw + camPos.z * cosYaw;
  const camIsoX = camRx * ISO_H - camRz * ISO_H;
  const camIsoY = camRx * sinA - camPos.y * heightScale + camRz * sinA;

  const snapped = snapCameraPosition(
    camIsoX,
    camIsoY,
    camera.pixelScale,
    camera.zoom,
  );
  gl.uniform2f(uCameraPosition, snapped.x, snapped.y);
  gl.uniform1f(uZoom, camera.zoom);

  // Set dynamic light uniforms
  setLightUniforms(gl, camera.id!, lights);

  // Set axonometric angle + orbit yaw uniforms (GPU computes cos/sin)
  setAngleUniform(gl, camera.id!, camera.axonometricAngle);
  setOrbitYawUniform(gl, camera.id!, camera.orbitYaw);

  // Depth-cue uniforms (AO / cast shadow / height ramp). null = all weights 0 (off).
  const dc = camera.depthCues;
  // Scatter style shared by AO + shadow: dither=0, soft-grain=1, smooth-fade=2, retro-dither=3.
  const scatterTypeIndex = dc
    ? { dither: 0, 'soft-grain': 1, 'smooth-fade': 2, 'retro-dither': 3 }[
        dc.scatterType
      ]
    : 0;
  gl.uniform1i(uScatterType, scatterTypeIndex);
  gl.uniform1f(uAoWeight, dc ? dc.ao.weight : 0);
  gl.uniform1f(uAoRadius, dc ? dc.ao.radius : 1);
  gl.uniform1f(uAoScatter, dc ? dc.ao.scatter : 0);
  gl.uniform1f(uShadowWeight, dc ? dc.shadow.weight : 0);
  gl.uniform1f(uShadowDistance, dc ? dc.shadow.distance : 24);
  gl.uniform1f(uShadowScatter, dc ? dc.shadow.scatter : 0);
  gl.uniform1f(uHeightRampWeight, dc ? dc.heightRamp.weight : 0);
  gl.uniform1f(uHeightRampMinY, dc ? dc.heightRamp.minY : 0);
  gl.uniform1f(uHeightRampMaxY, dc ? dc.heightRamp.maxY : 1);
  if (dc) {
    gl.uniform3f(
      uHeightRampLow,
      dc.heightRamp.lowColor.x,
      dc.heightRamp.lowColor.y,
      dc.heightRamp.lowColor.z,
    );
    gl.uniform3f(
      uHeightRampHigh,
      dc.heightRamp.highColor.x,
      dc.heightRamp.highColor.y,
      dc.heightRamp.highColor.z,
    );
  } else {
    gl.uniform3f(uHeightRampLow, 1, 1, 1);
    gl.uniform3f(uHeightRampHigh, 1, 1, 1);
  }

  // Disable the UV attribute for chunk rendering (triplanar mapping doesn't use it)
  if (aUv >= 0) {
    gl.disableVertexAttribArray(aUv);
    gl.vertexAttrib2f(aUv, 0, 0);
  }

  // Get atlas manager for texture size
  const atlasManager = sceneRoot.getComponentByType(
    'atlas-manager',
    true,
  ) as AtlasManagerT | null;
  const atlasSize = atlasManager?.config.atlasSize ?? 1024;

  // Resolve a frame's atlas bounds + pixel size from a TextureMap.
  const frameBounds = (
    textureMap: TextureMapT | undefined,
    frameIndex: number,
  ): ResolvedFrame | null => {
    if (!textureMap) return null;
    const frame = textureMap.frameIndexMap.get(frameIndex);
    if (!frame) return null;
    const minU = frame.atlasPosition.x / atlasSize;
    const minV = frame.atlasPosition.y / atlasSize;
    const maxU = (frame.atlasPosition.x + frame.size.x) / atlasSize;
    const maxV = (frame.atlasPosition.y + frame.size.y) / atlasSize;
    return {
      bounds: [minU, minV, maxU, maxV],
      size: [frame.size.x, frame.size.y],
      atlasIndex: frame.atlasIndex,
    };
  };

  // Resolve the frame for one triplanar plane: a side override when present,
  // otherwise the material's base frame. Side frames must live in the same atlas
  // page as the base (single texture bind); a cross-atlas frame falls back to base.
  const resolvePlane = (
    textureMap: TextureMapT,
    sideFrameIndex: number | undefined,
    base: ResolvedFrame,
  ): ResolvedFrame => {
    if (sideFrameIndex === undefined) return base;
    const fb = frameBounds(textureMap, sideFrameIndex);
    if (!fb) return base;
    if (fb.atlasIndex !== base.atlasIndex) {
      if (!warnedCrossAtlasFrame) {
        warnedCrossAtlasFrame = true;
        console.warn(
          '[camera] per-side frame is in a different atlas page than the base ' +
            'frame; falling back to the base frame for that side.',
        );
      }
      return base;
    }
    return fb;
  };

  const profiling = isProfilingEnabled();

  // Render each cell-map
  for (const cellMap of cellMaps) {
    let gpuUploadMs = 0;
    // Build this frame's render/cull volume in world space: a plain
    // axis-aligned box centered on the camera, with independent half-extents
    // per world axis (halfIsoX/halfIsoY/halfIsoZ). This is deliberately NOT
    // oriented by the camera's view direction, tilt, or yaw -- the volume is
    // the same shape and size no matter how the camera is rotated. Most maps
    // want a fixed horizontal square footprint plus a vertical extent tuned
    // to the world's height, not a shape that changes as the camera orbits.
    // Each half-extent is driven the same way -- a chunk-derived base
    // (renderDistance) plus a raw world-unit additive pad (frustumPadding),
    // axis-for-axis (x->halfIsoX, y->halfIsoY, z->halfIsoZ). Deliberately NOT
    // derived from logicalWidth/logicalHeight/camera.zoom at all: this is an
    // intentional, developer-controlled render distance, not an attempt to
    // exactly match the viewport. This AABB is used both to size window
    // residency below, and to derive the direct chunk-coordinate candidate
    // range in the draw loop further down.
    const renderDistanceWorld = {
      x: cellMap.renderDistance.x * cellMap.chunkSize.x * cellMap.cellSize.x,
      y: cellMap.renderDistance.y * cellMap.chunkSize.y * cellMap.cellSize.y,
      z: cellMap.renderDistance.z * cellMap.chunkSize.z * cellMap.cellSize.z,
    };
    const halfIsoX = renderDistanceWorld.x + cellMap.frustumPadding.x;
    const halfIsoY = renderDistanceWorld.y + cellMap.frustumPadding.y;
    const halfIsoZ = renderDistanceWorld.z + cellMap.frustumPadding.z;
    const volumeAABB: WorldAABB = {
      min: {
        x: camPos.x - halfIsoX,
        y: camPos.y - halfIsoY,
        z: camPos.z - halfIsoZ,
      },
      max: {
        x: camPos.x + halfIsoX,
        y: camPos.y + halfIsoY,
        z: camPos.z + halfIsoZ,
      },
    };

    // Drive the window's radius from the render volume by default (runtime
    // window resizing) -- before focus/dirty-chunk rebuilding, since a
    // resize replaces the chunk array (reassembled -- only genuinely new
    // chunks are marked dirty, see CellMap.setWindowRadius). Clamped to
    // maxTerrainLoadDimensions inside CellMap.setWindowRadius itself.
    if (cellMap.autoResizeFromZoom) {
      const renderVolumeRadius = worldHalfExtentToChunkRadius(
        { x: halfIsoX, y: halfIsoY, z: halfIsoZ },
        cellMap.chunkSize,
        cellMap.cellSize,
      );
      // Request a chunk-generation buffer beyond the render volume on X/Z --
      // see CHUNK_GENERATION_BUFFER. Applied before the texture-size clamp,
      // which remains the final authority on what the GPU can actually hold.
      const rawTargetRadius = {
        x: renderVolumeRadius.x + CHUNK_GENERATION_BUFFER,
        y: renderVolumeRadius.y,
        z: renderVolumeRadius.z + CHUNK_GENERATION_BUFFER,
      };
      const maxTextureSize = getMaxTextureSize(gl);
      const maxArrayLayers = getMaxArrayTextureLayers(gl);
      const targetRadius = clampRadiusToTextureLimit(
        rawTargetRadius,
        cellMap.chunkSize,
        maxTextureSize,
        maxArrayLayers,
      );
      if (
        !warnedTextureClamp &&
        (targetRadius.x !== rawTargetRadius.x ||
          targetRadius.y !== rawTargetRadius.y ||
          targetRadius.z !== rawTargetRadius.z)
      ) {
        warnedTextureClamp = true;
        console.warn(
          "[camera] cell-map window radius clamped to stay within this GPU's " +
            `MAX_TEXTURE_SIZE (${maxTextureSize}, applied per-axis to X/Y) or ` +
            `MAX_ARRAY_TEXTURE_LAYERS (${maxArrayLayers}, applied to Z); ` +
            'consider a smaller chunkSize or accepting a smaller maxTerrainLoadDimensions.',
        );
      }
      if (shouldApplyResize(cellMap, targetRadius)) {
        CellMap.setWindowRadius(cellMap, targetRadius);
      }
    }

    // Drive the window's focus from the camera by default -- before
    // rebuilding dirty chunks, since a shift marks the newly-exposed slab
    // dirty.
    if (cellMap.autoFocusFromCamera) {
      CellMap.setFocus(cellMap, camPos.x, camPos.y, camPos.z);
    }

    // Drive forward any pending shift/resize's chunk-*data* generation
    // (see CellWindow.advance) -- a target with genuinely-new chunks doesn't
    // move the resident window until every one is generated, spread across
    // frames instead of paid synchronously inside a single shift. Called
    // unconditionally (not gated behind autoFocusFromCamera/
    // autoResizeFromZoom) so a pending target still gets driven forward for
    // manually-driven windows too, and before the buffer-cleanup drain below
    // since a commit here can also evict chunks.
    CellMap.advanceWindowGeneration(cellMap);

    // Drive forward any in-flight CellMap.setCells batch, same reasoning as
    // advanceWindowGeneration above -- unconditional, and before the dirty-
    // chunk rebuild below so chunks it touches this frame get meshed this
    // frame too, not one frame later.
    CellMap.advanceSetCells(cellMap);

    // A resize or shift above may have evicted chunks from the window --
    // drain and actually delete their GPU buffers here, once per cell-map
    // per frame, regardless of which path produced them (this component has
    // no GL context of its own, see reassembleChunks in cell-map/data.ts).
    for (const chunk of CellMap.takePendingBufferCleanup(cellMap)) {
      if (chunk.glVertexBuffer) gl.deleteBuffer(chunk.glVertexBuffer);
      if (chunk.glIndexBuffer) gl.deleteBuffer(chunk.glIndexBuffer);
    }

    // Rebuild any dirty chunks
    rebuildDirtyChunks(cellMap);

    // Set per-cell-map uniforms
    gl.uniform3f(
      uCellSize,
      cellMap.cellSize.x,
      cellMap.cellSize.y,
      cellMap.cellSize.z,
    );
    gl.uniform3f(
      uWindowSize,
      cellMap.mapSize.x,
      cellMap.mapSize.y,
      cellMap.mapSize.z,
    );
    const windowOrigin = cellMap.window.origin;
    // Cell units (see the uWindowOrigin/uWorldOffset comment above) -- used
    // by the fragment shader's reveal/occlusion sampling.
    gl.uniform3f(
      uWindowOrigin,
      (windowOrigin?.cx ?? 0) * cellMap.chunkSize.x,
      (windowOrigin?.cy ?? 0) * cellMap.chunkSize.y,
      (windowOrigin?.cz ?? 0) * cellMap.chunkSize.z,
    );
    // World/continuous units (cellSize-scaled) -- used by the vertex
    // shader's position offset + depth-bias recentering.
    gl.uniform3f(
      uWorldOffset,
      (windowOrigin?.cx ?? 0) * cellMap.chunkSize.x * cellMap.cellSize.x,
      (windowOrigin?.cy ?? 0) * cellMap.chunkSize.y * cellMap.cellSize.y,
      (windowOrigin?.cz ?? 0) * cellMap.chunkSize.z * cellMap.cellSize.z,
    );

    // Solidity texture (u_cellSolidity) is read by BOTH the reveal raycast and the
    // AO/cast-shadow depth cues — so upload/bind it whenever either needs it.
    const reveal = !!camera.revealTarget && !cellMap.revealExempt;
    const cues = camera.depthCues;
    const needSolidity =
      reveal || (!!cues && (cues.ao.weight > 0 || cues.shadow.weight > 0));

    // cellMap.mapSize reflects the window's configured target size, set
    // eagerly at construction/resize -- but a generative window with a large
    // initial radius doesn't commit its first chunk batch to the WASM store
    // synchronously (see CellMap.advanceWindowGeneration, staged across
    // frames). Until that first commit lands, computeSolidityMap() still
    // reads whatever the WASM store was last loaded with (a different size,
    // e.g. a previous scene's cell-map), and uploading against mapSize's
    // size throws "ArrayBufferView not big enough". `window.origin` is null
    // exactly until the first commit lands (set alongside it), so gate on
    // that instead of trying to upload early.
    const windowCommitted = cellMap.window.origin !== null;

    if (needSolidity && windowCommitted) {
      // Recompute every frame — cheap for small maps.
      const solidityMap = computeSolidityMap();
      uploadVisibilityTexture(gl, camera, solidityMap, cellMap.mapSize);
    }
    // Always keep u_cellSolidity pointed at unit 3, even on frames that don't
    // (re)upload solidity data -- a sampler uniform that's never explicitly
    // set defaults to unit 0, which u_albedoTexture (sampler2D) also uses.
    // That silently "worked" while both uniforms were sampler2D; now that
    // u_cellSolidity is sampler2DArray, a defaulted/stale unit-0 assignment
    // is a hard GL_INVALID_OPERATION ("two textures of different types use
    // the same sampler location") the moment both uniforms have ever been set.
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, camera.glResources.visibilityTexture);
    gl.uniform1i(uCellSolidity, 3);

    // The reveal raycast (Y-slice clip) is separate from the cues.
    if (reveal && camera.revealTarget) {
      gl.uniform3f(
        uRevealTarget,
        camera.revealTarget.x,
        camera.revealTarget.y,
        camera.revealTarget.z,
      );
      gl.uniform1i(uHasVisibilityMask, 1);
    } else {
      gl.uniform1i(uHasVisibilityMask, 0);
    }

    // Per-cell emission (highlight) color texture (Part A). Rebuild the GPU texture
    // only when the map changed — setEmissionColor sets emissionColorDirty; no remesh
    // is involved. An all-black map skips upload and disables the shader term.
    // Same windowCommitted gate as the solidity texture above -- and left
    // dirty (not cleared) if the window hasn't committed yet, so it retries
    // once it has, rather than being silently dropped.
    if (cellMap.emissionColorDirty && windowCommitted) {
      const { bytes, hasAny } = buildCellEmissionColorBytes(cellMap);
      camera.glResources.cellEmissionColorHasAny = hasAny;
      if (hasAny) {
        uploadCellEmissionColorTexture(gl, camera, bytes, cellMap.mapSize);
      }
      cellMap.emissionColorDirty = false;
    }
    // Same reasoning as u_cellSolidity above -- always pin the unit so this
    // sampler2DArray uniform never falls back to its default (0) and
    // collides with a sampler2D uniform also sitting on unit 0.
    gl.activeTexture(gl.TEXTURE6);
    gl.bindTexture(
      gl.TEXTURE_2D_ARRAY,
      camera.glResources.cellEmissionColorTexture,
    );
    gl.uniform1i(uCellEmissionColor, 6);
    if (
      camera.glResources.cellEmissionColorHasAny &&
      camera.glResources.cellEmissionColorTexture
    ) {
      gl.uniform1i(uHasCellEmissionColor, 1);
    } else {
      gl.uniform1i(uHasCellEmissionColor, 0);
    }

    let totalFaces = 0;
    let drawCalls = 0;

    // Caps fresh GPU uploads per frame -- reassembleChunks can mark hundreds
    // of REUSED (translated, not remeshed) chunks gpuDirty in a single call
    // (every persisting chunk moves local slot on a shift), independent of
    // and not covered by rebuildDirtyChunks' meshing budget. See the
    // gpuDirty check below for how a deferred chunk is handled.
    const GPU_UPLOAD_BUDGET_MS = 4;
    const uploadDeadline = performance.now() + GPU_UPLOAD_BUDGET_MS;
    let uploadedThisFrame = 0;

    // Render chunks: candidate world chunk-coordinates are calculated
    // directly from the render volume's AABB, not scanned from
    // cellMap.chunks -- each candidate's window-local index is computed and
    // used to look the chunk up directly, then refined against the volume's
    // exact bounds via a plain AABB-vs-AABB overlap test (the volume is
    // axis-aligned, so this is exact, not an approximation).
    const origin = cellMap.window.origin;
    if (origin) {
      const gridDims = cellMap.chunkGridSize;
      const candidateRange = chunkCandidateRange(
        volumeAABB,
        cellMap.chunkSize,
        cellMap.cellSize,
      );
      for (let cz = candidateRange.minCz; cz <= candidateRange.maxCz; cz++) {
        const localZ = cz - origin.cz;
        if (localZ < 0 || localZ >= gridDims.z) continue;
        for (let cy = candidateRange.minCy; cy <= candidateRange.maxCy; cy++) {
          const localY = cy - origin.cy;
          if (localY < 0 || localY >= gridDims.y) continue;
          for (
            let cx = candidateRange.minCx;
            cx <= candidateRange.maxCx;
            cx++
          ) {
            const localX = cx - origin.cx;
            if (localX < 0 || localX >= gridDims.x) continue;
            const flatIndex =
              localZ * gridDims.y * gridDims.x + localY * gridDims.x + localX;
            const chunk = cellMap.chunks[flatIndex];
            if (
              !chunk ||
              chunk.faceCount === 0 ||
              !chunk.vertices ||
              !chunk.indices
            )
              continue;
            const chunkMin = {
              x: cx * cellMap.chunkSize.x * cellMap.cellSize.x,
              y: cy * cellMap.chunkSize.y * cellMap.cellSize.y,
              z: cz * cellMap.chunkSize.z * cellMap.cellSize.z,
            };
            const chunkMax = {
              x: chunkMin.x + cellMap.chunkSize.x * cellMap.cellSize.x,
              y: chunkMin.y + cellMap.chunkSize.y * cellMap.cellSize.y,
              z: chunkMin.z + cellMap.chunkSize.z * cellMap.cellSize.z,
            };
            if (aabbOutsideVolume(chunkMin, chunkMax, volumeAABB)) continue;

            // Only a chunk that's NEVER been uploaded (no glVertexBuffer
            // yet) can be safely skipped this frame when the budget's
            // exhausted -- it wasn't visible before either way, so
            // deferring it just delays its first appearance, same as the
            // meshing budget's existing pop-in. A REUSED/translated chunk
            // already has a buffer and WAS visible last frame -- skipping
            // its draw here would make it flicker out and back in as it
            // waits for its upload turn, so it always uploads immediately
            // below regardless of budget.
            const isFirstUpload = !chunk.glVertexBuffer;
            if (
              chunk.gpuDirty &&
              isFirstUpload &&
              uploadedThisFrame > 0 &&
              performance.now() > uploadDeadline
            ) {
              continue;
            }

            // Upload GPU buffers only when the CPU-side mesh has actually
            // changed since the last upload -- gpuDirty is set whenever
            // rebuildDirtyChunks (re)meshes a chunk, and cleared right after
            // the upload below. The binds themselves stay unconditional:
            // vertexAttribPointer/drawElements further down read whatever's
            // currently bound, so they must be set every time this chunk is
            // drawn regardless of whether new data needs uploading.
            if (!chunk.glVertexBuffer) {
              chunk.glVertexBuffer = gl.createBuffer();
            }
            if (!chunk.glIndexBuffer) {
              chunk.glIndexBuffer = gl.createBuffer();
            }

            gl.bindBuffer(gl.ARRAY_BUFFER, chunk.glVertexBuffer);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, chunk.glIndexBuffer);
            if (chunk.gpuDirty) {
              const uploadT0 = profiling ? performance.now() : 0;
              gl.bufferData(gl.ARRAY_BUFFER, chunk.vertices, gl.STATIC_DRAW);
              gl.bufferData(
                gl.ELEMENT_ARRAY_BUFFER,
                chunk.indices,
                gl.STATIC_DRAW,
              );
              chunk.gpuDirty = false;
              uploadedThisFrame++;
              if (profiling) gpuUploadMs += performance.now() - uploadT0;
            }

            // Interleaved layout: pos3+normal3+origPos3+emission1 (stride 10), or +uv2
            // (stride 12 when the cell-map has UV custom shapes). emission is always
            // present at float 9 (byte 36); uv, when present, follows at byte 40.
            // Stride is per-chunk from WASM.
            const strideBytes = chunk.stride * 4;
            gl.enableVertexAttribArray(aPosition);
            gl.vertexAttribPointer(
              aPosition,
              3,
              gl.FLOAT,
              false,
              strideBytes,
              0,
            );

            if (aNormal >= 0) {
              gl.enableVertexAttribArray(aNormal);
              gl.vertexAttribPointer(
                aNormal,
                3,
                gl.FLOAT,
                false,
                strideBytes,
                12,
              );
            }

            if (aOrigPosition >= 0) {
              gl.enableVertexAttribArray(aOrigPosition);
              gl.vertexAttribPointer(
                aOrigPosition,
                3,
                gl.FLOAT,
                false,
                strideBytes,
                24,
              );
            }

            // Emission glow: always present at byte 36 (1 float).
            if (aEmission >= 0) {
              gl.enableVertexAttribArray(aEmission);
              gl.vertexAttribPointer(
                aEmission,
                1,
                gl.FLOAT,
                false,
                strideBytes,
                36,
              );
            }

            // UV channel: present only at stride 12 (after emission). Else constant (0,0).
            if (aUv >= 0) {
              if (chunk.stride >= 12) {
                gl.enableVertexAttribArray(aUv);
                gl.vertexAttribPointer(
                  aUv,
                  2,
                  gl.FLOAT,
                  false,
                  strideBytes,
                  40,
                );
              } else {
                gl.disableVertexAttribArray(aUv);
                gl.vertexAttrib2f(aUv, 0, 0);
              }
            }

            // Draw each material range
            for (const range of chunk.drawRanges) {
              const material = cellMap.materials[range.materialIndex];
              if (!material) continue;

              const sides = material.sides;

              // Get albedo texture (base frame anchors the atlas page + fallback)
              const albedoTextureMap = textureMapCache.get(
                material.albedoTextureKey,
              );
              if (
                !albedoTextureMap ||
                albedoTextureMap.packedFrames.length === 0
              )
                continue;

              const baseAlbedo = frameBounds(
                albedoTextureMap,
                material.albedoFrame ?? 0,
              );
              if (!baseAlbedo) continue;

              const atlasTexture =
                camera.glResources.atlasTextures[baseAlbedo.atlasIndex];
              if (!atlasTexture) continue;

              // Bind albedo texture
              gl.activeTexture(gl.TEXTURE0);
              gl.bindTexture(gl.TEXTURE_2D, atlasTexture);
              gl.uniform1i(uAlbedoTexture, 0);

              // Per-plane albedo frames — XZ = up, YZ = south-east, XY = south-west
              const albedoUp = resolvePlane(
                albedoTextureMap,
                sides?.up?.albedoFrame,
                baseAlbedo,
              );
              const albedoSE = resolvePlane(
                albedoTextureMap,
                sides?.southEast?.albedoFrame,
                baseAlbedo,
              );
              const albedoSW = resolvePlane(
                albedoTextureMap,
                sides?.southWest?.albedoFrame,
                baseAlbedo,
              );
              gl.uniform4f(uAlbedoBoundsXZ, ...albedoUp.bounds);
              gl.uniform2f(uAlbedoSizeXZ, ...albedoUp.size);
              gl.uniform4f(uAlbedoBoundsYZ, ...albedoSE.bounds);
              gl.uniform2f(uAlbedoSizeYZ, ...albedoSE.size);
              gl.uniform4f(uAlbedoBoundsXY, ...albedoSW.bounds);
              gl.uniform2f(uAlbedoSizeXY, ...albedoSW.size);

              // UV mode (custom shapes with mesh UVs): sample the base frame by v_uv.
              gl.uniform1i(uUseMeshUV, range.useMeshUV ? 1 : 0);
              gl.uniform4f(uAlbedoBoundsBase, ...baseAlbedo.bounds);

              // Bind normal texture if available
              const normalTextureMap = textureMapCache.get(
                material.normalTextureKey,
              );
              const baseNormal = normalTextureMap
                ? frameBounds(normalTextureMap, material.normalFrame ?? 0)
                : null;
              if (normalTextureMap && baseNormal) {
                const normalAtlasTexture =
                  camera.glResources.atlasTextures[baseNormal.atlasIndex];

                if (normalAtlasTexture) {
                  gl.activeTexture(gl.TEXTURE1);
                  gl.bindTexture(gl.TEXTURE_2D, normalAtlasTexture);
                  gl.uniform1i(uNormalTexture, 1);

                  const normalUp = resolvePlane(
                    normalTextureMap,
                    sides?.up?.normalFrame,
                    baseNormal,
                  );
                  const normalSE = resolvePlane(
                    normalTextureMap,
                    sides?.southEast?.normalFrame,
                    baseNormal,
                  );
                  const normalSW = resolvePlane(
                    normalTextureMap,
                    sides?.southWest?.normalFrame,
                    baseNormal,
                  );
                  gl.uniform4f(uNormalBoundsXZ, ...normalUp.bounds);
                  gl.uniform2f(uNormalSizeXZ, ...normalUp.size);
                  gl.uniform4f(uNormalBoundsYZ, ...normalSE.bounds);
                  gl.uniform2f(uNormalSizeYZ, ...normalSE.size);
                  gl.uniform4f(uNormalBoundsXY, ...normalSW.bounds);
                  gl.uniform2f(uNormalSizeXY, ...normalSW.size);
                  gl.uniform4f(uNormalBoundsBase, ...baseNormal.bounds);
                  gl.uniform1i(uHasNormal, 1);
                } else {
                  gl.uniform1i(uHasNormal, 0);
                }
              } else {
                gl.uniform1i(uHasNormal, 0);
              }

              // Bind emissive texture if the material provides one (Part B). Same per-side
              // atlas layout as normal maps; the shader scales it by per-cell v_emission and
              // falls back to albedo when u_hasEmissionTexture is false.
              const emissionTextureMap = textureMapCache.get(
                material.emissionTextureKey,
              );
              const baseEmission = emissionTextureMap
                ? frameBounds(emissionTextureMap, material.emissionFrame ?? 0)
                : null;
              if (emissionTextureMap && baseEmission) {
                const emissionAtlasTexture =
                  camera.glResources.atlasTextures[baseEmission.atlasIndex];

                if (emissionAtlasTexture) {
                  gl.activeTexture(gl.TEXTURE2);
                  gl.bindTexture(gl.TEXTURE_2D, emissionAtlasTexture);
                  gl.uniform1i(uEmissionTexture, 2);

                  const emissionUp = resolvePlane(
                    emissionTextureMap,
                    sides?.up?.emissionFrame,
                    baseEmission,
                  );
                  const emissionSE = resolvePlane(
                    emissionTextureMap,
                    sides?.southEast?.emissionFrame,
                    baseEmission,
                  );
                  const emissionSW = resolvePlane(
                    emissionTextureMap,
                    sides?.southWest?.emissionFrame,
                    baseEmission,
                  );
                  gl.uniform4f(uEmissionBoundsXZ, ...emissionUp.bounds);
                  gl.uniform2f(uEmissionSizeXZ, ...emissionUp.size);
                  gl.uniform4f(uEmissionBoundsYZ, ...emissionSE.bounds);
                  gl.uniform2f(uEmissionSizeYZ, ...emissionSE.size);
                  gl.uniform4f(uEmissionBoundsXY, ...emissionSW.bounds);
                  gl.uniform2f(uEmissionSizeXY, ...emissionSW.size);
                  gl.uniform1i(uHasEmissionTexture, 1);
                } else {
                  gl.uniform1i(uHasEmissionTexture, 0);
                }
              } else {
                gl.uniform1i(uHasEmissionTexture, 0);
              }

              // Draw this material's faces
              gl.drawElements(
                gl.TRIANGLES,
                range.indexCount,
                gl.UNSIGNED_INT,
                range.indexOffset * 4, // byte offset (Uint32 = 4 bytes per index)
              );
              drawCalls++;
            }

            totalFaces += chunk.faceCount;
          }
        }
      }
    }

    if (profiling) {
      recordComponentUpdate(
        cellMap.id ?? -1,
        cellMap.name,
        'cell-map:gpuUpload',
        gpuUploadMs,
      );
    }
  }

  // Restore state for sprite rendering
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
}
