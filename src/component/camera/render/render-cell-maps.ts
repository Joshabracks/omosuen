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

/**
 * Unit "view direction", pointing INTO the visible scene (away from the
 * camera, toward what it's looking at) -- the single 3D direction along
 * which a world point can move without changing its screen position (only
 * its depth). The axonometric projection (isoX/isoY, see unified.vert /
 * camIsoX/camIsoY below) is an exact LINEAR map from world (x,y,z) to 2D
 * screen space with no perspective divide, so it has a 1-dimensional null
 * space, solved directly from isoX(V)=0, isoY(V)=0 -- but that only pins the
 * *line*, not which of its two directions is "forward"; the sign has to be
 * fixed separately.
 *
 * Sign verified against the top-down boundary case (axonometricAngle=90,
 * sinA=1, heightScale=0): a top-down camera looks DOWN at the ground below
 * it, so "into the scene" must be -Y. The raw null-space solution
 * `(heightScale*(cosYaw-sinYaw), 2*sinA, heightScale*(cosYaw+sinYaw))`
 * gives +Y at that boundary (2*sinA > 0) -- backwards -- so it's negated
 * below. (This was the actual bug: with the un-negated sign, the far rect
 * and the near/far frustum planes extended away from the visible terrain
 * instead of into it, leaving only a thin near-plane sliver of overlap --
 * "one chunk visible in a narrow zoom window.")
 */
function computeViewDirection(
  cosYaw: number,
  sinYaw: number,
  sinA: number,
  heightScale: number,
): Vec3 {
  const vx = -(heightScale * (cosYaw - sinYaw));
  const vy = -(2 * sinA);
  const vz = -(heightScale * (cosYaw + sinYaw));
  const len = Math.hypot(vx, vy, vz); // never zero for angle in [0,90]
  return { x: vx / len, y: vy / len, z: vz / len };
}

/**
 * The "screen" as a world-space rect: 4 corners, in the plane through
 * `camPos` perpendicular to `V` (the true view direction), each one
 * projecting to the corresponding screen corner. For each screen corner, the
 * linear projection is inverted for ONE particular solution (assuming
 * relY=0), then that point is projected along -V onto the plane through the
 * camera -- the standard point-onto-plane-along-a-direction projection.
 */
function computeNearRectCorners(
  camPos: Vec3,
  cosYaw: number,
  sinYaw: number,
  sinA: number,
  halfIsoX: number,
  halfIsoY: number,
  V: Vec3,
): Vec3[] {
  const safeSinA = Math.max(sinA, 0.05); // same degenerate-angle floor as before
  const corners: Vec3[] = [];
  for (const sx of [-halfIsoX, halfIsoX]) {
    for (const sy of [-halfIsoY, halfIsoY]) {
      const rx0 = (sx / ISO_H + sy / safeSinA) / 2;
      const rz0 = (sy / safeSinA - sx / ISO_H) / 2;
      const relX0 = rx0 * cosYaw - rz0 * sinYaw;
      const relZ0 = rx0 * sinYaw + rz0 * cosYaw;
      // relY0 = 0 (the particular solution chosen). Project onto the plane
      // through the camera (origin, in relative coords) perpendicular to V.
      const t =
        -(relX0 * V.x + relZ0 * V.z) / (V.x * V.x + V.y * V.y + V.z * V.z);
      corners.push({
        x: camPos.x + relX0 + t * V.x,
        y: camPos.y + t * V.y,
        z: camPos.z + relZ0 + t * V.z,
      });
    }
  }
  return corners;
}

/**
 * Each center-rect corner translated `distance` along `V` (negative to go
 * backward). Since V is exactly the screen-preserving direction, this is
 * precisely "rays whose direction accounts for viewpoint so the points
 * still render at the screen corners no matter how far away" -- called with
 * +depthMax and -depthMax to build the symmetric render volume's far and
 * near faces (see the call site).
 */
function computeFarRectCorners(
  nearCorners: Vec3[],
  V: Vec3,
  distance: number,
): Vec3[] {
  return nearCorners.map((c) => ({
    x: c.x + V.x * distance,
    y: c.y + V.y * distance,
    z: c.z + V.z * distance,
  }));
}

/** Axis-aligned bounding box of the 8 near+far corners (the oriented render volume). */
function computeVolumeWorldAABB(corners8: Vec3[]): { min: Vec3; max: Vec3 } {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const c of corners8) {
    min.x = Math.min(min.x, c.x);
    max.x = Math.max(max.x, c.x);
    min.y = Math.min(min.y, c.y);
    max.y = Math.max(max.y, c.y);
    min.z = Math.min(min.z, c.z);
    max.z = Math.max(max.z, c.z);
  }
  return { min, max };
}

/** World chunk-coordinate range that could intersect the volume, calculated directly from its AABB -- not scanned from what's resident. */
function chunkCandidateRange(
  aabb: { min: Vec3; max: Vec3 },
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

/** One face of the view frustum: inward normal + offset, s.t. a point is inside where dot(normal, relPos) + offset >= 0. */
interface FrustumPlane {
  normal: Vec3;
  offset: number;
}

/**
 * The 6 view-frustum planes (standard view-frustum-culling technique --
 * normally extracted from a view-projection matrix via the Gribb/Hartmann
 * method; this engine has no such matrix, so the planes are derived directly
 * from sx/sy/depth's linear coefficients -- since each is already an exact
 * linear function of world position, its gradient IS the plane normal).
 */
function computeFrustumPlanes(
  cosYaw: number,
  sinYaw: number,
  sinA: number,
  heightScale: number,
  halfIsoX: number,
  halfIsoY: number,
  V: Vec3,
  depthMax: number,
): FrustumPlane[] {
  const gx = {
    x: ISO_H * (cosYaw + sinYaw),
    y: 0,
    z: ISO_H * (sinYaw - cosYaw),
  };
  const gy = {
    x: sinA * (cosYaw - sinYaw),
    y: -heightScale,
    z: sinA * (sinYaw + cosYaw),
  };
  const neg = (v: Vec3): Vec3 => ({ x: -v.x, y: -v.y, z: -v.z });
  return [
    { normal: neg(gx), offset: halfIsoX }, // right   (sx <=  halfIsoX)
    { normal: gx, offset: halfIsoX }, // left    (sx >= -halfIsoX)
    { normal: neg(gy), offset: halfIsoY }, // top     (sy <=  halfIsoY)
    { normal: gy, offset: halfIsoY }, // bottom  (sy >= -halfIsoY)
    // Symmetric slab around the camera, not a one-sided forward volume --
    // see the call site's comment for why (this camera has no "behind").
    { normal: neg(V), offset: depthMax }, // far   (depth <=  depthMax)
    { normal: V, offset: depthMax }, // near  (depth >= -depthMax)
  ];
}

/**
 * Standard AABB-vs-frustum-plane N-vertex test: true if the box is provably
 * entirely outside at least one plane (the corner most against that plane's
 * normal still fails it) -- a trivial reject with no false negatives, unlike
 * testing a fixed set of corners against the volume directly.
 */
function aabbOutsideFrustum(
  min: Vec3,
  max: Vec3,
  camPos: Vec3,
  planes: FrustumPlane[],
): boolean {
  for (const { normal, offset } of planes) {
    const nx = normal.x >= 0 ? min.x : max.x; // N-vertex: worst corner against this normal
    const ny = normal.y >= 0 ? min.y : max.y;
    const nz = normal.z >= 0 ? min.z : max.z;
    const dot =
      normal.x * (nx - camPos.x) +
      normal.y * (ny - camPos.y) +
      normal.z * (nz - camPos.z);
    if (dot + offset < 0) return true; // even the best corner fails -- wholly outside
  }
  return false;
}

/**
 * Residency (window sizing) target, in chunks -- necessarily axis-aligned
 * (CellWindow's grid has no rotation concept), sized to cover the worst-case
 * side of the volume's AABB relative to camPos (the AABB is generally NOT
 * symmetric around the camera, since the volume only extends forward along
 * V, not behind it -- a symmetric axis-aligned window still has to reach as
 * far as the single farthest side on each axis). This is a disclosed
 * inefficiency of CellWindow's axis-aligned architecture (some resident
 * chunks behind the camera are never drawn by the frustum cull), not fixable
 * without redesigning residency's data structure.
 */
function worldAABBToChunkRadius(
  aabb: { min: Vec3; max: Vec3 },
  camPos: Vec3,
  chunkSize: Vec3,
  cellSize: Vec3,
): Vec3 {
  return {
    x: Math.max(
      1,
      Math.ceil(
        Math.max(
          Math.abs(aabb.min.x - camPos.x),
          Math.abs(aabb.max.x - camPos.x),
        ) /
          (chunkSize.x * cellSize.x),
      ),
    ),
    y: Math.max(
      1,
      Math.ceil(
        Math.max(
          Math.abs(aabb.min.y - camPos.y),
          Math.abs(aabb.max.y - camPos.y),
        ) /
          (chunkSize.y * cellSize.y),
      ),
    ),
    z: Math.max(
      1,
      Math.ceil(
        Math.max(
          Math.abs(aabb.min.z - camPos.z),
          Math.abs(aabb.max.z - camPos.z),
        ) /
          (chunkSize.z * cellSize.z),
      ),
    ),
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

/** Warn-once guard for `clampRadiusToTextureLimit` actually binding. */
let warnedTextureClamp = false;

/**
 * `uploadVisibilityTexture`/`uploadCellEmissionColorTexture` (below) pack the
 * window's 3D data into a 2D texture (width=windowSize.x,
 * height=windowSize.y*windowSize.z) -- that product can exceed
 * `gl.MAX_TEXTURE_SIZE` well before `maxWindowRadius`'s own cost-driven cap
 * does (confirmed live: this scene's default zoom alone already requests a
 * radius that overflows a 16384-limit GPU). A failed `texImage2D` call
 * leaves the OLD, smaller texture content in place while the shader samples
 * it against the NEW, larger window uniforms -- corrupting reveal/occlusion
 * rendering across most of the map. Must be clamped before a resize is ever
 * applied, not just before upload.
 */
function clampRadiusToTextureLimit(
  radius: { x: number; y: number; z: number },
  chunkSize: { x: number; y: number; z: number },
  maxTextureSize: number,
): { x: number; y: number; z: number } {
  let rx = radius.x;
  let ry = radius.y;
  let rz = radius.z;
  const width = (): number => (2 * rx + 1) * chunkSize.x;
  const height = (): number =>
    (2 * ry + 1) * chunkSize.y * ((2 * rz + 1) * chunkSize.z);
  while (width() > maxTextureSize && rx > 0) rx--;
  while (height() > maxTextureSize && (ry > 0 || rz > 0)) {
    if (rz >= ry && rz > 0) rz--;
    else if (ry > 0) ry--;
  }
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
 * Uploads a per-cell visibility mask as a flattened 2D R8 texture, sized to
 * whatever's currently resident in the canonical store (today: the whole
 * map; once the shiftable hot window lands, the window — see
 * .design/completed_tasks/cell-map-overhaul/06-camera-reveal-fix.md).
 * Texture layout: width = windowX, height = windowY * windowZ.
 * Texel at (x, y + z * windowY) → cell (x, y, z), in window-local coordinates.
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
  gl.bindTexture(gl.TEXTURE_2D, camera.glResources.visibilityTexture);
  // The R8 mask is tightly packed; default UNPACK_ALIGNMENT (4) would expect each
  // row padded to a multiple of 4 bytes and reject maps whose width isn't a multiple
  // of 4 ("ArrayBufferView not big enough"). Force tight row packing.
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.R8,
    windowSize.x,
    windowSize.y * windowSize.z,
    0,
    gl.RED,
    gl.UNSIGNED_BYTE,
    mask,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
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
  gl.activeTexture(gl.TEXTURE4);
  gl.bindTexture(gl.TEXTURE_2D, camera.glResources.cellEmissionColorTexture);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA8,
    windowSize.x,
    windowSize.y * windowSize.z,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    bytes,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
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
  // in cell units — see
  // .design/completed_tasks/cell-map-overhaul/06-camera-reveal-fix.md) and by
  // the vertex shader's position offset + depth-bias recentering
  // (u_windowSize/u_worldOffset, in world/continuous units — see
  // .design/cell-map-overhaul/10-vertex-world-offset-and-depth-bias.md).
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

  // Render each cell-map
  for (const cellMap of cellMaps) {
    // Build this frame's view volume in world space (view-frustum culling --
    // see .design/cell-map-overhaul): the true view direction V, the center
    // rect (the "screen" as a world-space plane through the camera,
    // perpendicular to V), extruded `depthMax` along V in BOTH directions
    // (not just forward). This camera is a parallel/orthographic projection
    // acting as a pan-center reference point, not a directional eye with a
    // limited field of view -- unlike a perspective camera, it has no
    // "behind it can't see," so the render volume has to be a symmetric slab
    // centered on the camera, not a one-sided forward cone/prism. (A
    // one-sided version was the actual bug: it silently discarded roughly
    // half of the surrounding terrain on every frame, independent of zoom or
    // renderDistance, since a forward-only volume's near plane cuts straight
    // through camPos.) The resulting 8-corner volume's world AABB is used
    // both to size window residency below, and to derive the direct
    // chunk-coordinate candidate range in the draw loop further down.
    const V = computeViewDirection(cosYaw, sinYaw, sinA, heightScale);
    const halfIsoX = logicalWidth / 2 / Math.max(camera.zoom, 0.0001);
    const halfIsoY = logicalHeight / 2 / Math.max(camera.zoom, 0.0001);
    const renderDistanceWorld = {
      x: cellMap.renderDistance.x * cellMap.chunkSize.x * cellMap.cellSize.x,
      y: cellMap.renderDistance.y * cellMap.chunkSize.y * cellMap.cellSize.y,
      z: cellMap.renderDistance.z * cellMap.chunkSize.z * cellMap.cellSize.z,
    };
    const depthMax = Math.hypot(
      renderDistanceWorld.x,
      renderDistanceWorld.y,
      renderDistanceWorld.z,
    );
    const centerCorners = computeNearRectCorners(
      camPos,
      cosYaw,
      sinYaw,
      sinA,
      halfIsoX,
      halfIsoY,
      V,
    );
    const forwardCorners = computeFarRectCorners(centerCorners, V, depthMax);
    const backwardCorners = computeFarRectCorners(centerCorners, V, -depthMax);
    const volumeAABB = computeVolumeWorldAABB([
      ...forwardCorners,
      ...backwardCorners,
    ]);

    // Drive the window's radius from the render volume by default (runtime
    // window resizing) -- before focus/dirty-chunk rebuilding, since a
    // resize replaces the chunk array and marks every chunk dirty. Clamped
    // to maxWindowRadius inside CellMap.setWindowRadius itself.
    if (cellMap.autoResizeFromZoom) {
      const rawTargetRadius = worldAABBToChunkRadius(
        volumeAABB,
        camPos,
        cellMap.chunkSize,
        cellMap.cellSize,
      );
      const maxTextureSize = getMaxTextureSize(gl);
      const targetRadius = clampRadiusToTextureLimit(
        rawTargetRadius,
        cellMap.chunkSize,
        maxTextureSize,
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
            `MAX_TEXTURE_SIZE (${maxTextureSize}); consider a smaller chunkSize ` +
            'or accepting a smaller maxWindowRadius.',
        );
      }
      if (shouldApplyResize(cellMap, targetRadius)) {
        const oldChunks = cellMap.chunks;
        if (
          CellMap.setWindowRadius(cellMap, targetRadius) &&
          oldChunks !== cellMap.chunks
        ) {
          for (const chunk of oldChunks) {
            if (chunk.glVertexBuffer) gl.deleteBuffer(chunk.glVertexBuffer);
            if (chunk.glIndexBuffer) gl.deleteBuffer(chunk.glIndexBuffer);
          }
        }
      }
    }

    // Drive the window's focus from the camera by default (see
    // .design/cell-map-overhaul/11-focus-driving.md) -- before rebuilding
    // dirty chunks, since a shift marks every resident chunk dirty.
    if (cellMap.autoFocusFromCamera) {
      CellMap.setFocus(cellMap, camPos.x, camPos.y, camPos.z);
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

    if (needSolidity) {
      // Recompute every frame — cheap for small maps.
      const solidityMap = computeSolidityMap();
      uploadVisibilityTexture(gl, camera, solidityMap, cellMap.mapSize);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, camera.glResources.visibilityTexture);
      gl.uniform1i(uCellSolidity, 3);
    }

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
    if (cellMap.emissionColorDirty) {
      const { bytes, hasAny } = buildCellEmissionColorBytes(cellMap);
      camera.glResources.cellEmissionColorHasAny = hasAny;
      if (hasAny) {
        uploadCellEmissionColorTexture(gl, camera, bytes, cellMap.mapSize);
      }
      cellMap.emissionColorDirty = false;
    }
    if (
      camera.glResources.cellEmissionColorHasAny &&
      camera.glResources.cellEmissionColorTexture
    ) {
      gl.activeTexture(gl.TEXTURE4);
      gl.bindTexture(
        gl.TEXTURE_2D,
        camera.glResources.cellEmissionColorTexture,
      );
      gl.uniform1i(uCellEmissionColor, 4);
      gl.uniform1i(uHasCellEmissionColor, 1);
    } else {
      gl.uniform1i(uHasCellEmissionColor, 0);
    }

    let totalFaces = 0;
    let drawCalls = 0;

    // Render chunks: candidate world chunk-coordinates are calculated
    // directly from the view volume's AABB (view-frustum culling -- see
    // .design/cell-map-overhaul), not scanned from cellMap.chunks -- each
    // candidate's window-local index is computed and used to look the chunk
    // up directly, then refined against the true (oriented) frustum via the
    // standard AABB-vs-frustum-plane N-vertex test.
    const origin = cellMap.window.origin;
    if (origin) {
      const gridDims = cellMap.chunkGridSize;
      const candidateRange = chunkCandidateRange(
        volumeAABB,
        cellMap.chunkSize,
        cellMap.cellSize,
      );
      const planes = computeFrustumPlanes(
        cosYaw,
        sinYaw,
        sinA,
        heightScale,
        halfIsoX,
        halfIsoY,
        V,
        depthMax,
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
            if (aabbOutsideFrustum(chunkMin, chunkMax, camPos, planes))
              continue;

            // Upload GPU buffers if needed
            if (!chunk.glVertexBuffer) {
              chunk.glVertexBuffer = gl.createBuffer();
            }
            if (!chunk.glIndexBuffer) {
              chunk.glIndexBuffer = gl.createBuffer();
            }

            // Upload vertex data (interleaved pos3+normal3)
            gl.bindBuffer(gl.ARRAY_BUFFER, chunk.glVertexBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, chunk.vertices, gl.STATIC_DRAW);

            // Upload index data
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, chunk.glIndexBuffer);
            gl.bufferData(
              gl.ELEMENT_ARRAY_BUFFER,
              chunk.indices,
              gl.STATIC_DRAW,
            );

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
  }

  // Restore state for sprite rendering
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
}
