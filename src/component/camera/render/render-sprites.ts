import { AtlasManagerT } from '../../atlas-manager';
import { CellMapT } from '../../cell-map';
import { LightT } from '../../light';
import { FogOfWarT } from '../../fog-of-war';
import { NexusT } from '../../nexus';
import type { SpriteT } from '../../sprite';
import { TextureMapT } from '../../texture-map';
import type { PackedFrame } from '../../texture-map/types';
import { TransformT } from '../../transform';
import { rawOf } from '../../types';
import { ViewportT } from '../../viewport';
import { CameraT } from '../data';
import type { SpriteDrawData } from '../collect-renderables';
import {
  setAngleUniform,
  setOrbitYawUniform,
  setLightUniforms,
} from './light-uniforms';
import { computeFboUvBridge } from './framebuffers';
import { warnOversizedId } from './render-cell-maps';
import {
  bindVisibilityUniforms,
  getVisibilityFrame,
} from './visibility-uniforms';
import { gatherShapesAt } from './visibility-shapes';
import { setFogUniforms } from './fog-uniforms';
import { computeFogVisibility, fogDrawKind } from '../../fog-of-war/sweep';
import {
  isPhantomCoveredBySprite,
  phantomFogAlpha,
  spriteFogPresence,
} from '../../fog-of-war/methods';
import type { ResolvedSource } from '../../fog-of-war/sweep';
import { computeSolidityMap } from './visibility-mask';
import { packPaletteRemap, type PackedPalette } from '../../sprite/palette';
import {
  SPRITE_FLAG_EMISSION,
  SPRITE_FLAG_FOG_MEMORY,
  SPRITE_FLAG_MATERIAL,
  SPRITE_FLAG_NORMAL,
  SPRITE_FLAG_SILHOUETTE,
  SPRITE_INSTANCE_FLOATS,
  SPRITE_OFFSET_EMISSION,
  SPRITE_OFFSET_FOG,
  SPRITE_OFFSET_IDS,
  SPRITE_OFFSET_POS_ROT,
  SPRITE_OFFSET_SILHOUETTE,
  SPRITE_OFFSET_SIZE_ANCHOR,
  SPRITE_OFFSET_TINT,
  SPRITE_OFFSET_UV_ALBEDO,
  SPRITE_OFFSET_UV_EMISSION,
  SPRITE_OFFSET_UV_MATERIAL,
  SPRITE_OFFSET_UV_NORMAL,
  SPRITE_PALETTE_COUNT_SHIFT,
  beginSpritePalettes,
  sortDrawOrder,
  spriteInstanceBuffer,
  spritePaletteSlot,
  uploadSpriteInstances,
} from './sprite-instances';

/** Per-sprite gather scratch for fog visibility; reused, never retained. */
const nearShapes: ResolvedSource[] = [];

/**
 * The sprite's packed palette remap, or null when it has none. Repacked only
 * when `paletteRemap` is a different array from the one last packed, so a
 * direct assignment is picked up and an unchanged remap costs one compare.
 */
function spritePalette(sprite: SpriteT): PackedPalette | null {
  const remap = sprite.paletteRemap;
  if (!remap || remap.length === 0) return null;
  let packed = sprite._palettePacked;
  if (!packed || packed.source !== remap) {
    packed = packPaletteRemap(remap);
    sprite._palettePacked = packed;
  }
  return packed;
}

/** Default cell dimensions when no cell-maps are in the scene. */
const DEFAULT_CELL_SIZE_X = 32;
const DEFAULT_CELL_SIZE_Y = 16;
const DEFAULT_CELL_SIZE_Z = 32;

/** Default map dimension when no cell-maps provide actual dimensions. */
const DEFAULT_MAP_DIMENSION = 20;

/**
 * World-unit padding applied to the camera-relative off-screen reject below,
 * so a sprite whose transform anchor sits just outside the viewport but
 * still has visible pixels on-screen isn't dropped. Separate from
 * transform/on-screen.ts's EDGE_PAD_PX (screen pixels, different consumer) --
 * a tunable starting default, not derived from real asset data, same status
 * as that constant.
 */
const EDGE_PAD_WORLD = 64;

// Reused scratch buffers for the per-frame draw list. Parallel arrays (not an array
// of objects) grown only to the high-water sprite count, so steady-state rendering
// allocates nothing — no GC churn. Indexed by CANDIDATE: a sprite that survived the
// skip checks and the off-screen reject, in collection order. `sortDrawOrder` then
// supplies the back-to-front permutation over them.
const drawSprites: SpriteT[] = [];
const drawTransforms: TransformT[] = [];
// Float64, not Float32: MEMORY_DEPTH_BIAS is far below float32 resolution at
// world-scale depths, and the tie-break it provides must survive.
let drawDepths = new Float64Array(256);
// Parallel to the arrays above: true when the entry draws as a fog-of-war
// MEMORY (see `fogDrawKind`) -- a phantom sprite (`_fowStatus === 'phantom'`,
// spawned by fog-of-war/methods.ts's update() as a last-seen stand-in for a
// real sprite that's currently obscured), or a sprite mid-handover to one. Its
// record carries SPRITE_FLAG_FOG_MEMORY.
const drawIsMemory: boolean[] = [];

/**
 * One instanced draw call: a run of consecutive records (in draw order) whose
 * atlas pages can all be bound at once. `BATCH_INTS` ints each -- first record,
 * record count, then the atlas page bound for albedo / normal / emission /
 * material (-1 = no sprite in the run samples that channel, leave the unit
 * alone).
 */
const BATCH_INTS = 6;
let batches = new Int32Array(BATCH_INTS * 64);

/**
 * Depth nudge applied to a memory (phantom) draw so it always sorts behind a
 * coincident live sprite -- see where it is applied for why that ordering is
 * load-bearing. Small enough to be a pure tie-break between two entries at the
 * same world position, never enough to reorder genuinely distinct sprites.
 */
const MEMORY_DEPTH_BIAS = 1e-4;

// Texture-map channels, indexing the lookup memo below.
const CHANNEL_ALBEDO = 0;
const CHANNEL_NORMAL = 1;
const CHANNEL_EMISSION = 2;
const CHANNEL_MATERIAL = 3;

// Last texture map resolved per channel. Sprites drawn back to back very often
// share a sheet, so this turns most of the per-sprite `Map.get(string)` calls
// into one string compare. Reset around every pass, so it never outlives the
// texture maps it points at.
const memoKeys: (string | null)[] = [null, null, null, null];
const memoMaps: (TextureMapT | null)[] = [null, null, null, null];

function resetTextureMapMemo(): void {
  for (let i = 0; i < memoKeys.length; i++) {
    memoKeys[i] = null;
    memoMaps[i] = null;
  }
}

/** The (raw) texture map registered under `key`, or null. */
function lookupTextureMap(
  textureMapCache: Map<string, TextureMapT>,
  channel: number,
  key: string,
): TextureMapT | null {
  if (memoKeys[channel] === key) return memoMaps[channel];
  const found = textureMapCache.get(key);
  const map = found ? rawOf(found) : null;
  memoKeys[channel] = key;
  memoMaps[channel] = map;
  return map;
}

/**
 * The packed frame an OPTIONAL channel (normal / emission / material) should
 * sample, or null when the sprite has no such map, the map is unknown or
 * unpacked, the frame is missing, or its atlas page has no texture -- every
 * case in which the channel is simply treated as absent.
 */
function optionalFrame(
  textureMapCache: Map<string, TextureMapT>,
  channel: number,
  key: string | null | undefined,
  frameIndex: number,
  atlasTextures: (WebGLTexture | null)[],
): PackedFrame | null {
  if (!key) return null;
  const map = lookupTextureMap(textureMapCache, channel, key);
  if (!map || map.packedFrames.length === 0) return null;
  const frame = map.frameIndexMap.get(frameIndex);
  if (!frame || !atlasTextures[frame.atlasIndex]) return null;
  return frame;
}

/**
 * Writes a frame's UV rect in its atlas (normalized 0-1: minU, minV, maxU,
 * maxV) at `offset`, or zeros when there is no frame -- the buffer is reused,
 * so an absent channel must still overwrite what was there.
 */
function writeFrameUv(
  data: Float32Array,
  offset: number,
  frame: PackedFrame | null,
  atlasSize: number,
): void {
  if (!frame) {
    data[offset] = 0;
    data[offset + 1] = 0;
    data[offset + 2] = 0;
    data[offset + 3] = 0;
    return;
  }
  data[offset] = frame.atlasPosition.x / atlasSize;
  data[offset + 1] = frame.atlasPosition.y / atlasSize;
  data[offset + 2] = (frame.atlasPosition.x + frame.size.x) / atlasSize;
  data[offset + 3] = (frame.atlasPosition.y + frame.size.y) / atlasSize;
}

/** Appends a batch to `batches`, growing it if needed. */
function pushBatch(
  index: number,
  start: number,
  count: number,
  albedoPage: number,
  normalPage: number,
  emissionPage: number,
  materialPage: number,
): void {
  const o = index * BATCH_INTS;
  if (o + BATCH_INTS > batches.length) {
    const grown = new Int32Array(batches.length * 2);
    grown.set(batches);
    batches = grown;
  }
  batches[o] = start;
  batches[o + 1] = count;
  batches[o + 2] = albedoPage;
  batches[o + 3] = normalPage;
  batches[o + 4] = emissionPage;
  batches[o + 5] = materialPage;
}

/**
 * Attribute/uniform locations the sprite pass uses, looked up once per camera
 * program instead of once per frame.
 */
interface SpriteLocations {
  program: WebGLProgram;
  position: number;
  uv: number;
  origPosition: number;
  emission: number;
  viewportSize: WebGLUniformLocation | null;
  cameraPosition: WebGLUniformLocation | null;
  zoom: WebGLUniformLocation | null;
  cellSize: WebGLUniformLocation | null;
  windowSize: WebGLUniformLocation | null;
  windowOrigin: WebGLUniformLocation | null;
  windowWrapOffset: WebGLUniformLocation | null;
  worldOffset: WebGLUniformLocation | null;
  albedoTexture: WebGLUniformLocation | null;
  normalTexture: WebGLUniformLocation | null;
  materialTexture: WebGLUniformLocation | null;
  emissionTexture: WebGLUniformLocation | null;
  cameraWorldPos: WebGLUniformLocation | null;
  depthTexture: WebGLUniformLocation | null;
  fboUvScale: WebGLUniformLocation | null;
  fboUvOffset: WebGLUniformLocation | null;
  screenSize: WebGLUniformLocation | null;
  cellSolidity: WebGLUniformLocation | null;
  cellEmissionColor: WebGLUniformLocation | null;
  hasCellEmissionColor: WebGLUniformLocation | null;
  cellIdTexture: WebGLUniformLocation | null;
  exploredTexture: WebGLUniformLocation | null;
}

const spriteLocations = new Map<number, SpriteLocations>();

function getSpriteLocations(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  cameraId: number,
): SpriteLocations {
  const cached = spriteLocations.get(cameraId);
  // Keyed on the program too: a camera that is re-initialised links a new one.
  if (cached && cached.program === program) return cached;
  const u = (name: string): WebGLUniformLocation | null =>
    gl.getUniformLocation(program, name);
  const locations: SpriteLocations = {
    program,
    position: gl.getAttribLocation(program, 'a_position'),
    uv: gl.getAttribLocation(program, 'a_uv'),
    origPosition: gl.getAttribLocation(program, 'a_origPosition'),
    emission: gl.getAttribLocation(program, 'a_emission'),
    viewportSize: u('u_viewportSize'),
    cameraPosition: u('u_cameraPosition'),
    zoom: u('u_zoom'),
    cellSize: u('u_cellSize'),
    windowSize: u('u_windowSize'),
    windowOrigin: u('u_windowOrigin'),
    windowWrapOffset: u('u_windowWrapOffset'),
    worldOffset: u('u_worldOffset'),
    albedoTexture: u('u_albedoTexture'),
    normalTexture: u('u_normalTexture'),
    materialTexture: u('u_materialTexture'),
    emissionTexture: u('u_emissionTexture'),
    cameraWorldPos: u('u_cameraWorldPos'),
    depthTexture: u('u_depthTexture'),
    fboUvScale: u('u_fboUvScale'),
    fboUvOffset: u('u_fboUvOffset'),
    screenSize: u('u_screenSize'),
    cellSolidity: u('u_cellSolidity'),
    cellEmissionColor: u('u_cellEmissionColor'),
    hasCellEmissionColor: u('u_hasCellEmissionColor'),
    cellIdTexture: u('u_cellIdTexture'),
    exploredTexture: u('u_exploredTexture'),
  };
  spriteLocations.set(cameraId, locations);
  return locations;
}

/** Drops a disposed camera's cached locations. */
export function clearSpriteUniformCache(cameraId: number): void {
  spriteLocations.delete(cameraId);
}

/**
 * Renders sprites directly to screen at full resolution (no pixelation).
 * Sprites are depth-sorted against cell-maps using the FBO depth texture.
 */
export function renderSprites(
  camera: CameraT,
  viewport: ViewportT,
  spriteDraw: SpriteDrawData,
  cellMaps: CellMapT[],
  transform: TransformT,
  sceneRoot: NexusT,
  gl: WebGL2RenderingContext,
  textureMapCache: Map<string, TextureMapT>,
  lights: LightT[],
  subPixelOffset: { remainderX: number; remainderY: number },
  sinA: number,
  heightScale: number,
  cosYaw: number,
  sinYaw: number,
): void {
  const program = camera.glResources.unifiedProgram;
  if (!program) {
    console.warn(
      `[camera] Camera '${camera.name}' unified shader program not initialized`,
    );
    return;
  }

  // Draw into the composite target, over the already-upscaled cell image, at
  // full resolution — sprites are deliberately not pixelated. Safe to sample
  // the cell FBO's depth texture here (TEXTURE2, below): that FBO is not the
  // bound one, so there is no feedback loop.
  gl.bindFramebuffer(gl.FRAMEBUFFER, camera.glResources.framebufferB);
  gl.viewport(0, 0, viewport.width, viewport.height);

  // Calculate unified map bounds from all cell-maps for consistent depth sorting
  // Sprites need to use the maximum dimensions across all maps to ensure
  // they depth-sort correctly with all cell-maps in the scene
  let maxMapWidth = 0;
  let maxMapHeight = 0;
  let maxMapDepth = 0;
  let unifiedCellSizeX = DEFAULT_CELL_SIZE_X;
  let unifiedCellSizeY = DEFAULT_CELL_SIZE_Y;
  let unifiedCellSizeZ = DEFAULT_CELL_SIZE_Z;

  for (const cellMap of cellMaps) {
    maxMapWidth = Math.max(maxMapWidth, cellMap.mapSize.x);
    maxMapHeight = Math.max(maxMapHeight, cellMap.mapSize.y);
    maxMapDepth = Math.max(maxMapDepth, cellMap.mapSize.z);
    // Use the first cell-map's cell size (assume all maps use same cell size)
    if (cellMap === cellMaps[0]) {
      unifiedCellSizeX = cellMap.cellSize.x;
      unifiedCellSizeY = cellMap.cellSize.y;
      unifiedCellSizeZ = cellMap.cellSize.z;
    }
  }

  // Fallback to reasonable defaults if no cell-maps found
  if (maxMapWidth === 0) maxMapWidth = DEFAULT_MAP_DIMENSION;
  if (maxMapHeight === 0) maxMapHeight = DEFAULT_MAP_DIMENSION;
  if (maxMapDepth === 0) maxMapDepth = DEFAULT_MAP_DIMENSION;

  // Enable blending so transparent sprite pixels show cells underneath
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  // Disable hardware depth test — occlusion is handled in the fragment
  // shader by sampling the cell FBO's depth texture
  gl.disable(gl.DEPTH_TEST);
  gl.depthMask(false);

  // Disable backface culling for 2D sprites
  gl.disable(gl.CULL_FACE);

  // Use unified shader program
  gl.useProgram(program);

  // Set render mode to 1 (sprites)
  if (camera.glResources.renderModeLocation) {
    gl.uniform1i(camera.glResources.renderModeLocation, 1);
  }

  // Attribute/uniform locations (cached per camera program). Everything that
  // used to be a per-sprite uniform is now per-instance data -- see
  // sprite-instances.ts.
  const loc = getSpriteLocations(gl, program, camera.id!);
  const a_position = loc.position;
  const a_uv = loc.uv;
  const u_viewportSize = loc.viewportSize;
  const u_cameraPosition = loc.cameraPosition;
  const u_zoom = loc.zoom;
  const u_cellSize = loc.cellSize;
  const u_windowSize = loc.windowSize;
  const u_windowOrigin = loc.windowOrigin;
  const u_windowWrapOffset = loc.windowWrapOffset;
  const u_worldOffset = loc.worldOffset;
  const u_albedoTexture = loc.albedoTexture;
  const u_normalTexture = loc.normalTexture;
  const u_materialTexture = loc.materialTexture;
  const u_emissionTexture = loc.emissionTexture;
  const u_cameraWorldPos = loc.cameraWorldPos;
  const u_depthTexture = loc.depthTexture;
  const u_fboUvScale = loc.fboUvScale;
  const u_fboUvOffset = loc.fboUvOffset;
  const u_screenSize = loc.screenSize;
  const u_cellSolidity = loc.cellSolidity;
  const u_cellEmissionColor = loc.cellEmissionColor;
  const u_hasCellEmissionColor = loc.hasCellEmissionColor;
  const u_cellIdTexture = loc.cellIdTexture;
  const u_exploredTexture = loc.exploredTexture;

  // Set constant uniforms (same for all sprites)
  // Sprites render at full resolution to screen (not via FBO), so they use
  // the raw camera position for smooth movement instead of the snapped position.
  gl.uniform2f(
    u_viewportSize,
    viewport.width / camera.zoom,
    viewport.height / camera.zoom,
  );
  // Project camera 3D world position to 2D axonometric space
  // (same projection the vertex shader applies to every world position)
  const ISO_H = 0.8660254; // cos(30deg) — constant horizontal spread
  // Camera uses its cached WORLD position (composed up the ancestry by
  // updateWorldTransforms), so a nested camera nexus offsets the view.
  const camPos = transform.worldPosition;
  const camRx = camPos.x * cosYaw + camPos.z * sinYaw;
  const camRz = -camPos.x * sinYaw + camPos.z * cosYaw;
  const camIsoX = camRx * ISO_H - camRz * ISO_H;
  const camIsoY = camRx * sinA - camPos.y * heightScale + camRz * sinA;
  gl.uniform2f(u_cameraPosition, camIsoX, camIsoY);
  // Real 3D world-space camera position (distinct from the 2D iso-projected
  // u_cameraPosition above) — used to build the view direction for specular.
  gl.uniform3f(u_cameraWorldPos, camPos.x, camPos.y, camPos.z);
  gl.uniform1f(u_zoom, camera.zoom);
  gl.uniform3f(
    u_cellSize,
    unifiedCellSizeX,
    unifiedCellSizeY,
    unifiedCellSizeZ,
  );
  gl.uniform3f(u_windowSize, maxMapWidth, maxMapHeight, maxMapDepth);
  // World-space origin of the resident cell-map window, needed by the shared
  // depth-bias centering block in unified.vert (u_worldOffset -> rotCenterX/Z)
  // so cells and sprites agree on the SAME centering point. Previously
  // hardcoded to (0,0,0) here on the assumption sprites have no window of
  // their own -- but render-cell-maps.ts sets this to the cell-map's REAL
  // window origin (windowOrigin * chunkSize * cellSize), and for any
  // generative/windowed map whose window has recentered away from world
  // origin (i.e. any camera position other than very near (0,0,0), which is
  // the common case), that mismatch corrupted rotCenterX/Z between the two
  // passes by roughly half the window's own extent -- an error easily two-
  // plus orders of magnitude larger than a sprite's own height, silently
  // swamping the per-sprite depth math and causing sprites to render fully
  // occluded by open terrain that shouldn't be occluding them at all.
  // Mirrors render-cell-maps.ts's own computation exactly, from the first
  // cell-map (same "assume all maps share this" precedent as
  // unifiedCellSizeX/Y/Z above).
  const originCellMap = cellMaps[0];
  const windowOrigin = originCellMap?.window.origin;
  gl.uniform3f(
    u_worldOffset,
    originCellMap && windowOrigin
      ? windowOrigin.cx * originCellMap.chunkSize.x * originCellMap.cellSize.x
      : 0,
    originCellMap && windowOrigin
      ? windowOrigin.cy * originCellMap.chunkSize.y * originCellMap.cellSize.y
      : 0,
    originCellMap && windowOrigin
      ? windowOrigin.cz * originCellMap.chunkSize.z * originCellMap.cellSize.z
      : 0,
  );

  // Window origin in CELL units, for isRayBlocked's bounds check and
  // isCellSolid's addressing. Set here for the same reason as u_worldOffset
  // above and u_windowWrapOffset below: this pass uploads its OWN u_windowSize,
  // and an origin inherited from the cell pass would be paired with a different
  // size. A ray whose bounds check fails then reads as OUT OF BOUNDS, which
  // fails OPEN -- unblocked -- so every sprite would look like line of sight
  // simply did not apply to it. Matches render-cell-maps.ts's own computation.
  gl.uniform3f(
    u_windowOrigin,
    originCellMap && windowOrigin
      ? windowOrigin.cx * originCellMap.chunkSize.x
      : 0,
    originCellMap && windowOrigin
      ? windowOrigin.cy * originCellMap.chunkSize.y
      : 0,
    originCellMap && windowOrigin
      ? windowOrigin.cz * originCellMap.chunkSize.z
      : 0,
  );

  // Toroidal wrap offset for u_cellSolidity lookups (isCellSolid, shared with
  // the cell pass). Set here rather than inherited from renderCellMaps because
  // this pass sets its OWN u_windowSize above, and `windowSlot` takes the
  // modulo against that -- an offset computed against a different size would
  // fold lookups onto the wrong texels. Same failure shape as the u_worldOffset
  // mismatch documented above, so it is computed here from the same cell-map.
  const wrapMod = (v: number, d: number): number =>
    d > 0 ? ((v % d) + d) % d : 0;
  gl.uniform3i(
    u_windowWrapOffset,
    originCellMap && windowOrigin
      ? wrapMod(windowOrigin.cx * originCellMap.chunkSize.x, maxMapWidth)
      : 0,
    originCellMap && windowOrigin
      ? wrapMod(windowOrigin.cy * originCellMap.chunkSize.y, maxMapHeight)
      : 0,
    originCellMap && windowOrigin
      ? wrapMod(windowOrigin.cz * originCellMap.chunkSize.z, maxMapDepth)
      : 0,
  );

  // Set dynamic light uniforms (same lights as cell-maps)
  setLightUniforms(gl, camera.id!, lights);

  // Fog-of-war visibility shapes -- the same frame renderCellMaps bound,
  // built once by prepareVisibilityFrame (render/index.ts). `visionMode`
  // travels with them -- see bindVisibilityUniforms.
  const fogOfWar = sceneRoot.getComponentByType(
    'fog-of-war',
    true,
  ) as FogOfWarT | null;
  const fogUseLineOfSight = fogOfWar?.visionMode !== 'distance';
  bindVisibilityUniforms(gl, camera.id!, fogUseLineOfSight);

  // Per-sprite fog visibility is computed HERE, on the CPU, and uploaded in
  // the sprite's instance record -- see the fog block in unified.frag's sprite
  // path for why. Resolved from the exact shapes and bins the shader was handed (per
  // sprite, the shapes in its own bin), so the two cannot drift.
  //
  // `origin` is null until the cell-map's first window commit; with no
  // cell-map (or no committed window) there is no solidity data to raycast
  // against, so every sprite is treated as fully visible -- matching the
  // pre-existing behaviour of a scene that has sprites but no terrain.
  const visFrame = getVisibilityFrame();
  // Enabled shapes of EITHER kind, before any consumer cap. A volume alone
  // activates fog, and the sweep (fog-of-war/methods.ts) gates on the same
  // "any enabled shape" condition.
  const anyVisibilityShape = visFrame.resolved > 0;
  // THE GATE, and it has to mirror EXACTLY when the sweep runs -- see
  // `fogDrawKind`. It used to omit both conditions on the fog-of-war component
  // itself, and that made every sprite in a vision-source-only scene vanish:
  // nothing advances `_fowStatus` off its `'unseen'` default without
  // `FogOfWar.update`, and `'unseen'` is a skip.
  //
  // `memory: 'none'` is the same situation by choice rather than by omission --
  // no sweep, so no sprite may be skipped or replaced by a phantom. Fog still
  // FILTERS those sprites; it just does not remember them.
  const spriteFogManagesSprites =
    !!fogOfWar && fogOfWar.memory !== 'none' && anyVisibilityShape;
  const spriteFogActive =
    !!originCellMap && !!windowOrigin && visFrame.count > 0;
  // Cached WASM-side, so this is a flag read on frames where terrain did not
  // change. Held only across the synchronous draw loop below -- nothing in it
  // writes to WASM, so the view cannot be detached mid-use.
  const fogMask = spriteFogActive ? computeSolidityMap() : null;

  const fogCellDims = originCellMap?.mapSize;
  const fogCellSize = originCellMap?.cellSize;
  const fogWindowOriginLocalCell =
    originCellMap && windowOrigin
      ? {
          x: windowOrigin.cx * originCellMap.chunkSize.x,
          y: windowOrigin.cy * originCellMap.chunkSize.y,
          z: windowOrigin.cz * originCellMap.chunkSize.z,
        }
      : null;
  // u_fogLightInfluence feeds computeVisibility (used by both cell and
  // sprite fragment paths) -- uploaded independently here too, not just in
  // renderCellMaps, since a scene with sprites but no cell-maps never runs
  // that pass at all (see the u_cellSolidity pinning comment below for the
  // same "don't rely on the other draw call having run this frame" reasoning).
  // Styles, lightInfluence, memory mode and dropHidden. Uploaded HERE and not
  // left to renderCellMaps: a scene with sprites but no cell-maps never runs
  // that pass at all, and the sprite path reads both style tiers.
  setFogUniforms(gl, camera.id!, fogOfWar);

  // Set axonometric angle + orbit yaw uniforms (GPU computes cos/sin)
  setAngleUniform(gl, camera.id!, camera.axonometricAngle);
  setOrbitYawUniform(gl, camera.id!, camera.orbitYaw);

  // Bind cell FBO depth texture for occlusion masking
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, camera.glResources.depthTexture);
  gl.uniform1i(u_depthTexture, 2);

  // Cell id attachment on unit 8. Pinned unconditionally, exactly like the
  // solidity/emission/explored samplers below: an unset sampler defaults to
  // unit 0, where a float sampler2D lives, and an integer sampler colliding
  // with a float one on a single unit is GL_INVALID_OPERATION.
  gl.activeTexture(gl.TEXTURE8);
  gl.bindTexture(gl.TEXTURE_2D, camera.glResources.cellIdTexture);
  gl.uniform1i(u_cellIdTexture, 8);

  // Pass FBO UV mapping so the sprite shader can sample the depth texture.
  // Shared with the post-process blit — the two must agree exactly, and used to
  // be computed independently here (with the overscan constant hardcoded).
  const bridge = computeFboUvBridge(camera, subPixelOffset);
  gl.uniform2f(u_fboUvScale, bridge.scaleX, bridge.scaleY);
  gl.uniform2f(u_fboUvOffset, bridge.offsetX, bridge.offsetY);
  gl.uniform2f(u_screenSize, viewport.width, viewport.height);

  // Bind cell solidity texture and reveal target for per-fragment raycasting.
  // Unit 3 is always pinned, even when there's no reveal target this frame --
  // a sampler uniform that's never explicitly set defaults to unit 0, which
  // u_albedoTexture (sampler2D) also uses; since u_cellSolidity is
  // sampler2DArray, a defaulted/stale unit-0 assignment throws
  // GL_INVALID_OPERATION ("two textures of different types use the same
  // sampler location") the moment both uniforms have ever been set anywhere
  // in this shared program.
  gl.activeTexture(gl.TEXTURE3);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, camera.glResources.visibilityTexture);
  gl.uniform1i(u_cellSolidity, 3);

  // Same reasoning as u_cellSolidity above -- always pin u_cellEmissionColor
  // (also sampler2DArray) to unit 6, matching the unit render-cell-maps.ts
  // uses for it. Scenes with no cell-maps never run renderCellMaps, so
  // without this the uniform would default to unit 0 and collide with
  // u_albedoTexture (sampler2D) on every sprite draw.
  gl.activeTexture(gl.TEXTURE6);
  gl.bindTexture(
    gl.TEXTURE_2D_ARRAY,
    camera.glResources.cellEmissionColorTexture,
  );
  gl.uniform1i(u_cellEmissionColor, 6);

  // Same reasoning again for u_exploredTexture (sampler3D) on unit 7. The
  // sprite path never samples it, but it lives in this shared program, and a
  // sampler uniform that is never explicitly set defaults to unit 0 -- where
  // u_albedoTexture (sampler2D) already is. Two different sampler types on one
  // unit is GL_INVALID_OPERATION, and a scene with sprites but no cell-map
  // never runs renderCellMaps to set it. Binding null is fine: nothing here
  // reads it.
  gl.activeTexture(gl.TEXTURE7);
  gl.bindTexture(gl.TEXTURE_3D, camera.glResources.exploredTexture);
  gl.uniform1i(u_exploredTexture, 7);
  if (
    camera.glResources.cellEmissionColorHasAny &&
    camera.glResources.cellEmissionColorTexture
  ) {
    gl.uniform1i(u_hasCellEmissionColor, 1);
  } else {
    gl.uniform1i(u_hasCellEmissionColor, 0);
  }

  // Disable cell-only attributes that may be left enabled from cell rendering
  const a_origPosition = loc.origPosition;
  if (a_origPosition >= 0) {
    gl.disableVertexAttribArray(a_origPosition);
    gl.vertexAttrib3f(a_origPosition, 0, 0, 0);
  }
  const a_emission = loc.emission;
  if (a_emission >= 0) {
    gl.disableVertexAttribArray(a_emission);
    gl.vertexAttrib1f(a_emission, 0);
  }

  // Bind vertex buffers (shared for all sprites)
  // Bind vertex buffers (shared for all sprites)
  gl.bindBuffer(gl.ARRAY_BUFFER, camera.glResources.quadVertexBuffer);
  gl.enableVertexAttribArray(a_position);
  gl.vertexAttribPointer(a_position, 2, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, camera.glResources.quadUVBuffer);
  gl.enableVertexAttribArray(a_uv);
  gl.vertexAttribPointer(a_uv, 2, gl.FLOAT, false, 0, 0);

  // Get atlas manager for texture size
  const atlasManager = sceneRoot.getComponentByType(
    'atlas-manager',
    true,
  ) as AtlasManagerT | null;
  const atlasSize = atlasManager?.config.atlasSize ?? 1024;
  const atlasTextures = camera.glResources.atlasTextures;

  // Half-extents of the camera-relative off-screen reject below. Loop-invariant.
  //
  // Uses zoom², matching the shader's real clip-space scale: this file sets
  // u_viewportSize = viewport/zoom (above), and unified.vert applies another
  // `* u_zoom` to isoPos/viewPos before dividing by that -- net zoom²
  // relationship, already documented as `projScale = zoom * zoom` in
  // screen-pick/projection-math.ts and screen-pick/ray.ts. NOT zoom -- that was
  // this reject's bug (see the Colony Forever bug report
  // 010-sprite-edge-cull-zoom-formula-mismatch.md: at zoom < 1 the old linear
  // formula wrongly culled a zoom-proportional ring of sprites near the screen
  // edges that the shader would have actually placed on-screen).
  const zoomSquared = camera.zoom * camera.zoom;
  const halfW = viewport.width / (2 * zoomSquared) + EDGE_PAD_WORLD;
  const halfH = viewport.height / (2 * zoomSquared) + EDGE_PAD_WORLD;

  // Build the candidate list into reused scratch arrays: apply the per-sprite
  // skip checks (hidden / no nexus parent / no transform), carry the transform,
  // and compute each sprite's axonometric depth (matches the vertex shader:
  // rx + heightScale*y + rz, where rx/rz are worldX/Z rotated by orbit yaw).
  //
  // `spriteDraw` holds RAW data objects (see SpriteDrawData), resolved when the
  // sprite list was collected -- nothing in this loop or the next goes through
  // a component Proxy or looks a component up.
  const rawSprites = spriteDraw.rawSprites;
  const spriteTransforms = spriteDraw.transforms;
  const spriteSelfLit = spriteDraw.selfLit;
  const spriteTotal = rawSprites.length;
  if (drawDepths.length < spriteTotal) {
    let size = drawDepths.length;
    while (size < spriteTotal) size *= 2;
    drawDepths = new Float64Array(size);
  }
  let drawCount = 0;
  for (let si = 0; si < spriteTotal; si++) {
    const sprite = rawSprites[si];
    // Use `=== false` so any legacy sprite lacking the field still renders.
    if (sprite.visible === false) continue;
    // Null when the sprite has no nexus parent, or that nexus has no transform.
    const t = spriteTransforms[si];
    if (!t) continue;

    // Fog-of-war: an 'obscured' sprite's own phantom (a separate sprite,
    // spawned and disposed by fog-of-war's update(), see
    // src/component/fog-of-war/methods.ts) renders in its place, so the real
    // entity itself is skipped here -- its own update/gameplay logic keeps
    // running normally regardless, only its render draw call is skipped. A
    // sprite carrying its own vision-source always sees itself (defensive:
    // fog-of-war's update() already never obscures/phantoms such a sprite,
    // this is the render-time half of that same guarantee).
    //
    // 'obscured' and 'unseen' are skipped. An 'obscuring' sprite is deliberately
    // still drawn: it has reached zero visibility but its phantom is mid-spawn,
    // and it holds the memory look until the swap so the handover lands on one
    // frame instead of leaving a gap (see SpriteT._fowStatus).
    // Which shader branch this sprite takes, per fog state. See `fogDrawKind`
    // -- notably 'obscuring' draws as a MEMORY, because for those frames the
    // sprite IS the memory (its phantom does not exist yet) and must match the
    // branch the phantom will take at the swap.
    //
    // `spriteFogActive` and `trackedByFog` gate the 'unseen' skip: with no fog
    // component, no vision sources, or fog opted out per sprite, nothing ever
    // advances `_fowStatus` off its 'unseen' default and every sprite must still
    // draw.
    const drawKind = fogDrawKind(
      sprite._fowStatus,
      spriteSelfLit[si],
      sprite.trackedByFog !== false,
      spriteFogManagesSprites,
    );
    if (drawKind === 'skip') continue;
    const isMemory = drawKind === 'memory';

    // World position so a sprite under a transformed parent nexus is
    // placed/sorted by its composed world transform. A phantom sprite's own
    // transform is a frozen clone (see fog-of-war/methods.ts), so this is
    // its last-seen position without any extra handling needed here.
    const p = t.worldPosition;
    const pRx = p.x * cosYaw + p.z * sinYaw;
    const pRz = -p.x * sinYaw + p.z * cosYaw;

    // Camera-relative off-screen reject. Reuses this frame's already-computed
    // camIsoX/camIsoY (this camera's own iso-projected position, set above)
    // instead of routing through transform/on-screen.ts's resolveProjection/
    // worldToScreen, which would redundantly re-derive the same numbers
    // inside the hottest per-sprite loop in the renderer. Deliberately not
    // done in collect-renderables (see that module's comment) -- camera
    // position isn't tracked by the version-counter cache collection relies
    // on, so this filter must be re-evaluated fresh every draw, every frame.
    // (halfW/halfH, and why they use zoom², are above the loop.)
    const isoX = ISO_H * (pRx - pRz);
    const isoY = sinA * (pRx + pRz) - heightScale * p.y;
    if (Math.abs(isoX - camIsoX) > halfW || Math.abs(isoY - camIsoY) > halfH) {
      continue;
    }

    drawSprites[drawCount] = sprite;
    drawTransforms[drawCount] = t;
    // A phantom and the unmoved sprite it stands in for land at IDENTICAL
    // depth, and the sort below is stable, so their order would otherwise be
    // whatever collection order happened to produce. That is load-bearing
    // now: the phantom is the opaque backdrop its sprite fades in over, and a
    // phantom sorted after its sprite would hide that fade completely. Nudge
    // memory draws fractionally further away so they always sort first --
    // a pure tie-break, since the two are at the same world position.
    drawDepths[drawCount] =
      pRx + heightScale * p.y + pRz - (isMemory ? MEMORY_DEPTH_BIAS : 0);
    drawIsMemory[drawCount] = isMemory;
    drawCount++;
  }

  // Sprite-vs-sprite order is pure draw order (the sprite pass has the depth test
  // disabled). Stable-sort back-to-front by depth (larger depth = nearer the camera =
  // drawn last/on top). Stable, so a composited entity's layers (equal depth)
  // preserve their segmentedRenderOrderSort renderOrder. O(n log n) however far
  // the candidates' collection order is from their depth order -- which, for a
  // few thousand sprites spread over a map, is always a long way: an insertion
  // sort restarting from collection order every frame was quadratic here.
  const order = sortDrawOrder(drawDepths, drawCount);

  // Write one instance record per drawn sprite, in draw order, and group the
  // records into batches. Draw order is never changed to make a batch: a batch
  // is just a run of consecutive sprites whose atlas pages can all be bound at
  // once. It ends only when the next sprite needs a DIFFERENT page on a unit
  // the run has already claimed -- a sprite with no normal / emission /
  // material map samples nothing on that unit, so it never ends one.
  resetTextureMapMemo();
  beginSpritePalettes();
  const data = spriteInstanceBuffer(drawCount);
  let instanceCount = 0;
  let batchCount = 0;
  let batchStart = 0;
  let albedoPage = -1;
  let normalPage = -1;
  let emissionPage = -1;
  let materialPage = -1;
  // The remap whose slot was last looked up (sprites of one entity usually
  // share one), saving the table lookup.
  let lastPalette: PackedPalette | null = null;
  let lastPaletteSlot = 0;

  for (let oi = 0; oi < drawCount; oi++) {
    const di = order[oi];
    const sprite = drawSprites[di];
    const spriteTransform = drawTransforms[di];
    const isMemory = drawIsMemory[di];
    const sWorldPos = spriteTransform.worldPosition;

    // Fog COLOUR comes from distance -- the same point fog-of-war's sweep
    // tests, so a phantom and the sprite it stands in for (which share a
    // position) get the same number and therefore the same look.
    // 1.0 when fog isn't active, which the shader reads as fully visible.
    //
    // A COVERED phantom is fed 0 regardless. In the memory branch `fogVis`
    // drives nothing but the `spriteFogMemory && fogVis >= 1.0` discard
    // (colour there is `fadedRgb` unconditionally), and a covered phantom must
    // keep drawing until the sprite over it is fully opaque -- it is that
    // sprite's opaque backdrop. Without this it is discarded the moment its spot
    // reaches full vision, which on a fast approach is long before the fade-in
    // finishes, and the background shows through. An UNCOVERED phantom keeps its
    // real visibility and still discards under full vision: that is the "you
    // looked right at the spot and nothing is there" path.
    const phantomNexusId = spriteTransform.parent?.id;
    const isPhantom = sprite._fowStatus === 'phantom';
    const covered =
      isPhantom &&
      phantomNexusId !== undefined &&
      isPhantomCoveredBySprite(phantomNexusId);

    let spriteVis = 1;
    if (covered) {
      spriteVis = 0;
    } else if (
      fogMask &&
      fogCellDims &&
      fogCellSize &&
      fogWindowOriginLocalCell
    ) {
      spriteVis = computeFogVisibility(
        sWorldPos,
        // The shapes in this sprite's bin: exactly the set the shader walks
        // at its ground point.
        gatherShapesAt(
          visFrame.grid,
          visFrame.shapes,
          sWorldPos.x,
          sWorldPos.z,
          nearShapes,
        ),
        fogMask,
        fogCellDims,
        fogWindowOriginLocalCell,
        fogCellSize,
        fogUseLineOfSight,
      );
    }

    // Fog OPACITY comes from a timer, not from distance. A distance-driven
    // fade stalls part-way whenever the source stops closing and runs backwards
    // when it retreats; a timed one always completes. See fog-of-war/methods.ts.
    //
    // A phantom's opacity is derived from the presence of the sprite standing
    // over it wherever there is one, so the pair is complementary from a single
    // timer rather than two that have to stay in agreement.
    //
    // Branch on `isPhantom`, NOT on `isMemory` -- the two are not the same
    // set. An `'obscuring'` sprite also draws as a memory (it IS the memory
    // until its phantom lands), but it is a real sprite, so `phantomNexusId`
    // would be its own nexus and `phantomFogAlpha` would be asked about an id
    // that is not a phantom's. It happens to answer 1, which is what the hold
    // wants, but only by missing the lookup.
    const fogAlpha = isPhantom
      ? phantomNexusId !== undefined
        ? phantomFogAlpha(phantomNexusId)
        : 1
      : spriteFogPresence(sprite.id!);

    // Get albedo texture map (required)
    const textureMapKeys = sprite.textureMapKeys;
    if (!textureMapKeys.albedo) {
      console.warn(
        `[camera] Sprite '${sprite.name}' missing albedo texture, skipping`,
      );
      continue;
    }

    // Look up texture map by textureMapKey (not name!)
    const albedoTextureMap = lookupTextureMap(
      textureMapCache,
      CHANNEL_ALBEDO,
      textureMapKeys.albedo,
    );
    if (!albedoTextureMap) {
      console.warn(
        `[camera] Sprite '${sprite.name}' references textureMapKey '${textureMapKeys.albedo}' which was not found`,
      );
      continue;
    }
    if (albedoTextureMap.packedFrames.length === 0) {
      continue;
    }

    // Get packed frame for current albedo frame index
    const frames = sprite.frame;
    const albedoFrame = albedoTextureMap.frameIndexMap.get(frames.albedo);
    if (!albedoFrame) {
      console.warn(
        `[camera] Sprite '${sprite.name}' frame ${frames.albedo} not found in texture map`,
      );
      continue;
    }

    // Its atlas page must have a texture
    if (!atlasTextures[albedoFrame.atlasIndex]) {
      console.warn(
        `[camera] Sprite '${sprite.name}' atlas ${albedoFrame.atlasIndex} texture not found`,
      );
      continue;
    }

    // Optional channels: null (flag clear) on any failure.
    const normalFrame = optionalFrame(
      textureMapCache,
      CHANNEL_NORMAL,
      textureMapKeys.normal,
      frames.normal,
      atlasTextures,
    );
    const emissionFrame = optionalFrame(
      textureMapCache,
      CHANNEL_EMISSION,
      textureMapKeys.emission,
      frames.emission,
      atlasTextures,
    );
    const materialFrame = optionalFrame(
      textureMapCache,
      CHANNEL_MATERIAL,
      textureMapKeys.material,
      frames.material,
      atlasTextures,
    );

    // End the current batch if this sprite cannot share its bound pages.
    const needAlbedo = albedoFrame.atlasIndex;
    const needNormal = normalFrame ? normalFrame.atlasIndex : -1;
    const needEmission = emissionFrame ? emissionFrame.atlasIndex : -1;
    const needMaterial = materialFrame ? materialFrame.atlasIndex : -1;
    if (
      (albedoPage !== -1 && needAlbedo !== albedoPage) ||
      (needNormal !== -1 && normalPage !== -1 && needNormal !== normalPage) ||
      (needEmission !== -1 &&
        emissionPage !== -1 &&
        needEmission !== emissionPage) ||
      (needMaterial !== -1 &&
        materialPage !== -1 &&
        needMaterial !== materialPage)
    ) {
      pushBatch(
        batchCount++,
        batchStart,
        instanceCount - batchStart,
        albedoPage,
        normalPage,
        emissionPage,
        materialPage,
      );
      batchStart = instanceCount;
      normalPage = -1;
      emissionPage = -1;
      materialPage = -1;
    }
    albedoPage = needAlbedo;
    if (needNormal !== -1) normalPage = needNormal;
    if (needEmission !== -1) emissionPage = needEmission;
    if (needMaterial !== -1) materialPage = needMaterial;

    // The record. Layout: sprite-instances.ts.
    const o = instanceCount * SPRITE_INSTANCE_FLOATS;

    // Placement, from the cached WORLD transform (composed up the ancestry),
    // so nesting under a transformed parent moves/scales/rotates the sprite.
    const sWorldScale = spriteTransform.worldScale;
    const frameW = albedoFrame.size.x;
    const frameH = albedoFrame.size.y;
    data[o + SPRITE_OFFSET_POS_ROT] = sWorldPos.x;
    data[o + SPRITE_OFFSET_POS_ROT + 1] = sWorldPos.y;
    data[o + SPRITE_OFFSET_POS_ROT + 2] = sWorldPos.z;
    data[o + SPRITE_OFFSET_POS_ROT + 3] = spriteTransform.worldRotation.y;
    data[o + SPRITE_OFFSET_SIZE_ANCHOR] = frameW * sWorldScale.x;
    data[o + SPRITE_OFFSET_SIZE_ANCHOR + 1] = frameH * sWorldScale.y;
    // Normalize the pixel anchor (from the frame's top-left) to [0,1] for the shader,
    // which re-bases the centered quad around it (anchor pixel lands on the transform).
    const anchor = sprite.anchor;
    data[o + SPRITE_OFFSET_SIZE_ANCHOR + 2] =
      frameW !== 0 ? anchor.x / frameW : 0.5;
    data[o + SPRITE_OFFSET_SIZE_ANCHOR + 3] =
      frameH !== 0 ? anchor.y / frameH : 0.5;

    // UV bounds of each channel's frame in its atlas
    writeFrameUv(data, o + SPRITE_OFFSET_UV_ALBEDO, albedoFrame, atlasSize);
    writeFrameUv(data, o + SPRITE_OFFSET_UV_NORMAL, normalFrame, atlasSize);
    writeFrameUv(data, o + SPRITE_OFFSET_UV_EMISSION, emissionFrame, atlasSize);
    writeFrameUv(data, o + SPRITE_OFFSET_UV_MATERIAL, materialFrame, atlasSize);

    // Appearance
    const tint = sprite.tint;
    data[o + SPRITE_OFFSET_TINT] = tint.x;
    data[o + SPRITE_OFFSET_TINT + 1] = tint.y;
    data[o + SPRITE_OFFSET_TINT + 2] = tint.z;
    data[o + SPRITE_OFFSET_TINT + 3] = tint.w;
    const emissionColor = sprite.emissionColor;
    data[o + SPRITE_OFFSET_EMISSION] = emissionColor.x;
    data[o + SPRITE_OFFSET_EMISSION + 1] = emissionColor.y;
    data[o + SPRITE_OFFSET_EMISSION + 2] = emissionColor.z;
    data[o + SPRITE_OFFSET_EMISSION + 3] = sprite.emissionIntensity;

    // Palette remap: its slot in the shared table plus its entry count.
    const palette = spritePalette(sprite);
    let paletteSlot = 0;
    let paletteEntries = 0;
    if (palette) {
      if (palette !== lastPalette) {
        lastPalette = palette;
        lastPaletteSlot = spritePaletteSlot(palette);
      }
      paletteSlot = lastPaletteSlot;
      paletteEntries = palette.count;
    }

    const showSilhouette = !!sprite.showSilhouette;
    let flags = paletteEntries << SPRITE_PALETTE_COUNT_SHIFT;
    if (isMemory) flags |= SPRITE_FLAG_FOG_MEMORY;
    if (normalFrame) flags |= SPRITE_FLAG_NORMAL;
    if (emissionFrame) flags |= SPRITE_FLAG_EMISSION;
    if (materialFrame) flags |= SPRITE_FLAG_MATERIAL;
    if (showSilhouette) flags |= SPRITE_FLAG_SILHOUETTE;

    data[o + SPRITE_OFFSET_FOG] = sprite.opacity;
    data[o + SPRITE_OFFSET_FOG + 1] = spriteVis;
    data[o + SPRITE_OFFSET_FOG + 2] = fogAlpha;
    data[o + SPRITE_OFFSET_FOG + 3] = flags;
    data[o + SPRITE_OFFSET_IDS] = warnOversizedId(sprite.shaderId);
    data[o + SPRITE_OFFSET_IDS + 1] = paletteSlot;
    data[o + SPRITE_OFFSET_IDS + 2] = 0;
    data[o + SPRITE_OFFSET_IDS + 3] = 0;

    // Silhouette colour (read by the shader only when the flag is set)
    if (showSilhouette) {
      const silhouetteColor = sprite.silhouetteColor;
      data[o + SPRITE_OFFSET_SILHOUETTE] = silhouetteColor.x;
      data[o + SPRITE_OFFSET_SILHOUETTE + 1] = silhouetteColor.y;
      data[o + SPRITE_OFFSET_SILHOUETTE + 2] = silhouetteColor.z;
      data[o + SPRITE_OFFSET_SILHOUETTE + 3] = silhouetteColor.w;
    } else {
      data[o + SPRITE_OFFSET_SILHOUETTE] = 0;
      data[o + SPRITE_OFFSET_SILHOUETTE + 1] = 0;
      data[o + SPRITE_OFFSET_SILHOUETTE + 2] = 0;
      data[o + SPRITE_OFFSET_SILHOUETTE + 3] = 0;
    }

    instanceCount++;
  }
  if (instanceCount > batchStart) {
    pushBatch(
      batchCount++,
      batchStart,
      instanceCount - batchStart,
      albedoPage,
      normalPage,
      emissionPage,
      materialPage,
    );
  }
  resetTextureMapMemo();

  // Upload the records (and any new palette slots), then one instanced draw
  // per batch, back-to-front. A page is re-bound only when it changes, and a
  // channel's sampler is pointed at its unit only once a batch actually binds
  // something there -- exactly as before, an unused channel leaves both its
  // unit and its sampler uniform untouched.
  const uploaded =
    instanceCount > 0
      ? uploadSpriteInstances(gl, camera.id!, instanceCount)
      : null;
  if (uploaded) {
    let boundAlbedo = -1;
    let boundNormal = -1;
    let boundEmission = -1;
    let boundMaterial = -1;
    for (let b = 0; b < batchCount; b++) {
      const o = b * BATCH_INTS;
      const batchAlbedo = batches[o + 2];
      const batchNormal = batches[o + 3];
      const batchEmission = batches[o + 4];
      const batchMaterial = batches[o + 5];

      if (batchAlbedo !== boundAlbedo) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, atlasTextures[batchAlbedo]);
        if (boundAlbedo === -1) gl.uniform1i(u_albedoTexture, 0);
        boundAlbedo = batchAlbedo;
      }
      if (batchNormal !== -1 && batchNormal !== boundNormal) {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, atlasTextures[batchNormal]);
        if (boundNormal === -1) gl.uniform1i(u_normalTexture, 1);
        boundNormal = batchNormal;
      }
      if (batchEmission !== -1 && batchEmission !== boundEmission) {
        gl.activeTexture(gl.TEXTURE4);
        gl.bindTexture(gl.TEXTURE_2D, atlasTextures[batchEmission]);
        if (boundEmission === -1) gl.uniform1i(u_emissionTexture, 4);
        boundEmission = batchEmission;
      }
      if (batchMaterial !== -1 && batchMaterial !== boundMaterial) {
        gl.activeTexture(gl.TEXTURE5);
        gl.bindTexture(gl.TEXTURE_2D, atlasTextures[batchMaterial]);
        if (boundMaterial === -1) gl.uniform1i(u_materialTexture, 5);
        boundMaterial = batchMaterial;
      }

      // gl_InstanceID restarts at 0 for every draw; this is the batch's
      // first record.
      gl.uniform1i(uploaded.instanceBaseLoc, batches[o]);
      // Each instance is one quad (6 vertices = 2 triangles)
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, batches[o + 1]);
    }
  }

  // Restore depth mask state
  gl.depthMask(true);

  // Unbind the cell FBO's textures to prevent a feedback loop on the next
  // frame. That FBO uses these as its depth (TEXTURE2) and id (TEXTURE8)
  // attachments — if either is still bound as a sampler when we bindFramebuffer
  // for cell rendering, WebGL silently fails every draw call.
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.activeTexture(gl.TEXTURE8);
  gl.bindTexture(gl.TEXTURE_2D, null);
}
