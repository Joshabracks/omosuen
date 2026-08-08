import {
  ComponentData,
  ComponentOptions,
  ComponentSerializer,
  ComponentUnique,
  DeserializationError,
  DeserializeResult,
} from '../types';
import { Array3D, Array3Di, Vector3D } from '../../math';
import {
  Material,
  Mesh,
  ChunkMesh,
  packCell,
  unpackCell,
  createDefaultCellData,
  DEFAULT_CHUNK_SIZE,
} from './types';
import {
  initRenderWasm,
  cellStoreDump,
  cellStoreGet,
  setChunkSize,
} from '../camera/render/wasm';
import { CellWindow } from './window';
import type { ChunkGenerator, ChunkCoord } from './window';
import { ChunkColdStorage } from './cold-storage';
import type { CellData } from './types';

/**
 * Read-only view over the canonical cell store, exposed as `cellMap.packedData`
 * for consumer code that needs to read cells (e.g. counting visible cells for
 * stats). Read-only by design: mutation goes through `setCellData`, so the
 * RLE-compressed store can't be corrupted from outside.
 */
export interface CellPackedReadView {
  forEach(
    cb: (value: number, x: number, y: number, z: number, index: number) => void,
  ): void;
  get(coord: Vector3D): number;
}

// ── Module-level singleton storage ──
// Data lives here to avoid GC pressure and enable direct imports.
// The CellMapT instance delegates to these via getter/setter properties.
//
// This makes cell-map a genuine single-instance-per-engine component (like
// atlas-manager/audio-player/flag-manager) — the underlying WASM RLE cell
// store (see camera/render/wasm.ts) is itself a process-wide singleton, so
// per-instance JS-side storage wouldn't enable true multi-instance anyway.
// Unlike those other singletons, cell-map does NOT use Nexus's generic
// `unique: GLOBAL` dispose-on-add mechanism: that mechanism disposes the OLD
// instance *after* the NEW instance's builder() has already run, which would
// wipe the new instance's just-written data (both instances alias the same
// module bindings). Instead, `cmLive` below guards construction directly:
// building a second instance while one is live throws/errors immediately
// rather than silently overwriting the first.
let cmLive = false;

export let cmMaterials: Material[] = [];
export let cmMaterialMap: Array3D<number>;
export let cmShapeMap: Array3D<number>;
export let cmMeshes: Mesh[] = [];
export let cmEmissionMap: Array3D<number>;
/**
 * Per-cell emission (highlight) color, packed as (r<<16)|(g<<8)|b (0-255/channel;
 * 0 = black = no highlight). Sampled GPU-side as a texture keyed by cell coordinate,
 * so — unlike emissionMap (baked into vertices) — changing it needs no remesh.
 */
export let cmEmissionColorMap: Array3D<number>;
/** Set when cmEmissionColorMap changes so the render pass rebuilds the GPU texture. */
export let cmEmissionColorDirty: boolean = true;
export let cmVisibilityMap: Array3D<boolean>;
export let cmCellSize: Vector3D;
export let cmMapSize: Vector3D;
/**
 * Chunk size in cells per axis. Runtime-configurable (see `DEFAULT_CHUNK_SIZE`
 * in `./types` and `setChunkSize` in `camera/render/wasm`) rather than the
 * fixed compile-time constant it used to be — set once at construction/
 * deserialize time and mirrored into the WASM mesher, which is the actual
 * single source of truth for chunk boundaries at mesh-build time.
 */
export let cmChunkSize: Vector3D;
export let cmSmoothing: number = 0;
export let cmSmoothingWeights: Array3Di;
export let cmNormalSmoothing: number = 0;
export let cmNeedsGPUUpdate: boolean = true;
export let cmChunks: ChunkMesh[] = [];
export let cmChunkGridSize: { x: number; y: number; z: number } = {
  x: 0,
  y: 0,
  z: 0,
};
export let cmRevealExempt: boolean = false;
/**
 * When true (default), the render loop drives `CellMap.setFocus` from the
 * camera position every frame, so the window follows the camera with no
 * game code required. Set false for explicit control via `CellMap.setFocus`
 * instead — see `.design/cell-map-overhaul/11-focus-driving.md`.
 */
export let cmAutoFocusFromCamera: boolean = true;
/**
 * When true, the render loop drives `CellMap.setWindowRadius` from the
 * camera's zoom level every frame, growing the window when zoomed out (so
 * the resident/generated extent keeps pace with what's visible on screen)
 * and shrinking it back when zoomed in. Companion to `autoFocusFromCamera`
 * and defaulted the same way (see `builder()`/`builderGenerative()`/
 * `deserialize()`) — off for a legacy map using the auto-computed coverage
 * radius, since that window is already sized to hold the whole map. See
 * `maxWindowRadius` for the growth cap.
 */
export let cmAutoResizeFromZoom: boolean = true;
/**
 * Safety cap on how far `autoResizeFromZoom` (or a direct
 * `CellMap.setWindowRadius` call) is ever allowed to grow the window's
 * radius, expressed as a maximum world-space radius per axis (NOT chunks --
 * converted to a chunk radius internally via `CellMap.setWindowRadius`,
 * floor-divided by `chunkSize * cellSize`). A resize's assemble step can call
 * `generateCell` for every newly-exposed chunk synchronously in one frame,
 * so this is deliberately modest — see `.design/cell-map-overhaul` (runtime
 * window resizing).
 */
export let cmMaxTerrainLoadDimensions: { x: number; y: number; z: number } = {
  x: 512,
  y: 512,
  z: 512,
};
/**
 * Padding, in chunks, added beyond the bare viewport-at-current-zoom extent
 * when `autoResizeFromZoom` computes a residency target and when the render
 * loop's per-chunk draw cull computes its view cuboid — an intentional,
 * developer-facing "how far should the world render" setting, independent of
 * viewport shape/orbit yaw. See `.design/cell-map-overhaul` (render-distance
 * cuboid + per-chunk cull).
 */
export let cmRenderDistance: { x: number; y: number; z: number } = {
  x: 1,
  y: 1,
  z: 1,
};
/**
 * Diagnostic-only additive padding, in WORLD UNITS (not chunks), added
 * directly to the render loop's already-computed render-volume half-extents
 * (halfIsoX/halfIsoY/halfIsoZ, one per world axis) -- a raw "just add this
 * many units" knob, separate from `renderDistance`'s chunk-based semantics,
 * meant for live tuning via a debug UI while diagnosing the render volume.
 * Default `{0,0,0}` is a no-op.
 */
export let cmFrustumPadding: { x: number; y: number; z: number } = {
  x: 0,
  y: 0,
  z: 0,
};
/**
 * Owns the shiftable hot window's origin and orchestrates shifts (evict/
 * assemble/reload). See `.design/cell-map-overhaul/08-live-construction-and-
 * ownership.md`. `undefined` until first construction.
 */
export let cmWindow: CellWindow | undefined;
/** Everything outside the current window that diverges from baseline. Owned
 *  jointly with `cmWindow` (constructed together, always non-null together). */
export let cmColdStorage: ChunkColdStorage | undefined;

/**
 * Packed value for "nothing here" — material 0, shape 0 (air), no emission,
 * not visible. The baseline every chunk is compared against to decide
 * whether it needs a cold-storage entry at all.
 */
const EMPTY_CELL = packCell({
  materialIndex: 0,
  shapeIndex: 0,
  emissionIntensity: 0,
  visible: false,
});

/**
 * Stable read-only view over the canonical WASM cell store, returned by the
 * `cellMap.packedData` getter. Reused (no per-access allocation).
 */
const packedDataView: CellPackedReadView = {
  forEach(cb): void {
    const flat = cellStoreDump();
    const mx = cmMapSize.x;
    const my = cmMapSize.y;
    let x = 0;
    let y = 0;
    let z = 0;
    for (let i = 0; i < flat.length; i++) {
      cb(flat[i], x, y, z, i);
      x++;
      if (x >= mx) {
        x = 0;
        y++;
        if (y >= my) {
          y = 0;
          z++;
        }
      }
    }
  },
  get(coord: Vector3D): number {
    return cellStoreGet(coord.x, coord.y, coord.z);
  },
};

/**
 * Resets all module-level cell-map state to defaults.
 * Called by dispose to release memory.
 */
export function resetCellMapState(): void {
  cmLive = false;
  cmMaterials = [];
  cmMaterialMap = undefined!;
  cmShapeMap = undefined!;
  cmMeshes = [];
  cmEmissionMap = undefined!;
  cmEmissionColorMap = undefined!;
  cmEmissionColorDirty = true;
  cmVisibilityMap = undefined!;
  cmCellSize = undefined!;
  cmMapSize = undefined!;
  cmChunkSize = undefined!;
  cmSmoothing = 0;
  cmSmoothingWeights = undefined!;
  cmNormalSmoothing = 0;
  cmNeedsGPUUpdate = true;
  cmChunks = [];
  cmChunkGridSize = { x: 0, y: 0, z: 0 };
  cmRevealExempt = false;
  cmAutoFocusFromCamera = true;
  cmAutoResizeFromZoom = true;
  cmMaxTerrainLoadDimensions = { x: 512, y: 512, z: 512 };
  cmRenderDistance = { x: 1, y: 1, z: 1 };
  cmFrustumPadding = { x: 0, y: 0, z: 0 };
  cmWindow = undefined;
  cmColdStorage = undefined;
  cmPendingBufferCleanup = [];
}

/**
 * Creates a CellMapT instance with getter/setter properties
 * that delegate to module-level variables.
 */
function makeCellMapInstance(name: string): CellMapT {
  return {
    name,
    type: 'cell-map',
    // Deliberately FALSE, not GLOBAL: Nexus's generic GLOBAL-uniqueness
    // dispose-on-add would run after this instance's data is already written
    // into the shared module bindings and would corrupt it (see module
    // comment above `cmLive`). The `cmLive` guard in builder()/deserialize()
    // enforces the singleton invariant instead.
    unique: ComponentUnique.FALSE,
    parent: null,
    get materials() {
      return cmMaterials;
    },
    set materials(v) {
      cmMaterials = v;
    },
    get materialMap() {
      return cmMaterialMap;
    },
    set materialMap(v) {
      cmMaterialMap = v;
    },
    get shapeMap() {
      return cmShapeMap;
    },
    set shapeMap(v) {
      cmShapeMap = v;
    },
    get meshes() {
      return cmMeshes;
    },
    set meshes(v) {
      cmMeshes = v;
    },
    get emissionMap() {
      return cmEmissionMap;
    },
    set emissionMap(v) {
      cmEmissionMap = v;
    },
    get emissionColorMap() {
      return cmEmissionColorMap;
    },
    set emissionColorMap(v) {
      cmEmissionColorMap = v;
    },
    get emissionColorDirty() {
      return cmEmissionColorDirty;
    },
    set emissionColorDirty(v) {
      cmEmissionColorDirty = v;
    },
    get visibilityMap() {
      return cmVisibilityMap;
    },
    set visibilityMap(v) {
      cmVisibilityMap = v;
    },
    get cellSize() {
      return cmCellSize;
    },
    set cellSize(v) {
      cmCellSize = v;
    },
    get mapSize() {
      return cmMapSize;
    },
    set mapSize(v) {
      cmMapSize = v;
    },
    get chunkSize() {
      return cmChunkSize;
    },
    set chunkSize(v) {
      cmChunkSize = v;
    },
    get packedData() {
      return packedDataView;
    },
    get window() {
      // Non-null once construction has completed (both builder() and
      // deserialize() assign it before returning) — the `!` mirrors how
      // `packedData`'s backing store is likewise always-live post-construction.
      return cmWindow!;
    },
    get smoothing() {
      return cmSmoothing;
    },
    set smoothing(v) {
      cmSmoothing = v;
    },
    get smoothingWeights() {
      return cmSmoothingWeights;
    },
    set smoothingWeights(v) {
      cmSmoothingWeights = v;
    },
    get normalSmoothing() {
      return cmNormalSmoothing;
    },
    set normalSmoothing(v) {
      cmNormalSmoothing = v;
    },
    get needsGPUUpdate() {
      return cmNeedsGPUUpdate;
    },
    set needsGPUUpdate(v) {
      cmNeedsGPUUpdate = v;
    },
    get chunks() {
      return cmChunks;
    },
    set chunks(v) {
      cmChunks = v;
    },
    get chunkGridSize() {
      return cmChunkGridSize;
    },
    set chunkGridSize(v) {
      cmChunkGridSize = v;
    },
    get revealExempt() {
      return cmRevealExempt;
    },
    set revealExempt(v) {
      cmRevealExempt = v;
    },
    get autoFocusFromCamera() {
      return cmAutoFocusFromCamera;
    },
    set autoFocusFromCamera(v) {
      cmAutoFocusFromCamera = v;
    },
    get autoResizeFromZoom() {
      return cmAutoResizeFromZoom;
    },
    set autoResizeFromZoom(v) {
      cmAutoResizeFromZoom = v;
    },
    get maxTerrainLoadDimensions() {
      return cmMaxTerrainLoadDimensions;
    },
    set maxTerrainLoadDimensions(v) {
      cmMaxTerrainLoadDimensions = v;
    },
    get renderDistance() {
      return cmRenderDistance;
    },
    set renderDistance(v) {
      cmRenderDistance = v;
    },
    get frustumPadding() {
      return cmFrustumPadding;
    },
    set frustumPadding(v) {
      cmFrustumPadding = v;
    },
  } as CellMapT;
}

export interface CellMapOptions extends ComponentOptions {
  /**
   * Array of material definitions (required)
   * Each material references 4 TextureMap component IDs
   */
  materials: Material[];

  /**
   * Map of material indices per cell. Required together with `mapSize` for
   * the legacy hand-authored-map construction path (must match `mapSize`
   * dimensions) — omit both for the generative path (`generateCell`/
   * `generateChunk`), or for a purely-empty map authored entirely via
   * `setCellData` after construction.
   */
  materialMap?: Array3D<number>;

  /**
   * Map of shape indices per cell (optional)
   * 0 = air/empty, 1 = default cube
   * Defaults to 1 (cube) everywhere if not provided
   */
  shapeMap?: Array3D<number>;

  /**
   * Array of custom mesh definitions (optional)
   * Index 0 = reserved for air
   * Index 1 = default cube (auto-generated if not provided)
   */
  meshes?: Mesh[];

  /**
   * Map of emission intensity per cell (optional, 0-31)
   * Defaults to 0 everywhere if not provided
   */
  emissionMap?: Array3D<number>;

  /**
   * Map of per-cell emission (highlight) color per cell (optional). Each value packs
   * RGB as (r<<16)|(g<<8)|b (0-255/channel). Defaults to 0 (black = no highlight).
   */
  emissionColorMap?: Array3D<number>;

  /**
   * Map of visibility flags per cell (optional)
   * Defaults to true everywhere if not provided
   */
  visibilityMap?: Array3D<boolean>;

  /**
   * Size of a single cell (width, depth, height)
   */
  cellSize: Vector3D;

  /**
   * Dimensions of the (legacy, hand-authored) map in cells. Required together
   * with `materialMap`; omit both for the generative path. Note this is
   * *not* what `cellMap.mapSize` reads back as post-construction — that now
   * reflects the resident window's size (see `CellMapT.mapSize`), since a
   * legacy map larger than the window can't all be resident simultaneously.
   */
  mapSize?: Vector3D;

  /**
   * Chunk size in cells per axis, for mesh batching (optional). Defaults to
   * `DEFAULT_CHUNK_SIZE` (see `./types`). Not safe to change on an existing
   * cell-map — pick this once, at construction/deserialize time.
   */
  chunkSize?: Vector3D;

  /**
   * Padding radius in chunks, per axis, for the shiftable hot window around
   * the current focus point (default: `{x:1,y:1,z:1}`, a 3x3x3-chunk
   * window) — see `CellWindow` (`./window.ts`). For the legacy path
   * (`mapSize`+`materialMap` supplied), if this is omitted, it's computed
   * automatically large enough to cover the entire authored `mapSize`, so a
   * legacy map keeps rendering in full exactly as it does today; supplying
   * an explicit (smaller) radius opts a legacy map into windowed behavior —
   * content outside the window simply won't be resident until something
   * moves the focus there.
   */
  windowRadius?: { x: number; y: number; z: number };

  /**
   * Generates a single cell's data at a world cell coordinate (the
   * generative path's per-cell baseline — see
   * `.design/cell-map-overhaul/04-procedural-generation.md`, now archived
   * under `completed_tasks`). Returning `undefined` falls back to empty/air.
   * Always used for single-cell point queries, regardless of whether
   * `generateChunk` is also supplied. Must be a pure function of its
   * coordinates for a given world/seed.
   */
  generateCell?: (
    worldX: number,
    worldY: number,
    worldZ: number,
  ) => CellData | undefined;

  /**
   * Generates a whole chunk's cell data at once (`chunkSize.x*y*z`-length
   * array, x-fastest/y/z-slowest local order) — a performance escape hatch
   * for whole-chunk materialization, preferred over looping `generateCell`
   * when both are supplied. Never used for single-cell point queries.
   */
  generateChunk?: (cx: number, cy: number, cz: number) => CellData[];

  /**
   * Number of surface-net smoothing iterations (0 or less = no smoothing)
   */
  smoothing?: number;

  /**
   * Per-cell smoothing weights (0-15, mapped to 0.0-1.0 internally).
   * - number: uniform weight for all cells (default 8)
   * - Array3D<number>: per-cell weights, stored as Array3Di(bitWidth:8, packing:[4,4], overflow:clamp)
   */
  smoothingWeights?: number | Array3D<number>;

  /**
   * Normal smoothing weight (0-1). 0 = flat per-face normals (default),
   * 1 = fully averaged per-vertex normals, values in between lerp.
   */
  normalSmoothing?: number;

  /** If true, this cell-map is exempt from Y-slice reveal clipping (default: false) */
  revealExempt?: boolean;

  /**
   * When true (default), the render loop drives the window's focus from the
   * camera position every frame — the window follows the camera with no game
   * code required. Set false to drive focus explicitly via
   * `CellMap.setFocus(component, worldX, worldY, worldZ)` instead. See
   * `.design/cell-map-overhaul/11-focus-driving.md`.
   */
  autoFocusFromCamera?: boolean;

  /**
   * When true, the render loop drives the window's radius from the camera's
   * zoom level every frame, growing it when zoomed out and shrinking it back
   * when zoomed in (capped by `maxWindowRadius`). Companion to
   * `autoFocusFromCamera`, defaulted the same way (off for a legacy map
   * using the auto-computed coverage radius, on otherwise). Set false to
   * drive it explicitly via `CellMap.setWindowRadius` instead.
   */
  autoResizeFromZoom?: boolean;

  /**
   * Safety cap on how far `autoResizeFromZoom` (or a direct
   * `CellMap.setWindowRadius` call) is ever allowed to grow the window's
   * radius, as a maximum world-space radius per axis (not chunks — converted
   * internally by floor-dividing by `chunkSize * cellSize`). Defaults to
   * `{x:512, y:512, z:512}`. Deliberately modest — a resize's assemble step
   * can call `generateCell` for every newly-exposed chunk synchronously in
   * one frame.
   */
  maxTerrainLoadDimensions?: { x: number; y: number; z: number };

  /**
   * Per-world-axis render distance, in chunks: the render loop's render
   * volume is a plain axis-aligned world-space box centered on the camera,
   * with independent half-extents on X/Y/Z (`renderDistance.axis *
   * chunkSize.axis * cellSize.axis`, plus `frustumPadding.axis`) — NOT
   * derived from the viewport, zoom, or camera rotation, so the same
   * settings render the same volume no matter how the camera is oriented.
   * Used both when `autoResizeFromZoom` computes a residency target and when
   * the render loop's per-chunk draw cull computes its render volume — an
   * intentional, developer-facing "how far should the world render" setting.
   * Defaults to `{x:1, y:1, z:1}`.
   */
  renderDistance?: { x: number; y: number; z: number };

  /**
   * Diagnostic-only additive padding, in world units (not chunks), added
   * directly to the render loop's render-volume half-extents (halfIsoX/
   * halfIsoY/halfIsoZ, one per world axis) — a raw tuning knob, separate from
   * `renderDistance`'s chunk-based semantics. Defaults to `{x:0, y:0, z:0}`
   * (no-op).
   */
  frustumPadding?: { x: number; y: number; z: number };
}

export interface CellMapT extends ComponentData {
  type: 'cell-map';
  unique: ComponentUnique.FALSE;

  // Material definitions
  materials: Material[];

  // Input maps (preserved for reference)
  materialMap: Array3D<number>;
  shapeMap: Array3D<number>;
  meshes: Mesh[];
  emissionMap: Array3D<number>;
  /** Per-cell emission (highlight) color, packed (r<<16)|(g<<8)|b. 0 = no highlight. */
  emissionColorMap: Array3D<number>;
  /** Dirty flag: emissionColorMap changed → render pass rebuilds the GPU texture. */
  emissionColorDirty: boolean;
  visibilityMap: Array3D<boolean>;

  // World configuration
  cellSize: Vector3D;
  /**
   * Size, in cells, of the currently-resident hot window — *not* the whole
   * world. Constant for the session (window size never changes; only its
   * origin does, once something moves the focus — see `window`). Renamed in
   * meaning, not in name, from the pre-windowing "whole map" semantics; see
   * `.design/cell-map-overhaul/08-live-construction-and-ownership.md`.
   */
  mapSize: Vector3D;
  /** Chunk size in cells per axis. See `CellMapOptions.chunkSize`. */
  chunkSize: Vector3D;

  /** Read-only view over the canonical cell store (see CellPackedReadView). */
  packedData: CellPackedReadView;

  /** Owns the shiftable hot window's origin; see `./window.ts`'s `CellWindow`. */
  window: CellWindow;

  // Smoothing
  smoothing: number;
  smoothingWeights: Array3Di;
  normalSmoothing: number;

  // GPU sync
  needsGPUUpdate: boolean;

  // Chunk-based rendering
  chunks: ChunkMesh[];
  chunkGridSize: { x: number; y: number; z: number };

  /** If true, this cell-map is exempt from Y-slice reveal clipping. Default: false */
  revealExempt: boolean;

  /** See `CellMapOptions.autoFocusFromCamera`. */
  autoFocusFromCamera: boolean;

  /** See `CellMapOptions.autoResizeFromZoom`. */
  autoResizeFromZoom: boolean;

  /** See `CellMapOptions.maxTerrainLoadDimensions`. */
  maxTerrainLoadDimensions: { x: number; y: number; z: number };

  /** See `CellMapOptions.renderDistance`. */
  renderDistance: { x: number; y: number; z: number };

  /** See `CellMapOptions.frustumPadding`. */
  frustumPadding: { x: number; y: number; z: number };
}

/**
 * Generates a default cube mesh with unit dimensions
 * Centered at origin, 24 vertices (4 per face for proper normals/UVs)
 */
export function generateDefaultCubeMesh(): Mesh {
  // 24 vertices (4 per face) for proper normals and UVs
  const vertices = new Float32Array([
    // Front face (z = 0.5)
    -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
    // Back face (z = -0.5)
    0.5, -0.5, -0.5, -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5,
    // Top face (y = 0.5)
    -0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5,
    // Bottom face (y = -0.5)
    -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5, -0.5, 0.5,
    // Right face (x = 0.5)
    0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5,
    // Left face (x = -0.5)
    -0.5, -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5,
  ]);

  // UVs: per-face 0-1, V flipped to atlas convention. The atlas samples v=0 at the
  // frame's image-top (UNPACK_FLIP_Y is off), so v=0 must sit at each face's TOP
  // vertex — otherwise a vertically-asymmetric tile (e.g. grass-cap) renders upside
  // down. Vertex order per face is bottom, bottom, top, top → UVs (0,1),(1,1),(1,0),(0,0).
  const uvs = new Float32Array([
    // Front
    0, 1, 1, 1, 1, 0, 0, 0,
    // Back
    0, 1, 1, 1, 1, 0, 0, 0,
    // Top
    0, 1, 1, 1, 1, 0, 0, 0,
    // Bottom
    0, 1, 1, 1, 1, 0, 0, 0,
    // Right
    0, 1, 1, 1, 1, 0, 0, 0,
    // Left
    0, 1, 1, 1, 1, 0, 0, 0,
  ]);

  // Indices: 6 faces × 2 triangles × 3 vertices = 36 indices

  const indices = new Uint16Array([
    0,
    1,
    2,
    0,
    2,
    3, // Front
    4,
    5,
    6,
    4,
    6,
    7, // Back
    8,
    9,
    10,
    8,
    10,
    11, // Top
    12,
    13,
    14,
    12,
    14,
    15, // Bottom
    16,
    17,
    18,
    16,
    18,
    19, // Right
    20,
    21,
    22,
    20,
    22,
    23, // Left
  ]);

  return { vertices, uvs, indices };
}

/**
 * Property allowlist for CellMap component
 * Defines which properties can be accessed directly on the component
 */
export const PROPERTY_ALLOWLIST = [
  'materials',
  'materialMap',
  'shapeMap',
  'meshes',
  'emissionMap',
  'emissionColorMap',
  'emissionColorDirty',
  'visibilityMap',
  'cellSize',
  'mapSize',
  'chunkSize',
  'packedData',
  'window',
  'needsGPUUpdate',
  'chunks',
  'chunkGridSize',
  'smoothing',
  'smoothingWeights',
  'normalSmoothing',
  'revealExempt',
  'autoFocusFromCamera',
  'autoResizeFromZoom',
  'maxTerrainLoadDimensions',
  'renderDistance',
  'frustumPadding',
];

/** A fresh, dirty chunk mesh for the given window-local chunk coordinate. */
function freshChunkMesh(cx: number, cy: number, cz: number): ChunkMesh {
  return {
    cx,
    cy,
    cz,
    dirty: true,
    gpuDirty: true,
    vertices: null,
    stride: 9,
    indices: null,
    drawRanges: [],
    faceCount: 0,
    glVertexBuffer: null,
    glIndexBuffer: null,
  };
}

/**
 * Initializes chunk array with all chunks marked dirty.
 */
export function initChunks(cgs: {
  x: number;
  y: number;
  z: number;
}): ChunkMesh[] {
  const result: ChunkMesh[] = [];
  for (let cz = 0; cz < cgs.z; cz++) {
    for (let cy = 0; cy < cgs.y; cy++) {
      for (let cx = 0; cx < cgs.x; cx++) {
        result.push(freshChunkMesh(cx, cy, cz));
      }
    }
  }
  return result;
}

/**
 * Chunks evicted from the resident window whose GPU buffers still need
 * `gl.deleteBuffer`ing. `data.ts` has no GL context of its own, so the
 * renderer drains this once per frame via `CellMap.takePendingBufferCleanup`
 * and does the actual deletion.
 */
let cmPendingBufferCleanup: ChunkMesh[] = [];

export function queueBufferCleanup(chunks: ChunkMesh[]): void {
  cmPendingBufferCleanup.push(...chunks);
}

/** Drains and returns the chunks queued for GPU buffer cleanup since the last call. */
export function takePendingBufferCleanup(): ChunkMesh[] {
  const pending = cmPendingBufferCleanup;
  cmPendingBufferCleanup = [];
  return pending;
}

export interface ReassembleResult {
  chunks: ChunkMesh[];
  evicted: ChunkMesh[];
}

/**
 * A chunk mesh's `vertices` bake in its WINDOW-LOCAL position at build time
 * (the WASM mesher is called with the chunk's local `cx/cy/cz`, and the
 * vertex shader only adds the window's own origin offset on top -- see
 * `unified.vert`'s `worldPos = a_position + u_worldOffset`). So a chunk
 * reused at a *different* local slot (its world-chunk-coordinate stayed
 * resident, but the window shifted under it) renders at the wrong place
 * unless its already-built vertex data is translated by the local-slot
 * delta first. Only the position fields need it -- pos3 at offset 0 and
 * origPos3 at offset 6 in the stride-10/12 interleaved layout; normal3,
 * emission, and uv are orientation/material data, unaffected by a
 * translation. Cheap (a linear float-array walk, no WASM call) compared to
 * the remesh this is standing in for.
 */
function translateChunkMeshInPlace(
  chunk: ChunkMesh,
  dx: number,
  dy: number,
  dz: number,
): void {
  const v = chunk.vertices;
  if (!v) return;
  const stride = chunk.stride;
  for (let i = 0; i < v.length; i += stride) {
    v[i] += dx;
    v[i + 1] += dy;
    v[i + 2] += dz;
    v[i + 6] += dx;
    v[i + 7] += dy;
    v[i + 8] += dz;
  }
}

/**
 * Rebuilds the window-local chunk-mesh array for a shift/resize from
 * `oldOrigin` to `newOrigin`/`newGridDims`, mirroring `CellWindow`'s own
 * private `reassemble` (same world-chunk-coordinate overlap test, applied to
 * JS mesh objects instead of WASM cell data): a chunk whose world-chunk-
 * coordinate stays resident keeps its already-built mesh -- translated
 * in-place to its new local slot (see `translateChunkMeshInPlace`) and
 * re-flagged `gpuDirty` so the translated data actually reaches the GPU,
 * but never re-meshed. A chunk that just left the window is returned
 * separately as `evicted` for the caller to clean up (this function does
 * not cache them -- see `.design/chunk-buffering/05-mesh-cache.md`). A
 * chunk that just entered the window gets a fresh `dirty` entry (same shape
 * `initChunks` produces) -- and, in turn, re-dirties any REUSED neighbor
 * sharing a face with it, since that neighbor's mesh was built without
 * knowledge of this newly-available data and its cross-chunk face culling
 * at that boundary is now stale (see the face-adjacency pass below). Serves
 * both a same-size shift (`CellMap.setFocus`) and a resize
 * (`CellMap.setWindowRadius`), same as `CellWindow.reassemble` does for
 * cell data.
 */
export function reassembleChunks(
  oldChunks: ChunkMesh[],
  oldOrigin: ChunkCoord | null,
  newOrigin: ChunkCoord,
  newGridDims: { x: number; y: number; z: number },
  chunkSize: { x: number; y: number; z: number },
  cellSize: { x: number; y: number; z: number },
): ReassembleResult {
  interface OldEntry {
    chunk: ChunkMesh;
    wcx: number;
    wcy: number;
    wcz: number;
  }
  const key = (cx: number, cy: number, cz: number): string =>
    `${cx},${cy},${cz}`;

  const oldByWorldCoord = new Map<string, OldEntry>();
  if (oldOrigin) {
    for (const chunk of oldChunks) {
      const wcx = oldOrigin.cx + chunk.cx;
      const wcy = oldOrigin.cy + chunk.cy;
      const wcz = oldOrigin.cz + chunk.cz;
      oldByWorldCoord.set(key(wcx, wcy, wcz), { chunk, wcx, wcy, wcz });
    }
  }

  const chunks: ChunkMesh[] = [];
  const isNewSlot: boolean[] = [];
  for (let cz = 0; cz < newGridDims.z; cz++) {
    for (let cy = 0; cy < newGridDims.y; cy++) {
      for (let cx = 0; cx < newGridDims.x; cx++) {
        const wcx = newOrigin.cx + cx;
        const wcy = newOrigin.cy + cy;
        const wcz = newOrigin.cz + cz;
        const entryKey = key(wcx, wcy, wcz);
        const entry = oldByWorldCoord.get(entryKey);
        if (entry) {
          oldByWorldCoord.delete(entryKey); // consumed
          const { chunk } = entry;
          if (chunk.cx !== cx || chunk.cy !== cy || chunk.cz !== cz) {
            translateChunkMeshInPlace(
              chunk,
              (cx - chunk.cx) * chunkSize.x * cellSize.x,
              (cy - chunk.cy) * chunkSize.y * cellSize.y,
              (cz - chunk.cz) * chunkSize.z * cellSize.z,
            );
            chunk.gpuDirty = true;
            chunk.cx = cx;
            chunk.cy = cy;
            chunk.cz = cz;
          }
          chunks.push(chunk);
          isNewSlot.push(false);
        } else {
          chunks.push(freshChunkMesh(cx, cy, cz));
          isNewSlot.push(true);
        }
      }
    }
  }

  // A newly-exposed chunk's reused neighbors were meshed without knowledge
  // of it (cross-chunk face culling depends on the neighbor's actual data,
  // and a reused chunk at the old window's edge previously had no neighbor
  // there at all) -- mark those reused neighbors dirty too, so the shared
  // boundary gets recomputed with both sides known. Mirrors
  // `markChunksDirty`'s per-edit face adjacency (mesh-builder.ts), applied
  // structurally here instead of per-edit.
  const localIndex = (cx: number, cy: number, cz: number): number =>
    cz * newGridDims.y * newGridDims.x + cy * newGridDims.x + cx;
  for (let cz = 0; cz < newGridDims.z; cz++) {
    for (let cy = 0; cy < newGridDims.y; cy++) {
      for (let cx = 0; cx < newGridDims.x; cx++) {
        if (!isNewSlot[localIndex(cx, cy, cz)]) continue;
        if (cx > 0) {
          const i = localIndex(cx - 1, cy, cz);
          if (!isNewSlot[i]) chunks[i].dirty = true;
        }
        if (cx < newGridDims.x - 1) {
          const i = localIndex(cx + 1, cy, cz);
          if (!isNewSlot[i]) chunks[i].dirty = true;
        }
        if (cy > 0) {
          const i = localIndex(cx, cy - 1, cz);
          if (!isNewSlot[i]) chunks[i].dirty = true;
        }
        if (cy < newGridDims.y - 1) {
          const i = localIndex(cx, cy + 1, cz);
          if (!isNewSlot[i]) chunks[i].dirty = true;
        }
        if (cz > 0) {
          const i = localIndex(cx, cy, cz - 1);
          if (!isNewSlot[i]) chunks[i].dirty = true;
        }
        if (cz < newGridDims.z - 1) {
          const i = localIndex(cx, cy, cz + 1);
          if (!isNewSlot[i]) chunks[i].dirty = true;
        }
      }
    }
  }

  // Anything left in oldByWorldCoord fell outside the new window.
  const evicted = Array.from(oldByWorldCoord.values(), (e) => e.chunk);
  return { chunks, evicted };
}

/**
 * Wraps `CellData`-returning generator callbacks (the public
 * `CellMapOptions` shape) into `CellWindow`'s raw-packed-number
 * `ChunkGenerator` — `window.ts` is deliberately decoupled from cell-map's
 * own types, so this bridge (via `packCell`) lives here instead.
 */
function wrapGenerator(
  generateCell?: (x: number, y: number, z: number) => CellData | undefined,
  generateChunk?: (cx: number, cy: number, cz: number) => CellData[],
): ChunkGenerator | undefined {
  if (!generateCell && !generateChunk) return undefined;
  const wrapped: ChunkGenerator = {};
  if (generateCell) {
    wrapped.generateCell = (x, y, z) => {
      const cd = generateCell(x, y, z);
      return cd ? packCell(cd) : undefined;
    };
  }
  if (generateChunk) {
    wrapped.generateChunk = (cx, cy, cz) => {
      const cells = generateChunk(cx, cy, cz);
      const out = new Uint32Array(cells.length);
      for (let i = 0; i < cells.length; i++) out[i] = packCell(cells[i]);
      return out;
    };
  }
  return wrapped;
}

/**
 * Smallest radius (chunks of padding per axis) such that a window centered
 * on it fully covers a legacy map spanning `legacyGridDims` chunks — i.e.
 * `2*radius+1 >= legacyGridDims` per axis. Used so the legacy construction
 * path's default window covers the *entire* authored map (matching today's
 * "everything is always resident" behavior) unless the caller explicitly
 * opts into a smaller `windowRadius`.
 */
function computeCoverageRadius(legacyGridDims: {
  x: number;
  y: number;
  z: number;
}): { x: number; y: number; z: number } {
  return {
    x: Math.max(0, Math.ceil((legacyGridDims.x - 1) / 2)),
    y: Math.max(0, Math.ceil((legacyGridDims.y - 1) / 2)),
    z: Math.max(0, Math.ceil((legacyGridDims.z - 1) / 2)),
  };
}

/**
 * Chunks a dense, `mapSize`-sized flat packed-cell array into `coldStorage`,
 * one `ChunkColdStorage.set()` per chunk that diverges from baseline
 * (`EMPTY_CELL`) — chunks entirely beyond `mapSize` (when it isn't an exact
 * multiple of `chunkSize`) are padded with `EMPTY_CELL`. World chunk
 * coordinates start at `(0,0,0)`, matching the legacy map's own coordinate
 * space (cell `(0,0,0)` is always the map's authored origin).
 */
function chunkDenseArrayIntoColdStorage(
  coldStorage: ChunkColdStorage,
  packedFlat: number[],
  mapSize: Vector3D,
  chunkSize: Vector3D,
): void {
  const gridX = Math.ceil(mapSize.x / chunkSize.x);
  const gridY = Math.ceil(mapSize.y / chunkSize.y);
  const gridZ = Math.ceil(mapSize.z / chunkSize.z);
  const chunkCellCount = chunkSize.x * chunkSize.y * chunkSize.z;

  for (let cz = 0; cz < gridZ; cz++) {
    for (let cy = 0; cy < gridY; cy++) {
      for (let cx = 0; cx < gridX; cx++) {
        const cells = new Uint32Array(chunkCellCount);
        let differs = false;
        let idx = 0;
        for (let lz = 0; lz < chunkSize.z; lz++) {
          const wz = cz * chunkSize.z + lz;
          for (let ly = 0; ly < chunkSize.y; ly++) {
            const wy = cy * chunkSize.y + ly;
            for (let lx = 0; lx < chunkSize.x; lx++) {
              const wx = cx * chunkSize.x + lx;
              let value = EMPTY_CELL;
              if (wx < mapSize.x && wy < mapSize.y && wz < mapSize.z) {
                value =
                  packedFlat[wz * mapSize.y * mapSize.x + wy * mapSize.x + wx];
              }
              cells[idx++] = value;
              if (value !== EMPTY_CELL) differs = true;
            }
          }
        }
        if (differs) {
          coldStorage.set(cx, cy, cz, cells);
        }
      }
    }
  }
}

/**
 * Builder function for CellMap component
 */
export async function builder(options: CellMapOptions): Promise<CellMapT> {
  // The canonical cell store lives in the render WASM module; ensure it is
  // instantiated before we load cells into it.
  await initRenderWasm();

  // cell-map state is a process-wide singleton (see module comment above
  // `cmLive`) — refuse to construct a second live instance rather than
  // silently corrupting the first.
  if (cmLive) {
    throw new Error(
      'A live cell-map already exists; dispose it before constructing another ' +
        '(cell-map state is a process-wide singleton — see the module comment ' +
        'above `cmLive` in cell-map/data.ts).',
    );
  }

  // Validate required inputs
  if (!options.materials || options.materials.length === 0) {
    throw new Error('CellMap requires at least one material');
  }

  if (!options.cellSize) {
    throw new Error('CellMap requires cellSize');
  }

  // mapSize + materialMap: both together (the legacy hand-authored path) or
  // both omitted (the generative path / a purely empty map authored via
  // setCellData after construction) -- one without the other is a mistake,
  // not a valid partial configuration.
  const isLegacy =
    options.mapSize !== undefined || options.materialMap !== undefined;
  if (isLegacy && (!options.mapSize || !options.materialMap)) {
    throw new Error(
      'CellMap: mapSize and materialMap must be supplied together (the ' +
        'legacy authored-map path), or both omitted (the generative path)',
    );
  }

  if (!isLegacy) {
    return builderGenerative(options);
  }

  const mapSize = options.mapSize!;
  const materialMap = options.materialMap!;

  // Validate materialMap dimensions match mapSize
  if (
    materialMap.size.x !== mapSize.x ||
    materialMap.size.y !== mapSize.y ||
    materialMap.size.z !== mapSize.z
  ) {
    throw new Error(
      `materialMap dimensions (${materialMap.size.x},${materialMap.size.y},${materialMap.size.z}) ` +
        `must match mapSize (${mapSize.x},${mapSize.y},${mapSize.z})`,
    );
  }

  // Create default shapeMap if not provided (all cubes)
  const optShapeMap = options.shapeMap || new Array3D<number>(mapSize, 1);

  // Validate shapeMap dimensions if provided
  if (
    optShapeMap.size.x !== mapSize.x ||
    optShapeMap.size.y !== mapSize.y ||
    optShapeMap.size.z !== mapSize.z
  ) {
    throw new Error('shapeMap dimensions must match mapSize');
  }

  // Create default emissionMap if not provided (no emission)
  const optEmissionMap = options.emissionMap || new Array3D<number>(mapSize, 0);

  // Validate emissionMap dimensions if provided
  if (
    optEmissionMap.size.x !== mapSize.x ||
    optEmissionMap.size.y !== mapSize.y ||
    optEmissionMap.size.z !== mapSize.z
  ) {
    throw new Error('emissionMap dimensions must match mapSize');
  }

  // Create default emissionColorMap if not provided (no highlight color, all black = 0)
  const optEmissionColorMap =
    options.emissionColorMap || new Array3D<number>(mapSize, 0);

  // Validate emissionColorMap dimensions if provided
  if (
    optEmissionColorMap.size.x !== mapSize.x ||
    optEmissionColorMap.size.y !== mapSize.y ||
    optEmissionColorMap.size.z !== mapSize.z
  ) {
    throw new Error('emissionColorMap dimensions must match mapSize');
  }

  // Create default visibilityMap if not provided (all visible)
  const optVisibilityMap =
    options.visibilityMap || new Array3D<boolean>(mapSize, true);

  // Validate visibilityMap dimensions if provided
  if (
    optVisibilityMap.size.x !== mapSize.x ||
    optVisibilityMap.size.y !== mapSize.y ||
    optVisibilityMap.size.z !== mapSize.z
  ) {
    throw new Error('visibilityMap dimensions must match mapSize');
  }

  // Prepare meshes array with default cube at index 1
  const optMeshes = options.meshes || [];

  // Ensure index 0 exists (reserved for air - empty mesh)
  if (!optMeshes[0]) {
    optMeshes[0] = {
      vertices: new Float32Array(0),
      uvs: new Float32Array(0),
      indices: new Uint16Array(0),
    };
  }

  // Ensure index 1 exists (default cube)
  if (!optMeshes[1]) {
    optMeshes[1] = generateDefaultCubeMesh();
  }

  // Pack all cell data into a single Array3D
  const packedArray = new Array3D<number>(mapSize);

  packedArray.forEach((_, x, y, z, i) => {
    const coords = new Vector3D(x, y, z);

    const cellData = createDefaultCellData();
    cellData.materialIndex = materialMap.get(coords);
    cellData.shapeIndex = optShapeMap.get(coords);
    cellData.emissionIntensity = optEmissionMap.get(coords);
    cellData.visible = optVisibilityMap.get(coords);

    // Clamp values to valid ranges
    cellData.materialIndex = Math.max(
      0,
      Math.min(0xfff, cellData.materialIndex),
    );
    cellData.shapeIndex = Math.max(0, Math.min(0xfff, cellData.shapeIndex));
    cellData.emissionIntensity = Math.max(
      0,
      Math.min(0x1f, cellData.emissionIntensity),
    );

    packedArray.indexSet(i, packCell(cellData));
  });

  // Chunk size must be configured before any mesh_build_chunk* call. Resolved
  // here (after every validation above has passed, so a failed construction
  // never mutates the shared WASM chunk-size static) and set once, alongside
  // the window's initial load below.
  const optChunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  setChunkSize(optChunkSize.x, optChunkSize.y, optChunkSize.z);

  // Smoothing configuration
  const optSmoothing = options.smoothing ?? 0;
  const optNormalSmoothing = Math.max(
    0,
    Math.min(1, options.normalSmoothing ?? 0),
  );

  let weightsArray3D: Array3D<number>;
  const rawWeight = options.smoothingWeights ?? 8;
  if (typeof rawWeight === 'number') {
    const clamped = Math.max(0, Math.min(15, Math.round(rawWeight)));
    weightsArray3D = new Array3D<number>(mapSize, clamped);
  } else {
    if (
      rawWeight.size.x !== mapSize.x ||
      rawWeight.size.y !== mapSize.y ||
      rawWeight.size.z !== mapSize.z
    ) {
      throw new Error('smoothingWeights dimensions must match mapSize');
    }
    weightsArray3D = rawWeight;
  }
  const optSmoothingWeights = new Array3Di(weightsArray3D, 8, [4, 4], 'clamp');

  // Legacy chunk grid: how many chunks the AUTHORED map spans. The window's
  // own grid (below) is sized to at least cover this, by default -- not the
  // same thing as `cmChunkGridSize`, which reflects the window, not the
  // authored map.
  const legacyGridDims = {
    x: Math.ceil(mapSize.x / optChunkSize.x),
    y: Math.ceil(mapSize.y / optChunkSize.y),
    z: Math.ceil(mapSize.z / optChunkSize.z),
  };
  // When no explicit windowRadius is supplied, the window is auto-sized purely to keep
  // the WHOLE authored map resident (computeCoverageRadius) -- centered at origin and
  // built with little to no padding beyond the map's own footprint. Driving focus from
  // the camera in that case can only ever shift the window to show LESS of the map (it's
  // already showing all of it), and since the window has ~no slack, even a small camera
  // move can evict all real content with nothing recoverable outside the authored chunk
  // range. So auto-focus only defaults on when the caller explicitly opted into windowed
  // behavior via windowRadius; an explicit options.autoFocusFromCamera always wins.
  const usingCoverageRadius = options.windowRadius === undefined;
  const radius = options.windowRadius ?? computeCoverageRadius(legacyGridDims);

  const coldStorage = new ChunkColdStorage({
    chunkCellCount: optChunkSize.x * optChunkSize.y * optChunkSize.z,
  });
  chunkDenseArrayIntoColdStorage(
    coldStorage,
    packedArray.value,
    mapSize,
    optChunkSize,
  );
  const window = new CellWindow(
    { chunkSize: optChunkSize, radius, emptyCell: EMPTY_CELL },
    coldStorage,
  );
  // Force the initial window origin to (0,0,0): a focus point inside the
  // chunk at grid position `radius` puts origin = focusChunk - radius = 0.
  // With the default (coverage) radius this means the whole authored map is
  // resident from the start, world coordinate == window-local coordinate,
  // and every other read/write/render path stays exactly as it behaves
  // today -- see 08-live-construction-and-ownership.md for why this matters.
  window.setFocus(
    radius.x * optChunkSize.x,
    radius.y * optChunkSize.y,
    radius.z * optChunkSize.z,
  );

  // Assign to module-level storage
  cmMaterials = options.materials;
  cmMaterialMap = materialMap;
  cmShapeMap = optShapeMap;
  cmMeshes = optMeshes;
  cmEmissionMap = optEmissionMap;
  cmEmissionColorMap = optEmissionColorMap;
  cmEmissionColorDirty = true;
  cmVisibilityMap = optVisibilityMap;
  cmCellSize = options.cellSize;
  cmChunkSize = optChunkSize;
  cmSmoothing = optSmoothing;
  cmSmoothingWeights = optSmoothingWeights;
  cmNormalSmoothing = optNormalSmoothing;
  cmNeedsGPUUpdate = true;
  cmWindow = window;
  cmColdStorage = coldStorage;
  cmMapSize = new Vector3D(
    window.cellDimensions.x,
    window.cellDimensions.y,
    window.cellDimensions.z,
  );
  cmChunkGridSize = window.gridDimensions;
  cmChunks = initChunks(window.gridDimensions);
  cmRevealExempt = options.revealExempt ?? false;
  cmAutoFocusFromCamera = options.autoFocusFromCamera ?? !usingCoverageRadius;
  cmAutoResizeFromZoom = options.autoResizeFromZoom ?? cmAutoFocusFromCamera;
  cmMaxTerrainLoadDimensions = options.maxTerrainLoadDimensions ?? {
    x: 512,
    y: 512,
    z: 512,
  };
  cmRenderDistance = options.renderDistance ?? { x: 1, y: 1, z: 1 };
  cmFrustumPadding = options.frustumPadding ?? { x: 0, y: 0, z: 0 };
  cmLive = true;

  return makeCellMapInstance(options.name);
}

/**
 * Builder path for a cell-map with no authored `mapSize`/`materialMap` --
 * content comes from `generateCell`/`generateChunk` (or, if neither is
 * supplied, an entirely empty map authored via `setCellData` after
 * construction). Split out from `builder()` for readability; called from
 * there once the legacy-vs-generative branch is resolved.
 */
function builderGenerative(options: CellMapOptions): CellMapT {
  const optChunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  setChunkSize(optChunkSize.x, optChunkSize.y, optChunkSize.z);
  const radius = options.windowRadius ?? { x: 1, y: 1, z: 1 };
  const windowCellDims = new Vector3D(
    (2 * radius.x + 1) * optChunkSize.x,
    (2 * radius.y + 1) * optChunkSize.y,
    (2 * radius.z + 1) * optChunkSize.z,
  );

  // Prepare meshes array with default cube at index 1 (same as the legacy path).
  const optMeshes = options.meshes || [];
  if (!optMeshes[0]) {
    optMeshes[0] = {
      vertices: new Float32Array(0),
      uvs: new Float32Array(0),
      indices: new Uint16Array(0),
    };
  }
  if (!optMeshes[1]) {
    optMeshes[1] = generateDefaultCubeMesh();
  }

  // Smoothing configuration
  const optSmoothing = options.smoothing ?? 0;
  const optNormalSmoothing = Math.max(
    0,
    Math.min(1, options.normalSmoothing ?? 0),
  );
  const rawWeight = options.smoothingWeights ?? 8;
  if (typeof rawWeight !== 'number') {
    // A per-cell Array3D of custom weights has no coordinate space to
    // validate against without a mapSize -- doc 13 (windowing the secondary
    // per-cell channels) is where this gets real support; for now the
    // generative path only accepts a uniform weight.
    throw new Error(
      'CellMap: a per-cell smoothingWeights Array3D requires mapSize/' +
        'materialMap (the legacy path) -- the generative path only supports ' +
        'a uniform number for now',
    );
  }
  const clampedWeight = Math.max(0, Math.min(15, Math.round(rawWeight)));
  const optSmoothingWeights = new Array3Di(
    new Array3D<number>(windowCellDims, clampedWeight),
    8,
    [4, 4],
    'clamp',
  );

  // "Input maps preserved for reference" have no authored input to preserve
  // in the generative path -- sized to the initial window as inert
  // placeholders (materialMap/shapeMap/visibilityMap have no consumers post-
  // construction; emissionColorMap IS live via setEmissionColor/
  // getEmissionColor, and stays a plain dense array — sized to the *initial*
  // window only — until doc 13 gives it real per-chunk windowing).
  const coldStorage = new ChunkColdStorage({
    chunkCellCount: optChunkSize.x * optChunkSize.y * optChunkSize.z,
  });
  const generator = wrapGenerator(options.generateCell, options.generateChunk);
  const window = new CellWindow(
    { chunkSize: optChunkSize, radius, emptyCell: EMPTY_CELL, generator },
    coldStorage,
  );
  // Same origin-zeroing trick as the legacy path -- see its comment above.
  window.setFocus(
    radius.x * optChunkSize.x,
    radius.y * optChunkSize.y,
    radius.z * optChunkSize.z,
  );

  cmMaterials = options.materials;
  cmMaterialMap = new Array3D<number>(windowCellDims, 0);
  cmShapeMap = new Array3D<number>(windowCellDims, 1);
  cmMeshes = optMeshes;
  cmEmissionMap = new Array3D<number>(windowCellDims, 0);
  cmEmissionColorMap = new Array3D<number>(windowCellDims, 0);
  cmEmissionColorDirty = true;
  cmVisibilityMap = new Array3D<boolean>(windowCellDims, true);
  cmCellSize = options.cellSize;
  cmChunkSize = optChunkSize;
  cmSmoothing = optSmoothing;
  cmSmoothingWeights = optSmoothingWeights;
  cmNormalSmoothing = optNormalSmoothing;
  cmNeedsGPUUpdate = true;
  cmWindow = window;
  cmColdStorage = coldStorage;
  cmMapSize = new Vector3D(
    window.cellDimensions.x,
    window.cellDimensions.y,
    window.cellDimensions.z,
  );
  cmChunkGridSize = window.gridDimensions;
  cmChunks = initChunks(window.gridDimensions);
  cmRevealExempt = options.revealExempt ?? false;
  cmAutoFocusFromCamera = options.autoFocusFromCamera ?? true;
  cmAutoResizeFromZoom = options.autoResizeFromZoom ?? cmAutoFocusFromCamera;
  cmMaxTerrainLoadDimensions = options.maxTerrainLoadDimensions ?? {
    x: 512,
    y: 512,
    z: 512,
  };
  cmRenderDistance = options.renderDistance ?? { x: 1, y: 1, z: 1 };
  cmFrustumPadding = options.frustumPadding ?? { x: 0, y: 0, z: 0 };
  cmLive = true;

  return makeCellMapInstance(options.name);
}

/**
 * Serializes a cell-map component to a plain object.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serialize(component: ComponentData): any {
  const cm = component as CellMapT;
  const size = cm.mapSize;

  // Dump the canonical WASM store to a flat array of 32-bit packed ints.
  const packedFlat: number[] = Array.from(cellStoreDump());

  return {
    type: 'cell-map',
    name: cm.name,
    unique: ComponentUnique.FALSE,
    materials: cm.materials.map((m) => ({
      albedoTextureKey: m.albedoTextureKey,
      normalTextureKey: m.normalTextureKey,
      emissionTextureKey: m.emissionTextureKey,
      materialTextureKey: m.materialTextureKey,
      albedoFrame: m.albedoFrame ?? 0,
      normalFrame: m.normalFrame ?? 0,
      emissionFrame: m.emissionFrame ?? 0,
      materialFrame: m.materialFrame ?? 0,
      sides: m.sides,
      smoothness: m.smoothness,
    })),
    cellSize: {
      _vectorType: 'Vector3D',
      x: cm.cellSize.x,
      y: cm.cellSize.y,
      z: cm.cellSize.z,
    },
    mapSize: {
      _vectorType: 'Vector3D',
      x: size.x,
      y: size.y,
      z: size.z,
    },
    chunkSize: {
      _vectorType: 'Vector3D',
      x: cm.chunkSize.x,
      y: cm.chunkSize.y,
      z: cm.chunkSize.z,
    },
    packedData: packedFlat,
    // Per-cell emission color lives outside the packed WASM cell store (it's a
    // separate texture-side channel), so persist it as its own flat RGB-int array.
    // Omitted when entirely black (0) to keep legacy scenes byte-identical.
    emissionColorData: cm.emissionColorMap.value.some((v) => v !== 0)
      ? Array.from(cm.emissionColorMap.value)
      : undefined,
    smoothing: cm.smoothing,
    normalSmoothing: cm.normalSmoothing,
    revealExempt: cm.revealExempt,
    // Custom shape meshes (index 0 = air, 1 = default cube are auto-filled on
    // load, so serialize them as null). Indices 2+ are persisted as plain arrays.
    meshes: cm.meshes.map((m, i) =>
      i <= 1
        ? null
        : {
            vertices: Array.from(m.vertices),
            uvs: Array.from(m.uvs),
            indices: Array.from(m.indices),
            faceCover: m.faceCover,
          },
    ),
  };
}

/**
 * Deserializes a plain object back into a cell-map component.
 * Constructs CellMapT directly (mirrors builder logic) since builder is async.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function deserialize(data: any): Promise<DeserializeResult<CellMapT>> {
  const errors: DeserializationError[] = [];

  if (!data || typeof data !== 'object') {
    return {
      component: null,
      errors: [
        {
          code: 'INVALID_DATA',
          message: 'cell-map deserialize received non-object data',
        },
      ],
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const {
    type,
    name,
    materials: dataMaterials,
    cellSize: dataCellSize,
    mapSize: dataMapSize,
    chunkSize: dataChunkSize,
    packedData: dataPackedData,
    emissionColorData: dataEmissionColorData,
    smoothing: dataSmoothing,
    normalSmoothing: dataNormalSmoothing,
    revealExempt: dataRevealExempt,
    meshes: dataMeshes,
  } = data;

  if (type !== 'cell-map') {
    errors.push({
      code: 'TYPE_MISMATCH',
      message: `type ${type} does not match "cell-map"`,
    });
  }
  if (!name) {
    errors.push({
      code: 'MISSING_NAME',
      message: 'cell-map requires a name',
    });
  }
  if (
    !dataMaterials ||
    !Array.isArray(dataMaterials) ||
    dataMaterials.length === 0
  ) {
    errors.push({
      code: 'MISSING_MATERIALS',
      message: 'cell-map requires at least one material',
    });
  }
  if (!dataCellSize || !dataMapSize) {
    errors.push({
      code: 'MISSING_DIMENSIONS',
      message: 'cell-map requires cellSize and mapSize',
    });
  }
  if (!dataPackedData || !Array.isArray(dataPackedData)) {
    errors.push({
      code: 'MISSING_PACKED_DATA',
      message: 'cell-map requires packedData array',
    });
  }
  // cell-map state is a process-wide singleton (see module comment above
  // `cmLive`) — refuse to construct a second live instance rather than
  // silently corrupting the first.
  if (cmLive) {
    errors.push({
      code: 'LIVE_INSTANCE_EXISTS',
      message:
        'A live cell-map already exists; dispose it before deserializing another ' +
        '(cell-map state is a process-wide singleton).',
    });
  }
  if (errors.length > 0) {
    return { component: null, errors };
  }

  // Reconstruct Vector3D for cellSize and mapSize
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const cs = new Vector3D(dataCellSize.x, dataCellSize.y, dataCellSize.z);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const ms = new Vector3D(dataMapSize.x, dataMapSize.y, dataMapSize.z);
  // chunkSize is absent in scenes saved before this field existed — default it.
  const cks =
    dataChunkSize && typeof dataChunkSize === 'object'
      ? // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        new Vector3D(dataChunkSize.x, dataChunkSize.y, dataChunkSize.z)
      : DEFAULT_CHUNK_SIZE;

  // Reconstruct input maps by unpacking each cell from the flat packed array
  const dMaterialMap = new Array3D<number>(ms, 0);
  const dShapeMap = new Array3D<number>(ms, 1);
  const dEmissionMap = new Array3D<number>(ms, 0);
  const dVisibilityMap = new Array3D<boolean>(ms, true);

  for (let i = 0; i < (dataPackedData as number[]).length; i++) {
    const cell = unpackCell((dataPackedData as number[])[i]);
    dMaterialMap.indexSet(i, cell.materialIndex);
    dShapeMap.indexSet(i, cell.shapeIndex);
    dEmissionMap.indexSet(i, cell.emissionIntensity);
    dVisibilityMap.indexSet(i, cell.visible);
  }

  // Pack each cell into an Array3D, then load it into the canonical WASM RLE
  // store via loadCellStore below (mirrors builder).
  const packedArray = new Array3D<number>(ms);
  packedArray.forEach((_, x, y, z, i) => {
    const coords = new Vector3D(x, y, z);
    const cellData = createDefaultCellData();
    cellData.materialIndex = dMaterialMap.get(coords);
    cellData.shapeIndex = dShapeMap.get(coords);
    cellData.emissionIntensity = dEmissionMap.get(coords);
    cellData.visible = dVisibilityMap.get(coords);

    cellData.materialIndex = Math.max(
      0,
      Math.min(0xfff, cellData.materialIndex),
    );
    cellData.shapeIndex = Math.max(0, Math.min(0xfff, cellData.shapeIndex));
    cellData.emissionIntensity = Math.max(
      0,
      Math.min(0x1f, cellData.emissionIntensity),
    );

    packedArray.indexSet(i, packCell(cellData));
  });
  // Chunk size must be configured before any mesh_build_chunk* call, before
  // the window's initial load below (mirrors builder()'s legacy path).
  await initRenderWasm();
  setChunkSize(cks.x, cks.y, cks.z);

  // Reconstruct the per-cell emission color map (separate texture-side channel;
  // absent in legacy scenes → all black).
  const dEmissionColorMap = new Array3D<number>(ms, 0);
  if (Array.isArray(dataEmissionColorData)) {
    const colors = dataEmissionColorData as number[];
    for (let i = 0; i < colors.length; i++) {
      dEmissionColorMap.indexSet(i, colors[i] | 0);
    }
  }

  // Meshes: air at 0, default cube at 1 (auto-filled); custom shapes at 2+ are
  // reconstructed from the serialized plain arrays.
  const dMeshes: Mesh[] = [
    {
      vertices: new Float32Array(0),
      uvs: new Float32Array(0),
      indices: new Uint16Array(0),
    },
    generateDefaultCubeMesh(),
  ];
  if (Array.isArray(dataMeshes)) {
    type SerializedMesh = {
      vertices?: number[];
      uvs?: number[];
      indices?: number[];
      faceCover?: Mesh['faceCover'];
    } | null;
    (dataMeshes as SerializedMesh[]).forEach((m, i) => {
      if (i <= 1 || !m) return;
      dMeshes[i] = {
        vertices: new Float32Array(m.vertices ?? []),
        uvs: new Float32Array(m.uvs ?? []),
        indices: new Uint16Array(m.indices ?? []),
        faceCover: m.faceCover,
      };
    });
  }

  // Smoothing weights (uniform default)
  const weightsArray3D = new Array3D<number>(ms, 8);
  const dSmoothingWeights = new Array3Di(weightsArray3D, 8, [4, 4], 'clamp');

  // Legacy chunk grid: how many chunks the SAVED map spans -- mirrors
  // builder()'s legacy path (see 08-live-construction-and-ownership.md).
  const legacyGridDims = {
    x: Math.ceil(ms.x / cks.x),
    y: Math.ceil(ms.y / cks.y),
    z: Math.ceil(ms.z / cks.z),
  };
  const radius = computeCoverageRadius(legacyGridDims);
  const dColdStorage = new ChunkColdStorage({
    chunkCellCount: cks.x * cks.y * cks.z,
  });
  chunkDenseArrayIntoColdStorage(dColdStorage, packedArray.value, ms, cks);
  const dWindow = new CellWindow(
    { chunkSize: cks, radius, emptyCell: EMPTY_CELL },
    dColdStorage,
  );
  // Origin-zeroing trick, same as builder() -- see its comment for why.
  dWindow.setFocus(radius.x * cks.x, radius.y * cks.y, radius.z * cks.z);

  // Reconstruct materials array
  const mats: Material[] = (dataMaterials as Material[]).map((m) => ({
    albedoTextureKey: m.albedoTextureKey || '',
    normalTextureKey: m.normalTextureKey || '',
    emissionTextureKey: m.emissionTextureKey || '',
    materialTextureKey: m.materialTextureKey || '',
    albedoFrame: m.albedoFrame ?? 0,
    normalFrame: m.normalFrame ?? 0,
    emissionFrame: m.emissionFrame ?? 0,
    materialFrame: m.materialFrame ?? 0,
    sides: m.sides,
    smoothness: m.smoothness,
  }));

  // Assign to module-level storage
  cmMaterials = mats;
  cmMaterialMap = dMaterialMap;
  cmShapeMap = dShapeMap;
  cmMeshes = dMeshes;
  cmEmissionMap = dEmissionMap;
  cmEmissionColorMap = dEmissionColorMap;
  cmEmissionColorDirty = true;
  cmVisibilityMap = dVisibilityMap;
  cmCellSize = cs;
  cmChunkSize = cks;
  cmSmoothing = (dataSmoothing as number) ?? 0;
  cmSmoothingWeights = dSmoothingWeights;
  cmNormalSmoothing = Math.max(
    0,
    Math.min(1, (dataNormalSmoothing as number) ?? 0),
  );
  cmNeedsGPUUpdate = true;
  cmWindow = dWindow;
  cmColdStorage = dColdStorage;
  cmMapSize = new Vector3D(
    dWindow.cellDimensions.x,
    dWindow.cellDimensions.y,
    dWindow.cellDimensions.z,
  );
  cmChunkGridSize = dWindow.gridDimensions;
  cmChunks = initChunks(dWindow.gridDimensions);
  cmRevealExempt = (dataRevealExempt as boolean) ?? false;
  // deserialize() always uses the auto-computed coverage radius (windowRadius
  // isn't part of the serialized format) -- see the matching comment in
  // builder()'s legacy branch for why that means auto-focus must default off.
  cmAutoFocusFromCamera = false;
  cmAutoResizeFromZoom = false;
  cmMaxTerrainLoadDimensions = { x: 512, y: 512, z: 512 };
  cmRenderDistance = { x: 1, y: 1, z: 1 };
  cmFrustumPadding = { x: 0, y: 0, z: 0 };
  cmLive = true;

  return {
    component: makeCellMapInstance(name as string),
    errors,
  };
}

export const CellMapSerializer: ComponentSerializer = {
  serialize,
  deserialize,
};
