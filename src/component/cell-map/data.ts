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
  createDefaultCellData,
  DEFAULT_CHUNK_SIZE,
  CellEmissionColorDirtyRegion,
  ChunkExploredDirtyRegion,
  MemoryMaterialDirtyRegion,
} from './types';
import {
  initRenderWasm,
  cellStoreDump,
  cellStoreGet,
  setChunkSize,
} from '../camera/render/wasm';
import { CellWindow } from './window';
import type { ChunkGenerator, ChunkCoord, WindowConfig } from './window';
import { ChunkColdStorage } from './cold-storage';
import type { ColdStorageEntrySnapshot } from './cold-storage';
import type { CellData } from './types';
import { MethodRegistry } from '../registry';
import { AuxiliaryChannel } from './auxiliary-channel';

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
/**
 * Monotonic counter, bumped on every in-window `setEmissionColor` write and
 * on every full invalidation (window shift, or dirty-log cap overflow).
 * Mirrors atlas-manager's `atlasVersion`.
 */
export let cmEmissionColorVersion: number = 0;
/**
 * Version at/below which a camera must do a full `texImage3D` reupload
 * instead of trusting `cmEmissionColorDirtyRegions` -- the delta log doesn't
 * cover anything at or before this version. Bumped alongside
 * `cmEmissionColorVersion` on every full invalidation. Mirrors atlas-manager's
 * `fullVersion`.
 */
export let cmEmissionColorFullVersion: number = 0;
/**
 * Per-cell dirty log (window-local coords + the version that wrote them),
 * capped at `CELL_EMISSION_COLOR_DIRTY_CAP` (see cell-map/methods.ts).
 * Mirrors atlas-manager's `dirtyRegions`, one cell per entry instead of one
 * rect.
 */
export let cmEmissionColorDirtyRegions: CellEmissionColorDirtyRegion[] = [];
/**
 * Chunk-level fog-of-war "explored" state: one flag per chunk (has any
 * vision source ever seen into this chunk), backed by `cmExploredChannel`
 * (an `AuxiliaryChannel` constructed with `chunkSize: {x:1,y:1,z:1}` so its
 * cell-granular coordinate math IS chunk-granular -- see
 * `syncExploredField`/`makeAuxiliaryOnReassemble`). Sized to the resident
 * window's CHUNK-GRID dims (`cmChunkGridSize`), not cell dims.
 */
export let cmExploredMap: Array3D<number>;
/**
 * Monotonic counter, bumped on every in-window `setChunkExplored` write and
 * on every full invalidation (window shift, or dirty-log cap overflow).
 * Mirrors `cmEmissionColorVersion`.
 */
export let cmExploredVersion: number = 0;
/**
 * Version at/below which a camera must do a full reupload instead of
 * trusting `cmExploredDirtyRegions` -- the delta log doesn't cover anything
 * at or before this version. Bumped alongside `cmExploredVersion` on every
 * full invalidation. Mirrors `cmEmissionColorFullVersion`.
 */
export let cmExploredFullVersion: number = 0;
/**
 * Per-chunk dirty log (window-local chunk-grid coords + the version that
 * wrote them), capped at `CELL_EXPLORED_DIRTY_CAP` (see cell-map/methods.ts).
 * Mirrors `cmEmissionColorDirtyRegions`, one chunk per entry instead of one
 * cell.
 */
export let cmExploredDirtyRegions: ChunkExploredDirtyRegion[] = [];
/**
 * Far-tier fog-of-war representative material index, one per CHUNK, backed
 * by `cmFarMaterialChannel` (an `AuxiliaryChannel` constructed with the same
 * `{x:1,y:1,z:1}` chunk-size trick `cmExploredChannel` uses -- chunk-granular,
 * not cell-granular). Kept as a SEPARATE channel from `cmExploredMap`'s
 * binary flag rather than packed into the same payload: `cmExploredMap` is
 * sampled with linear GPU filtering (to blend the never-viewed/memory-tier
 * boundary smoothly across chunk edges), and bit-packing a material index
 * into that same texture would make bilinear filtering blend garbage bit
 * patterns together at chunk boundaries instead of a usable color. Baseline
 * `0xFFFF` means "no material ever captured for this chunk" -- material
 * index 0 is itself a legitimate captured value, same reasoning as
 * `cmMemoryMaterialMap`'s sentinel.
 */
export let cmFarMaterialMap: Array3D<number>;
/**
 * Monotonic counter, bumped on every in-window `setChunkFarMaterial` write
 * (that actually changes the stored value) and on every full invalidation
 * (window shift, or dirty-log cap overflow). Mirrors `cmExploredVersion`.
 */
export let cmFarMaterialVersion: number = 0;
/**
 * Version at/below which a camera must do a full reupload instead of
 * trusting `cmFarMaterialDirtyRegions`. Bumped alongside
 * `cmFarMaterialVersion` on every full invalidation. Mirrors
 * `cmExploredFullVersion`.
 */
export let cmFarMaterialFullVersion: number = 0;
/**
 * Per-chunk dirty log (window-local chunk-grid coords + the version that
 * wrote them), capped the same as `cmExploredDirtyRegions` (see
 * `CELL_EXPLORED_DIRTY_CAP` in cell-map/methods.ts). Reuses
 * `ChunkExploredDirtyRegion`'s shape -- same window-local chunk coordinates.
 */
export let cmFarMaterialDirtyRegions: ChunkExploredDirtyRegion[] = [];
/**
 * Near-tier fog-of-war "captured material" snapshot: one real material index
 * per CELL (not per chunk), for cells near an active vision source -- the
 * fine-grained "what did this cell look like last time it was seen"
 * counterpart to `cmExploredMap`'s coarse per-chunk representative material.
 * Backed by `cmMemoryMaterialChannel` (an `AuxiliaryChannel` at REAL chunk
 * granularity, same instantiation shape as `cmEmissionColorChannel` -- NOT
 * the `{1,1,1}` chunk-size trick `cmExploredChannel` uses). Baseline
 * `0xFFFF` (see `cmMemoryMaterialChannel`) means "never captured"; material
 * index 0 is itself a legitimate captured value, so it can't double as the
 * sentinel the way `cmEmissionColorMap`'s baseline `0` (= black = no
 * highlight) can.
 */
export let cmMemoryMaterialMap: Array3D<number>;
/**
 * Monotonic counter, bumped on every in-window `setCellMemoryMaterial` write
 * (that actually changes the stored value) and on every full invalidation
 * (window shift, or dirty-log cap overflow). Mirrors `cmEmissionColorVersion`.
 */
export let cmMemoryMaterialVersion: number = 0;
/**
 * Version at/below which a camera must do a full reupload instead of
 * trusting `cmMemoryMaterialDirtyRegions` -- the delta log doesn't cover
 * anything at or before this version. Bumped alongside
 * `cmMemoryMaterialVersion` on every full invalidation. Mirrors
 * `cmEmissionColorFullVersion`.
 */
export let cmMemoryMaterialFullVersion: number = 0;
/**
 * Per-cell dirty log (window-local coords + the version that wrote them),
 * capped at `CELL_MEMORY_MATERIAL_DIRTY_CAP` (see cell-map/methods.ts).
 * Mirrors `cmEmissionColorDirtyRegions`.
 */
export let cmMemoryMaterialDirtyRegions: MemoryMaterialDirtyRegion[] = [];
/**
 * Indices into `cmMeshes` (>= 2, custom shapes) added since the last
 * `rebuildDirtyChunks` pass and not yet pushed to WASM. Ignored (and
 * cleared) whenever `cmCustomShapesFullResync` is set, since a full resync
 * covers every index anyway.
 */
export let cmCustomShapesPendingIndices: number[] = [];
/**
 * Set when `cmMeshes` is reassigned wholesale (not just appended to) so
 * `rebuildDirtyChunks` re-uploads every custom shape, not just the ones
 * logged in `cmCustomShapesPendingIndices`.
 */
export let cmCustomShapesFullResync: boolean = true;
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
 * instead.
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
 * so this is deliberately modest.
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
 * viewport shape/orbit yaw.
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
 * assemble/reload). `undefined` until first construction.
 */
export let cmWindow: CellWindow | undefined;
/** Everything outside the current window that diverges from baseline. Owned
 *  jointly with `cmWindow` (constructed together, always non-null together). */
export let cmColdStorage: ChunkColdStorage | undefined;
/**
 * Registry key(s) (`MethodRegistry['cell-map-generator']`) the component's
 * `generateCell`/`generateChunk` were constructed/deserialized with, if any --
 * `undefined` per-slot when built with a raw function or no generator at all.
 * `serialize()` emits these so `deserialize()` can re-resolve the same
 * generator(s); a raw-function generator has no key to remember and doesn't
 * survive a round trip.
 */
export let cmGeneratorKey:
  | { generateCell?: string; generateChunk?: string }
  | undefined;
/**
 * `emissionColorMap`/`smoothingWeights`' own windowed persistence -- unlike
 * primary cell data, these have no procedural-generation cost, so they don't
 * need `CellWindow`'s multi-frame shift staging; they resync synchronously
 * via `CellWindow`'s `onReassemble` hook instead. See `auxiliary-channel.ts`.
 * Owned jointly with `cmWindow` (constructed together, always non-null
 * together).
 */
export let cmEmissionColorChannel: AuxiliaryChannel | undefined;
export let cmSmoothingWeightsChannel: AuxiliaryChannel | undefined;
/**
 * Chunk-level fog-of-war "explored" channel -- see `cmExploredMap`'s doc
 * comment. Constructed with `chunkSize: {x:1,y:1,z:1}`, so the same proven
 * cold-storage-backed persistence-across-window-scroll `AuxiliaryChannel`
 * gives `emissionColorMap`/`smoothingWeights` applies here at one flag per
 * chunk instead of one value per cell. Owned jointly with `cmWindow`
 * (constructed together, always non-null together).
 */
export let cmExploredChannel: AuxiliaryChannel | undefined;
/**
 * Far-tier representative-material channel -- see `cmFarMaterialMap`'s doc
 * comment. Constructed with `chunkSize: {x:1,y:1,z:1}` (the same trick
 * `cmExploredChannel` uses), so it's chunk-granular, separate from and never
 * bit-packed with `cmExploredChannel`. Owned jointly with `cmWindow`
 * (constructed together, always non-null together).
 */
export let cmFarMaterialChannel: AuxiliaryChannel | undefined;
/**
 * Near-tier fog-of-war "captured material" channel -- see `cmMemoryMaterialMap`'s
 * doc comment. Constructed at REAL chunk granularity (mirrors
 * `cmEmissionColorChannel`'s instantiation exactly -- same `chunkSize`, NOT
 * the `{1,1,1}` trick `cmExploredChannel` uses), with `baselineValue: 0xFFFF`
 * so an unwritten cell is distinguishable from a captured material index 0.
 * Owned jointly with `cmWindow` (constructed together, always non-null
 * together).
 */
export let cmMemoryMaterialChannel: AuxiliaryChannel | undefined;

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
  cmEmissionColorVersion = 0;
  cmEmissionColorFullVersion = 0;
  cmEmissionColorDirtyRegions = [];
  cmExploredMap = undefined!;
  cmExploredVersion = 0;
  cmExploredFullVersion = 0;
  cmExploredDirtyRegions = [];
  cmFarMaterialMap = undefined!;
  cmFarMaterialVersion = 0;
  cmFarMaterialFullVersion = 0;
  cmFarMaterialDirtyRegions = [];
  cmMemoryMaterialMap = undefined!;
  cmMemoryMaterialVersion = 0;
  cmMemoryMaterialFullVersion = 0;
  cmMemoryMaterialDirtyRegions = [];
  cmCustomShapesPendingIndices = [];
  cmCustomShapesFullResync = true;
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
  cmGeneratorKey = undefined;
  cmEmissionColorChannel = undefined;
  cmSmoothingWeightsChannel = undefined;
  cmExploredChannel = undefined;
  cmFarMaterialChannel = undefined;
  cmMemoryMaterialChannel = undefined;
  cmPendingBufferCleanup = [];
  cmMeshCache.clear();
  // A disposed component must never leave a `setCells` caller awaiting
  // forever -- reject every outstanding waiter before dropping the queue.
  if (cmPendingSetCells) {
    for (const waiter of cmPendingSetCells.waiters) {
      waiter.reject(
        new Error('[cell-map] setCells cancelled: component disposed'),
      );
    }
    cmPendingSetCells = null;
  }
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
      cmCustomShapesFullResync = true;
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
    get emissionColorVersion() {
      return cmEmissionColorVersion;
    },
    set emissionColorVersion(v) {
      cmEmissionColorVersion = v;
    },
    get emissionColorFullVersion() {
      return cmEmissionColorFullVersion;
    },
    set emissionColorFullVersion(v) {
      cmEmissionColorFullVersion = v;
    },
    get emissionColorDirtyRegions() {
      return cmEmissionColorDirtyRegions;
    },
    set emissionColorDirtyRegions(v) {
      cmEmissionColorDirtyRegions = v;
    },
    get exploredMap() {
      return cmExploredMap;
    },
    set exploredMap(v) {
      cmExploredMap = v;
    },
    get exploredVersion() {
      return cmExploredVersion;
    },
    set exploredVersion(v) {
      cmExploredVersion = v;
    },
    get exploredFullVersion() {
      return cmExploredFullVersion;
    },
    set exploredFullVersion(v) {
      cmExploredFullVersion = v;
    },
    get exploredDirtyRegions() {
      return cmExploredDirtyRegions;
    },
    set exploredDirtyRegions(v) {
      cmExploredDirtyRegions = v;
    },
    get farMaterialMap() {
      return cmFarMaterialMap;
    },
    set farMaterialMap(v) {
      cmFarMaterialMap = v;
    },
    get farMaterialVersion() {
      return cmFarMaterialVersion;
    },
    set farMaterialVersion(v) {
      cmFarMaterialVersion = v;
    },
    get farMaterialFullVersion() {
      return cmFarMaterialFullVersion;
    },
    set farMaterialFullVersion(v) {
      cmFarMaterialFullVersion = v;
    },
    get farMaterialDirtyRegions() {
      return cmFarMaterialDirtyRegions;
    },
    set farMaterialDirtyRegions(v) {
      cmFarMaterialDirtyRegions = v;
    },
    get memoryMaterialMap() {
      return cmMemoryMaterialMap;
    },
    set memoryMaterialMap(v) {
      cmMemoryMaterialMap = v;
    },
    get memoryMaterialVersion() {
      return cmMemoryMaterialVersion;
    },
    set memoryMaterialVersion(v) {
      cmMemoryMaterialVersion = v;
    },
    get memoryMaterialFullVersion() {
      return cmMemoryMaterialFullVersion;
    },
    set memoryMaterialFullVersion(v) {
      cmMemoryMaterialFullVersion = v;
    },
    get memoryMaterialDirtyRegions() {
      return cmMemoryMaterialDirtyRegions;
    },
    set memoryMaterialDirtyRegions(v) {
      cmMemoryMaterialDirtyRegions = v;
    },
    get customShapesPendingIndices() {
      return cmCustomShapesPendingIndices;
    },
    set customShapesPendingIndices(v) {
      cmCustomShapesPendingIndices = v;
    },
    get customShapesFullResync() {
      return cmCustomShapesFullResync;
    },
    set customShapesFullResync(v) {
      cmCustomShapesFullResync = v;
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
   * generative path's per-cell baseline). Returning `undefined` falls back
   * to empty/air. Always used for single-cell point queries, regardless of
   * whether `generateChunk` is also supplied. Must be a pure function of its
   * coordinates for a given world/seed.
   *
   * Accepts either a live function (default; can't be serialized, so a
   * component built this way doesn't round-trip its generator through
   * save/load) or a string key registered via
   * `registerMethod('cell-map-generator', key, fn)`, resolved at
   * construction/deserialize time — a registry-keyed generator does survive
   * save/load, since `serialize()` can emit the key instead of the function.
   */
  generateCell?:
    | ((worldX: number, worldY: number, worldZ: number) => CellData | undefined)
    | string;

  /**
   * Generates a whole chunk's cell data at once (`chunkSize.x*y*z`-length
   * array, x-fastest/y/z-slowest local order) — a performance escape hatch
   * for whole-chunk materialization, preferred over looping `generateCell`
   * when both are supplied. Never used for single-cell point queries.
   *
   * Same live-function-or-registry-key shape as `generateCell`, resolved
   * independently (its own key in the same `'cell-map-generator'`
   * namespace — not necessarily the same key as `generateCell`'s).
   */
  generateChunk?: ((cx: number, cy: number, cz: number) => CellData[]) | string;

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
   * `CellMap.setFocus(component, worldX, worldY, worldZ)` instead.
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
  /** Monotonic version; see cmEmissionColorVersion. */
  emissionColorVersion: number;
  /** Full-reupload threshold; see cmEmissionColorFullVersion. */
  emissionColorFullVersion: number;
  /** Per-cell dirty log for delta GPU uploads; see cmEmissionColorDirtyRegions. */
  emissionColorDirtyRegions: CellEmissionColorDirtyRegion[];
  /** Chunk-level fog-of-war "explored" state (one flag per chunk); see cmExploredMap. */
  exploredMap: Array3D<number>;
  /** Monotonic version; see cmExploredVersion. */
  exploredVersion: number;
  /** Full-reupload threshold; see cmExploredFullVersion. */
  exploredFullVersion: number;
  /** Per-chunk dirty log for delta GPU uploads; see cmExploredDirtyRegions. */
  exploredDirtyRegions: ChunkExploredDirtyRegion[];
  /** Far-tier per-chunk representative material (separate from exploredMap's binary flag); see cmFarMaterialMap. */
  farMaterialMap: Array3D<number>;
  /** Monotonic version; see cmFarMaterialVersion. */
  farMaterialVersion: number;
  /** Full-reupload threshold; see cmFarMaterialFullVersion. */
  farMaterialFullVersion: number;
  /** Per-chunk dirty log for delta GPU uploads; see cmFarMaterialDirtyRegions. */
  farMaterialDirtyRegions: ChunkExploredDirtyRegion[];
  /** Near-tier per-cell captured-material snapshot; see cmMemoryMaterialMap. */
  memoryMaterialMap: Array3D<number>;
  /** Monotonic version; see cmMemoryMaterialVersion. */
  memoryMaterialVersion: number;
  /** Full-reupload threshold; see cmMemoryMaterialFullVersion. */
  memoryMaterialFullVersion: number;
  /** Per-cell dirty log for delta GPU uploads; see cmMemoryMaterialDirtyRegions. */
  memoryMaterialDirtyRegions: MemoryMaterialDirtyRegion[];
  /** Indices into meshes (>= 2) pending upload to WASM; see cmCustomShapesPendingIndices. */
  customShapesPendingIndices: number[];
  /** Forces a full custom-shape re-upload on the next rebuild pass; see cmCustomShapesFullResync. */
  customShapesFullResync: boolean;
  visibilityMap: Array3D<boolean>;

  // World configuration
  cellSize: Vector3D;
  /**
   * Size, in cells, of the currently-resident hot window — *not* the whole
   * world. Constant for the session (window size never changes; only its
   * origin does, once something moves the focus — see `window`). Renamed in
   * meaning, not in name, from the pre-windowing "whole map" semantics.
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
  'emissionColorVersion',
  'emissionColorFullVersion',
  'emissionColorDirtyRegions',
  'exploredMap',
  'exploredVersion',
  'exploredFullVersion',
  'exploredDirtyRegions',
  'farMaterialMap',
  'farMaterialVersion',
  'farMaterialFullVersion',
  'farMaterialDirtyRegions',
  'memoryMaterialMap',
  'memoryMaterialVersion',
  'memoryMaterialFullVersion',
  'memoryMaterialDirtyRegions',
  'customShapesPendingIndices',
  'customShapesFullResync',
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
    meshedAtEdge: false,
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

/** Default per-frame time budget, in milliseconds, for `CellMap.advanceSetCells`'s write loop. */
export const DEFAULT_SET_CELLS_BUDGET_MS = 4;

interface PendingSetCellsEntry {
  x: number;
  y: number;
  z: number;
  data: CellData;
}

interface PendingSetCellsWaiter {
  /** `cursor` value at which this call's own entries are fully applied. */
  targetCursor: number;
  resolve: () => void;
  reject: (err: Error) => void;
}

/**
 * A `CellMap.setCells` batch in flight, drained a few entries at a time by
 * `CellMap.advanceSetCells` (called unconditionally every frame from the
 * render loop, same as `advanceWindowGeneration`). `entries`/`cursor` mirror
 * `CellWindow`'s own `pendingShift.queue`/`queueIndex` cursor shape -- a
 * cursor over an array, not a splice, so appending a second in-flight
 * `setCells` call is just a push. `waiters` lets multiple overlapping
 * `setCells` calls each resolve at the right point: since draining is
 * strictly FIFO by `cursor`, a waiter registered at `targetCursor` resolves
 * exactly when `cursor` reaches it, in registration order, with no separate
 * per-call queue needed.
 */
interface PendingSetCells {
  entries: PendingSetCellsEntry[];
  cursor: number;
  budgetMs: number;
  waiters: PendingSetCellsWaiter[];
}

let cmPendingSetCells: PendingSetCells | null = null;

/**
 * Appends `entries` to the in-flight `setCells` batch (starting one if none
 * is active) and returns a Promise that resolves once THESE entries (not
 * necessarily the whole queue, if other calls added more after) have been
 * applied by `advanceSetCells`.
 */
export function enqueuePendingSetCells(
  entries: PendingSetCellsEntry[],
  budgetMs: number | undefined,
): Promise<void> {
  if (!cmPendingSetCells) {
    cmPendingSetCells = {
      entries: [],
      cursor: 0,
      budgetMs: DEFAULT_SET_CELLS_BUDGET_MS,
      waiters: [],
    };
  }
  if (budgetMs !== undefined) cmPendingSetCells.budgetMs = budgetMs;
  cmPendingSetCells.entries.push(...entries);
  const targetCursor = cmPendingSetCells.entries.length;
  return new Promise<void>((resolve, reject) => {
    cmPendingSetCells!.waiters.push({ targetCursor, resolve, reject });
  });
}

/** The in-flight `setCells` batch, or null if none is pending. */
export function getPendingSetCells(): PendingSetCells | null {
  return cmPendingSetCells;
}

/** Drops the in-flight `setCells` batch entirely, without resolving/rejecting its waiters. */
export function clearPendingSetCells(): void {
  cmPendingSetCells = null;
}

/**
 * Bounded cache of recently-evicted chunk meshes, keyed by world-chunk
 * coordinate -- sits between "evicted from the resident window" and
 * "actually discarded," so revisiting recently-seen terrain can reuse an
 * already-built mesh (and its already-uploaded GPU buffers) instead of
 * re-running WASM meshing from scratch. A fixed internal constant, not a
 * tunable field, matching this effort's established "no unnecessary
 * tunables" choice. A plain `Map` doubles as the LRU structure: re-`set`ting
 * an existing key moves it to "most recently used" (end of iteration order),
 * so the oldest entry is always `.keys().next().value`.
 */
const MESH_CACHE_CAPACITY = 128;
const cmMeshCache = new Map<string, ChunkMesh>();

function meshCacheKey(cx: number, cy: number, cz: number): string {
  return `${cx},${cy},${cz}`;
}

/**
 * Hands a chunk that just left the resident window to the cache instead of
 * discarding it immediately. Evicts (and queues for GPU cleanup) the oldest
 * cached entry if this pushes the cache over capacity.
 */
function cacheEvictedChunk(
  wcx: number,
  wcy: number,
  wcz: number,
  chunk: ChunkMesh,
): void {
  const key = meshCacheKey(wcx, wcy, wcz);
  cmMeshCache.delete(key);
  cmMeshCache.set(key, chunk);
  if (cmMeshCache.size > MESH_CACHE_CAPACITY) {
    const oldestKey = cmMeshCache.keys().next().value;
    if (oldestKey !== undefined) {
      const overflow = cmMeshCache.get(oldestKey);
      cmMeshCache.delete(oldestKey);
      if (overflow) queueBufferCleanup([overflow]);
    }
  }
}

/**
 * Reclaims a cached chunk for reuse (removing it from the cache), or
 * `undefined` on a cache miss. Called from `reassembleChunks` when a
 * newly-exposed window slot has no match in the previous window.
 */
function takeCachedChunk(
  wcx: number,
  wcy: number,
  wcz: number,
): ChunkMesh | undefined {
  const key = meshCacheKey(wcx, wcy, wcz);
  const chunk = cmMeshCache.get(key);
  if (chunk) cmMeshCache.delete(key);
  return chunk;
}

/**
 * Purges a world-chunk coordinate from the mesh cache, if present, queuing
 * its GPU buffers for cleanup same as any other eviction. A cached chunk's
 * mesh bakes in face-culling decisions against whatever neighbor data was
 * present when it was cached -- an edit to that chunk, or to a face-adjacent
 * neighbor's boundary-facing cell, can invalidate that, so `markChunksDirty`
 * calls this unconditionally (regardless of whether the coordinate is
 * currently resident) for the edited chunk and each face-adjacent neighbor.
 * No-ops cleanly on a miss.
 */
export function invalidateCachedChunk(
  wcx: number,
  wcy: number,
  wcz: number,
): void {
  const key = meshCacheKey(wcx, wcy, wcz);
  const chunk = cmMeshCache.get(key);
  if (!chunk) return;
  cmMeshCache.delete(key);
  queueBufferCleanup([chunk]);
}

/**
 * Rebuilds the window-local chunk-mesh array for a shift/resize from
 * `oldOrigin` to `newOrigin`/`newGridDims`, mirroring `CellWindow`'s own
 * private `reassemble` (same world-chunk-coordinate overlap test, applied to
 * JS mesh objects instead of WASM cell data): a chunk whose world-chunk-
 * coordinate stays resident keeps its already-built mesh untouched -- its
 * vertex data is baked to absolute world-space at mesh-build time (see
 * `bakeWorldOffsetInPlace` in mesh-builder.ts), so moving to a different
 * local slot is pure bookkeeping (`cx/cy/cz` only), no vertex edit, no
 * `gpuDirty`, no re-upload. A chunk that just left the window is handed to
 * the bounded mesh cache (`cacheEvictedChunk`) instead of being discarded
 * immediately. A chunk entering a slot with no match in the old window first
 * checks that cache (`takeCachedChunk`) before falling back to a fresh
 * `dirty` entry (same shape `initChunks` produces) -- either way (cache hit
 * or fresh), it re-dirties any REUSED neighbor sharing a face with it, since
 * that neighbor's mesh was built without knowledge of this newly-available
 * data and its cross-chunk face culling at that boundary is now stale (see
 * the face-adjacency pass below). Serves both a same-size shift
 * (`CellMap.setFocus`) and a resize (`CellMap.setWindowRadius`), same as
 * `CellWindow.reassemble` does for cell data.
 */
export function reassembleChunks(
  oldChunks: ChunkMesh[],
  oldOrigin: ChunkCoord | null,
  newOrigin: ChunkCoord,
  newGridDims: { x: number; y: number; z: number },
): ChunkMesh[] {
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
          // Vertex data is baked to absolute world-space at mesh-build time
          // (see `bakeWorldOffsetInPlace` in mesh-builder.ts) -- a chunk's
          // true world position never changes, so moving to a different
          // local slot is pure bookkeeping. No vertex translation, no
          // gpuDirty, no re-upload needed.
          chunk.cx = cx;
          chunk.cy = cy;
          chunk.cz = cz;
          chunks.push(chunk);
          isNewSlot.push(false);
        } else {
          const cached = takeCachedChunk(wcx, wcy, wcz);
          if (cached) {
            cached.cx = cx;
            cached.cy = cy;
            cached.cz = cz;
            // Its mesh may have culled faces against an unknown (not-yet-
            // loaded) neighbor when it was last built (EDGE_OCCLUDES) --
            // if so, that assumption may no longer hold now that it's
            // re-entering the window, so force a remesh against whatever's
            // actually there now. See ChunkMesh.meshedAtEdge's doc comment.
            if (cached.meshedAtEdge) {
              cached.dirty = true;
            }
            chunks.push(cached);
          } else {
            chunks.push(freshChunkMesh(cx, cy, cz));
          }
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
  const dirtyIfReused = (i: number): void => {
    if (isNewSlot[i] || chunks[i].dirty) return;
    chunks[i].dirty = true;
  };
  for (let cz = 0; cz < newGridDims.z; cz++) {
    for (let cy = 0; cy < newGridDims.y; cy++) {
      for (let cx = 0; cx < newGridDims.x; cx++) {
        if (!isNewSlot[localIndex(cx, cy, cz)]) continue;
        if (cx > 0) dirtyIfReused(localIndex(cx - 1, cy, cz));
        if (cx < newGridDims.x - 1) dirtyIfReused(localIndex(cx + 1, cy, cz));
        if (cy > 0) dirtyIfReused(localIndex(cx, cy - 1, cz));
        if (cy < newGridDims.y - 1) dirtyIfReused(localIndex(cx, cy + 1, cz));
        if (cz > 0) dirtyIfReused(localIndex(cx, cy, cz - 1));
        if (cz < newGridDims.z - 1) dirtyIfReused(localIndex(cx, cy, cz + 1));
      }
    }
  }

  // Anything left in oldByWorldCoord fell outside the new window -- hand it
  // to the mesh cache instead of discarding it immediately.
  for (const { chunk, wcx, wcy, wcz } of oldByWorldCoord.values()) {
    cacheEvictedChunk(wcx, wcy, wcz, chunk);
  }
  return chunks;
}

/**
 * Resolves `CellMapOptions.generateCell`/`generateChunk` (each either a live
 * function or a `MethodRegistry['cell-map-generator']` key) into plain
 * functions, plus whichever keys were used (for `serialize()` to remember —
 * see `cmGeneratorKey`). A string that doesn't resolve to a registered
 * function is a construction-time error, not a silent no-op generator.
 */
function resolveGeneratorOptions(options: CellMapOptions): {
  generateCell?: (x: number, y: number, z: number) => CellData | undefined;
  generateChunk?: (cx: number, cy: number, cz: number) => CellData[];
  key: { generateCell?: string; generateChunk?: string } | undefined;
} {
  let generateCell =
    typeof options.generateCell === 'function'
      ? options.generateCell
      : undefined;
  let generateChunk =
    typeof options.generateChunk === 'function'
      ? options.generateChunk
      : undefined;
  const key: { generateCell?: string; generateChunk?: string } = {};

  if (typeof options.generateCell === 'string') {
    const fn = MethodRegistry['cell-map-generator'][options.generateCell] as
      | ((x: number, y: number, z: number) => CellData | undefined)
      | undefined;
    if (typeof fn !== 'function') {
      throw new Error(
        `CellMap: generateCell key "${options.generateCell}" is not ` +
          `registered in MethodRegistry['cell-map-generator'] -- call ` +
          `registerMethod('cell-map-generator', '${options.generateCell}', fn) ` +
          `before constructing/loading this cell-map`,
      );
    }
    generateCell = fn;
    key.generateCell = options.generateCell;
  }
  if (typeof options.generateChunk === 'string') {
    const fn = MethodRegistry['cell-map-generator'][options.generateChunk] as
      | ((cx: number, cy: number, cz: number) => CellData[])
      | undefined;
    if (typeof fn !== 'function') {
      throw new Error(
        `CellMap: generateChunk key "${options.generateChunk}" is not ` +
          `registered in MethodRegistry['cell-map-generator'] -- call ` +
          `registerMethod('cell-map-generator', '${options.generateChunk}', fn) ` +
          `before constructing/loading this cell-map`,
      );
    }
    generateChunk = fn;
    key.generateChunk = options.generateChunk;
  }

  return {
    generateCell,
    generateChunk,
    key: key.generateCell || key.generateChunk ? key : undefined,
  };
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
  // World-chunk coordinate the dense array's local (0,0,0) chunk maps to.
  // Defaults to the map's own origin (the legacy authored-map path, where
  // world coordinates and the authored map's coordinates are the same
  // space); `deserialize()`'s windowed path passes the resident window's
  // actual saved world-chunk origin instead.
  originChunk: { cx: number; cy: number; cz: number } = { cx: 0, cy: 0, cz: 0 },
  // When true, store every chunk regardless of whether it matches the
  // literal `EMPTY_CELL` baseline. The default (skip literal-empty chunks)
  // is only correct when there's no generator -- with a generator, a
  // literal-empty saved chunk still needs an explicit cold-storage entry, or
  // a later reassemble falls through to the generator's own (possibly
  // non-empty) output for that chunk and silently resurrects content the
  // save was supposed to represent as cleared. `deserialize()`'s windowed
  // path (which may have a generator) always passes `true`; this is a
  // one-time load-time call, so the extra storage is not a hot-path cost.
  forceStoreAll = false,
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
              if (forceStoreAll || value !== EMPTY_CELL) differs = true;
            }
          }
        }
        if (differs) {
          coldStorage.set(
            originChunk.cx + cx,
            originChunk.cy + cy,
            originChunk.cz + cz,
            cells,
          );
        }
      }
    }
  }
}

/**
 * Resyncs the public `cmEmissionColorMap`/`cmSmoothingWeights` fields from
 * the two auxiliary channels' current resident content, at the given cell
 * dimensions. Shared by the initial synchronous call every construction path
 * makes right after constructing the channels (see `makeAuxiliaryOnReassemble`'s
 * doc comment for why that call is necessary, not just the hook) and by
 * `onReassemble`'s own per-shift call.
 *
 * Every call is treated as a full invalidation of `cmEmissionColorMap`'s
 * dirty-region log: `emissionArr` below is a wholesale content swap (a
 * window shift reallocates and re-copies into new LOCAL coordinates, per
 * `AuxiliaryChannel.onWindowChange`), so any region logged before this call
 * means neither the coordinates nor the content it described anymore.
 * Bumping `cmEmissionColorVersion`/`cmEmissionColorFullVersion` together
 * (mirroring atlas-manager's own full-invalidate) forces every camera --
 * even one already caught up to the pre-call version -- through exactly one
 * full rebuild, and lets the now-stale log simply be dropped rather than
 * actively reconciled.
 *
 * `forceSmoothingReassign`: `smoothingWeights` has no live per-cell setter,
 * so when the channel is uniform AND the window's cell dimensions haven't
 * changed, its resident content is provably byte-identical after the shift
 * -- skip reassigning `cmSmoothingWeights` in that case. This matters:
 * `mesh-builder.ts`'s rebuild cache busts on reference-inequality
 * (`lastSmoothingWeights !== cellMap.smoothingWeights`), so reassigning
 * unconditionally on every plain shift would force a whole-window WASM
 * re-upload on ordinary camera movement, re-breaking the exact perf win
 * that cache exists for. Callers must pass `true` here for the very first
 * assignment (no prior value to preserve) AND for any commit whose cell
 * dimensions differ from the previous commit's (a resize) -- even a
 * *uniform* weight's array must be reallocated to the new size, or
 * `mesh-builder.ts` hands WASM a buffer sized for the old (smaller) window
 * while claiming the new cell count, an out-of-bounds read that traps.
 */
function syncAuxiliaryFields(
  emissionChannel: AuxiliaryChannel,
  smoothingChannel: AuxiliaryChannel,
  memoryMaterialChannel: AuxiliaryChannel,
  cellDims: { x: number; y: number; z: number },
  forceSmoothingReassign: boolean,
): void {
  const dims = new Vector3D(cellDims.x, cellDims.y, cellDims.z);

  const emissionArr = new Array3D<number>(dims, 0);
  emissionArr.value = Array.from(emissionChannel.value);
  cmEmissionColorMap = emissionArr;
  cmEmissionColorVersion++;
  cmEmissionColorFullVersion = cmEmissionColorVersion;
  cmEmissionColorDirtyRegions = [];

  const memoryMaterialArr = new Array3D<number>(dims, 0xffff);
  memoryMaterialArr.value = Array.from(memoryMaterialChannel.value);
  cmMemoryMaterialMap = memoryMaterialArr;
  cmMemoryMaterialVersion++;
  cmMemoryMaterialFullVersion = cmMemoryMaterialVersion;
  cmMemoryMaterialDirtyRegions = [];

  if (smoothingChannel.canDiverge || forceSmoothingReassign) {
    const weightsArr = new Array3D<number>(dims, 8);
    weightsArr.value = Array.from(smoothingChannel.value);
    cmSmoothingWeights = new Array3Di(weightsArr, 8, [4, 4], 'clamp');
  }
}

/**
 * Resyncs the public `cmExploredMap` field from the explored channel's
 * current resident content, at the given CHUNK-GRID dimensions. Modeled on
 * `syncAuxiliaryFields` above, but simpler: only one channel (not two), and
 * always reassigns unconditionally -- there's no `forceSmoothingReassign`-
 * style "provably unchanged" skip here, since explored state has a live
 * per-chunk setter (`CellMap.setChunkExplored`) and can diverge at any time.
 *
 * `chunkGridDims` -- note this is the window's size in CHUNKS
 * (`cmChunkGridSize`/`CellWindow.gridDimensions`), not cells: `exploredChannel`
 * is an `AuxiliaryChannel` constructed with `chunkSize: {x:1,y:1,z:1}`, so in
 * its own coordinate space "cell" IS "chunk" -- its `.value` already holds
 * one entry per chunk.
 */
function syncExploredField(
  exploredChannel: AuxiliaryChannel,
  farMaterialChannel: AuxiliaryChannel,
  chunkGridDims: { x: number; y: number; z: number },
): void {
  const dims = new Vector3D(chunkGridDims.x, chunkGridDims.y, chunkGridDims.z);
  const exploredArr = new Array3D<number>(dims, 0);
  exploredArr.value = Array.from(exploredChannel.value);
  cmExploredMap = exploredArr;
  cmExploredVersion++;
  cmExploredFullVersion = cmExploredVersion;
  cmExploredDirtyRegions = [];

  const farMaterialArr = new Array3D<number>(dims, 0xffff);
  farMaterialArr.value = Array.from(farMaterialChannel.value);
  cmFarMaterialMap = farMaterialArr;
  cmFarMaterialVersion++;
  cmFarMaterialFullVersion = cmFarMaterialVersion;
  cmFarMaterialDirtyRegions = [];
}

/**
 * Builds the `CellWindow.onReassemble` handler shared by every construction
 * path (`builder()`'s legacy branch, `builderGenerative()`, `deserialize()`)
 * -- drives `emissionColorMap`/`smoothingWeights`/`exploredMap`'s own
 * windowed persistence (see `auxiliary-channel.ts`) and keeps the public
 * fields in sync via `syncAuxiliaryFields`/`syncExploredField`.
 *
 * Fires on every commit -- but NOT necessarily the very first one
 * synchronously: a window whose initial construction needs staged
 * generation (any chunk not already resolvable from cold storage, e.g. any
 * generative-path map with the default `windowRadius`) doesn't commit its
 * first `reassemble()` inside the constructor's own `setFocus()` call; it
 * can take several frames of `advanceWindowGeneration` to drain. Each
 * construction path therefore also calls `syncAuxiliaryFields`/
 * `syncExploredField` directly, once, synchronously, right after
 * constructing the channels (before `new CellWindow(...)`) -- so
 * `cmSmoothingWeights`/`cmExploredMap` are never left `undefined` between
 * construction and whenever this hook first actually fires.
 *
 * `exploredChannel` is remapped when calling its own `onWindowChange`:
 * `exploredChannel` was constructed with `chunkSize: {x:1,y:1,z:1}`, so in
 * ITS coordinate space "cellDims" means the same thing `gridDims` means to
 * the primary window (one unit per chunk) -- feed it `gridDims`'s value for
 * both `cellDims` and `gridDims` so its internal eviction/assembly math
 * (which iterates `gridDims` chunks and indexes `cellDims`-shaped flat
 * arrays) operates on the chunk-grid, not the cell-grid.
 */
function makeAuxiliaryOnReassemble(
  emissionChannel: AuxiliaryChannel,
  smoothingChannel: AuxiliaryChannel,
  exploredChannel: AuxiliaryChannel,
  memoryMaterialChannel: AuxiliaryChannel,
  farMaterialChannel: AuxiliaryChannel,
): NonNullable<WindowConfig['onReassemble']> {
  return (_old, next) => {
    emissionChannel.onWindowChange(_old, next);
    smoothingChannel.onWindowChange(_old, next);
    memoryMaterialChannel.onWindowChange(_old, next);
    exploredChannel.onWindowChange(
      {
        origin: _old.origin,
        gridDims: _old.gridDims,
        cellDims: _old.gridDims,
      },
      {
        origin: next.origin,
        gridDims: next.gridDims,
        cellDims: next.gridDims,
      },
    );
    // Same {1,1,1}-trick coordinate remap `exploredChannel` gets above --
    // farMaterialChannel is chunk-granular the same way.
    farMaterialChannel.onWindowChange(
      {
        origin: _old.origin,
        gridDims: _old.gridDims,
        cellDims: _old.gridDims,
      },
      {
        origin: next.origin,
        gridDims: next.gridDims,
        cellDims: next.gridDims,
      },
    );
    cmNeedsGPUUpdate = true;
    const dimsChanged =
      _old.cellDims.x !== next.cellDims.x ||
      _old.cellDims.y !== next.cellDims.y ||
      _old.cellDims.z !== next.cellDims.z;
    syncAuxiliaryFields(
      emissionChannel,
      smoothingChannel,
      memoryMaterialChannel,
      next.cellDims,
      _old.origin === null || dimsChanged,
    );
    syncExploredField(exploredChannel, farMaterialChannel, next.gridDims);
  };
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
  const smoothingIsUniform = typeof rawWeight === 'number';
  let smoothingBaselineValue = 8;
  if (typeof rawWeight === 'number') {
    const clamped = Math.max(0, Math.min(15, Math.round(rawWeight)));
    weightsArray3D = new Array3D<number>(mapSize, clamped);
    smoothingBaselineValue = clamped;
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

  // emissionColorMap/smoothingWeights' own windowed persistence -- seeded
  // from the authored whole-map data before the window's first `setFocus`,
  // mirroring `chunkDenseArrayIntoColdStorage` above exactly (see
  // `auxiliary-channel.ts`).
  const initialCellDims = {
    x: (2 * radius.x + 1) * optChunkSize.x,
    y: (2 * radius.y + 1) * optChunkSize.y,
    z: (2 * radius.z + 1) * optChunkSize.z,
  };
  // Initial CHUNK-GRID dims (not cell dims) -- for `exploredChannel` below,
  // which tracks fog-of-war "explored" state at one flag per chunk.
  const initialChunkGridDims = {
    x: 2 * radius.x + 1,
    y: 2 * radius.y + 1,
    z: 2 * radius.z + 1,
  };
  const emissionChannel = new AuxiliaryChannel({
    chunkSize: optChunkSize,
    baselineValue: 0,
    trackDivergence: true,
    initialCellDims,
  });
  emissionChannel.seedFromDense(optEmissionColorMap.value, mapSize);
  const smoothingChannel = new AuxiliaryChannel({
    chunkSize: optChunkSize,
    baselineValue: smoothingBaselineValue,
    trackDivergence: !smoothingIsUniform,
    initialCellDims,
  });
  smoothingChannel.seedFromDense(weightsArray3D.value, mapSize);
  // Fog-of-war "explored" state starts empty/unexplored everywhere -- no
  // authored data to seed from at construction (unlike emission color/
  // smoothing weights above).
  const exploredChannel = new AuxiliaryChannel({
    chunkSize: { x: 1, y: 1, z: 1 },
    baselineValue: 0,
    trackDivergence: true,
    initialCellDims: initialChunkGridDims,
  });
  // Far-tier representative-material channel -- same {1,1,1} trick as
  // exploredChannel (chunk-granular), but a SEPARATE channel/texture rather
  // than packed into exploredChannel's payload (see cmFarMaterialMap's doc
  // comment for why: exploredChannel is linearly filtered GPU-side to blend
  // the fog boundary smoothly, which would corrupt a bit-packed material
  // index). Baseline 0xFFFF ("never captured"). No authored data to seed
  // from at construction, same as exploredChannel.
  const farMaterialChannel = new AuxiliaryChannel({
    chunkSize: { x: 1, y: 1, z: 1 },
    baselineValue: 0xffff,
    trackDivergence: true,
    initialCellDims: initialChunkGridDims,
  });
  // Near-tier "captured material" snapshot -- real chunk granularity (same
  // chunkSize/initialCellDims as emissionChannel above, NOT the {1,1,1}
  // trick), baseline 0xFFFF ("never captured") since material index 0 is a
  // legitimate real value. No authored data to seed from at construction,
  // same as exploredChannel.
  const memoryMaterialChannel = new AuxiliaryChannel({
    chunkSize: optChunkSize,
    baselineValue: 0xffff,
    trackDivergence: true,
    initialCellDims,
  });
  // Synchronous initial assignment -- see `makeAuxiliaryOnReassemble`'s doc
  // comment for why this can't wait for the hook alone.
  syncAuxiliaryFields(
    emissionChannel,
    smoothingChannel,
    memoryMaterialChannel,
    initialCellDims,
    true,
  );
  syncExploredField(exploredChannel, farMaterialChannel, initialChunkGridDims);

  const window = new CellWindow(
    {
      chunkSize: optChunkSize,
      radius,
      emptyCell: EMPTY_CELL,
      onReassemble: makeAuxiliaryOnReassemble(
        emissionChannel,
        smoothingChannel,
        exploredChannel,
        memoryMaterialChannel,
        farMaterialChannel,
      ),
    },
    coldStorage,
  );
  // Force the initial window origin to (0,0,0): a focus point inside the
  // chunk at grid position `radius` puts origin = focusChunk - radius = 0.
  // With the default (coverage) radius this means the whole authored map is
  // resident from the start, world coordinate == window-local coordinate,
  // and every other read/write/render path stays exactly as it behaves
  // today -- see 08-live-construction-and-ownership.md for why this matters.
  // This first `setFocus` call resolves synchronously (everything's already
  // in cold storage), so `onReassemble` fires within this call, and
  // `cmEmissionColorMap`/`cmSmoothingWeights` are already correctly set by
  // the time the assignments below run.
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
  cmVisibilityMap = optVisibilityMap;
  cmCellSize = options.cellSize;
  cmChunkSize = optChunkSize;
  cmSmoothing = optSmoothing;
  cmNormalSmoothing = optNormalSmoothing;
  cmNeedsGPUUpdate = true;
  cmWindow = window;
  cmColdStorage = coldStorage;
  cmEmissionColorChannel = emissionChannel;
  cmSmoothingWeightsChannel = smoothingChannel;
  cmExploredChannel = exploredChannel;
  cmFarMaterialChannel = farMaterialChannel;
  cmMemoryMaterialChannel = memoryMaterialChannel;
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
  const smoothingIsUniform = typeof rawWeight === 'number';
  let weightsArray3D: Array3D<number>;
  let smoothingBaselineValue = 8;
  if (smoothingIsUniform) {
    const clamped = Math.max(0, Math.min(15, Math.round(rawWeight as number)));
    weightsArray3D = new Array3D<number>(windowCellDims, clamped);
    smoothingBaselineValue = clamped;
  } else {
    // A per-cell Array3D of custom weights is validated against the initial
    // window's own size (there's no whole-map mapSize on this path) --
    // survives future window shifts via the same windowed persistence
    // emissionColorMap gets, see `auxiliary-channel.ts`.
    if (
      rawWeight.size.x !== windowCellDims.x ||
      rawWeight.size.y !== windowCellDims.y ||
      rawWeight.size.z !== windowCellDims.z
    ) {
      throw new Error(
        'CellMap: a per-cell smoothingWeights Array3D on the generative path ' +
          `must match the initial window size (${windowCellDims.x},` +
          `${windowCellDims.y},${windowCellDims.z}), got (${rawWeight.size.x},` +
          `${rawWeight.size.y},${rawWeight.size.z})`,
      );
    }
    weightsArray3D = rawWeight;
  }

  // "Input maps preserved for reference" have no authored input to preserve
  // in the generative path -- sized to the initial window as inert
  // placeholders (materialMap/shapeMap/visibilityMap have no consumers
  // post-construction). emissionColorMap/smoothingWeights get real windowed
  // persistence via `AuxiliaryChannel` -- see `auxiliary-channel.ts`.
  const coldStorage = new ChunkColdStorage({
    chunkCellCount: optChunkSize.x * optChunkSize.y * optChunkSize.z,
  });
  // Initial CHUNK-GRID dims (not cell dims) -- for `exploredChannel` below.
  const windowChunkGridDims = {
    x: 2 * radius.x + 1,
    y: 2 * radius.y + 1,
    z: 2 * radius.z + 1,
  };
  const emissionChannel = new AuxiliaryChannel({
    chunkSize: optChunkSize,
    baselineValue: 0,
    trackDivergence: true,
    initialCellDims: windowCellDims,
  });
  const smoothingChannel = new AuxiliaryChannel({
    chunkSize: optChunkSize,
    baselineValue: smoothingBaselineValue,
    trackDivergence: !smoothingIsUniform,
    initialCellDims: windowCellDims,
  });
  if (!smoothingIsUniform) {
    smoothingChannel.seedFromDense(weightsArray3D.value, windowCellDims);
  }
  // Fog-of-war "explored" state starts empty/unexplored everywhere -- no
  // authored data to seed from at construction.
  const exploredChannel = new AuxiliaryChannel({
    chunkSize: { x: 1, y: 1, z: 1 },
    baselineValue: 0,
    trackDivergence: true,
    initialCellDims: windowChunkGridDims,
  });
  // Far-tier representative-material channel -- same {1,1,1} trick as
  // exploredChannel (chunk-granular), but a SEPARATE channel/texture -- see
  // the matching comment in builder()'s legacy path.
  const farMaterialChannel = new AuxiliaryChannel({
    chunkSize: { x: 1, y: 1, z: 1 },
    baselineValue: 0xffff,
    trackDivergence: true,
    initialCellDims: windowChunkGridDims,
  });
  // Near-tier "captured material" snapshot -- real chunk granularity (same
  // chunkSize/windowCellDims as emissionChannel above, NOT the {1,1,1}
  // trick), baseline 0xFFFF ("never captured"). No authored data to seed
  // from at construction, same as exploredChannel.
  const memoryMaterialChannel = new AuxiliaryChannel({
    chunkSize: optChunkSize,
    baselineValue: 0xffff,
    trackDivergence: true,
    initialCellDims: windowCellDims,
  });
  // Synchronous initial assignment -- see `makeAuxiliaryOnReassemble`'s doc
  // comment for why this can't wait for the hook alone (the default
  // windowRadius needs generation for every initial chunk, so the first
  // `onReassemble` doesn't fire synchronously here the way it does when
  // everything's cold-storage-resolvable).
  syncAuxiliaryFields(
    emissionChannel,
    smoothingChannel,
    memoryMaterialChannel,
    windowCellDims,
    true,
  );
  syncExploredField(exploredChannel, farMaterialChannel, windowChunkGridDims);
  const resolvedGenerator = resolveGeneratorOptions(options);
  const generator = wrapGenerator(
    resolvedGenerator.generateCell,
    resolvedGenerator.generateChunk,
  );
  const window = new CellWindow(
    {
      chunkSize: optChunkSize,
      radius,
      emptyCell: EMPTY_CELL,
      generator,
      onReassemble: makeAuxiliaryOnReassemble(
        emissionChannel,
        smoothingChannel,
        exploredChannel,
        memoryMaterialChannel,
        farMaterialChannel,
      ),
    },
    coldStorage,
  );
  // Same origin-zeroing trick as the legacy path -- see its comment above.
  // `onReassemble` fires within this call (see the matching comment there).
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
  cmVisibilityMap = new Array3D<boolean>(windowCellDims, true);
  cmCellSize = options.cellSize;
  cmChunkSize = optChunkSize;
  cmSmoothing = optSmoothing;
  cmNormalSmoothing = optNormalSmoothing;
  cmNeedsGPUUpdate = true;
  cmWindow = window;
  cmColdStorage = coldStorage;
  cmEmissionColorChannel = emissionChannel;
  cmSmoothingWeightsChannel = smoothingChannel;
  cmExploredChannel = exploredChannel;
  cmFarMaterialChannel = farMaterialChannel;
  cmMemoryMaterialChannel = memoryMaterialChannel;
  cmGeneratorKey = resolvedGenerator.key;
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

  // Dump the canonical WASM store to a flat array of 32-bit packed ints --
  // the resident window's contents, not the whole map (off-window content
  // lives in `coldStorageEntries` below).
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
    chunkSize: {
      _vectorType: 'Vector3D',
      x: cm.chunkSize.x,
      y: cm.chunkSize.y,
      z: cm.chunkSize.z,
    },
    windowRadius: {
      _vectorType: 'Vector3D',
      x: cm.window.radius.x,
      y: cm.window.radius.y,
      z: cm.window.radius.z,
    },
    // World-chunk coordinate of the window's local (0,0,0) corner. Restoring
    // this exactly (rather than re-zeroing, as the old whole-map-authored
    // format did) keeps the reloaded resident window anchored at the same
    // absolute world position it was saved at -- required for coldStorageEntries
    // (saved in absolute world-chunk coordinates) and any other saved world
    // position (e.g. a player transform) to still line up after reload.
    windowOrigin: cm.window.origin
      ? {
          cx: cm.window.origin.cx,
          cy: cm.window.origin.cy,
          cz: cm.window.origin.cz,
        }
      : undefined,
    // Off-window content that diverges from baseline.
    coldStorageEntries: cmColdStorage!.dumpEntries(),
    generatorKey: cmGeneratorKey,
    packedData: packedFlat,
    // Per-cell emission color lives outside the packed WASM cell store (it's a
    // separate texture-side channel), so persist it as its own flat RGB-int array.
    // Omitted when entirely black (0) to keep legacy scenes byte-identical.
    emissionColorData: cm.emissionColorMap.value.some((v) => v !== 0)
      ? Array.from(cm.emissionColorMap.value)
      : undefined,
    // Off-window emission-color highlights that diverge from baseline.
    emissionColorStorageEntries: cmEmissionColorChannel!.dumpEntries(),
    // Off-window fog-of-war "explored" chunks that diverge from baseline
    // (unexplored). Mirrors emissionColorStorageEntries above; unlike
    // emissionColorData, there is deliberately no separate resident-window
    // snapshot field for explored state per the wiring spec this followed.
    exploredStorageEntries: cmExploredChannel!.dumpEntries(),
    // Off-window far-tier representative-material chunks that diverge from
    // baseline (0xFFFF, "never captured"). Separate channel from
    // exploredStorageEntries -- see cmFarMaterialMap's doc comment.
    farMaterialStorageEntries: cmFarMaterialChannel!.dumpEntries(),
    // Off-window near-tier "captured material" cells that diverge from
    // baseline (0xFFFF, "never captured"). Mirrors emissionColorStorageEntries/
    // exploredStorageEntries above.
    memoryMaterialStorageEntries: cmMemoryMaterialChannel!.dumpEntries(),
    // smoothingWeights: the common case (a uniform number, no live setter)
    // just persists the configured value; a per-cell-authored map persists
    // its resident window plus off-window entries, the same shape as the
    // primary channel/emissionColorMap above.
    smoothingUniformWeight: cmSmoothingWeightsChannel!.canDiverge
      ? undefined
      : (cmSmoothingWeightsChannel!.value[0] ?? 8),
    smoothingWeightsData: cmSmoothingWeightsChannel!.canDiverge
      ? Array.from(cmSmoothingWeightsChannel!.value)
      : undefined,
    smoothingWeightStorageEntries: cmSmoothingWeightsChannel!.canDiverge
      ? cmSmoothingWeightsChannel!.dumpEntries()
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
    chunkSize: dataChunkSize,
    windowRadius: dataWindowRadius,
    windowOrigin: dataWindowOrigin,
    coldStorageEntries: dataColdStorageEntries,
    generatorKey: dataGeneratorKey,
    packedData: dataPackedData,
    emissionColorData: dataEmissionColorData,
    emissionColorStorageEntries: dataEmissionColorStorageEntries,
    exploredStorageEntries: dataExploredStorageEntries,
    farMaterialStorageEntries: dataFarMaterialStorageEntries,
    memoryMaterialStorageEntries: dataMemoryMaterialStorageEntries,
    smoothingUniformWeight: dataSmoothingUniformWeight,
    smoothingWeightsData: dataSmoothingWeightsData,
    smoothingWeightStorageEntries: dataSmoothingWeightStorageEntries,
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
  if (!dataCellSize) {
    errors.push({
      code: 'MISSING_DIMENSIONS',
      message: 'cell-map requires cellSize',
    });
  }
  if (!dataPackedData || !Array.isArray(dataPackedData)) {
    errors.push({
      code: 'MISSING_PACKED_DATA',
      message: 'cell-map requires packedData array',
    });
  }
  if (!dataWindowRadius || !dataWindowOrigin || !dataColdStorageEntries) {
    errors.push({
      code: 'UNSUPPORTED_SAVE_FORMAT',
      message:
        'cell-map requires windowRadius, windowOrigin, and coldStorageEntries ' +
        '-- this looks like a pre-1.0 save (whole-map format), which is not ' +
        'supported; there is no migration path for that format',
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

  // Reconstruct Vector3D for cellSize/chunkSize/windowRadius.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const cs = new Vector3D(dataCellSize.x, dataCellSize.y, dataCellSize.z);
  const cks =
    dataChunkSize && typeof dataChunkSize === 'object'
      ? // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        new Vector3D(dataChunkSize.x, dataChunkSize.y, dataChunkSize.z)
      : DEFAULT_CHUNK_SIZE;
  const radius = {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    x: dataWindowRadius.x as number,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    y: dataWindowRadius.y as number,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    z: dataWindowRadius.z as number,
  };
  const windowCellDims = new Vector3D(
    (2 * radius.x + 1) * cks.x,
    (2 * radius.y + 1) * cks.y,
    (2 * radius.z + 1) * cks.z,
  );
  // Initial CHUNK-GRID dims (not cell dims) -- for `dExploredChannel` below.
  const windowChunkGridDims = {
    x: 2 * radius.x + 1,
    y: 2 * radius.y + 1,
    z: 2 * radius.z + 1,
  };

  // Chunk size must be configured before any mesh_build_chunk* call, before
  // the window's initial load below (mirrors builder()).
  await initRenderWasm();
  setChunkSize(cks.x, cks.y, cks.z);

  // Resolve a registry-keyed generator, if the component was built with one
  // (a raw-function generator has no key and doesn't survive a round trip).
  // A saved key that's no longer registered degrades gracefully (the map
  // loads without that generator) rather than failing the whole load.
  let dGeneratorKey:
    | { generateCell?: string; generateChunk?: string }
    | undefined;
  let dResolvedGenerateCell:
    | ((x: number, y: number, z: number) => CellData | undefined)
    | undefined;
  let dResolvedGenerateChunk:
    | ((cx: number, cy: number, cz: number) => CellData[])
    | undefined;
  if (dataGeneratorKey && typeof dataGeneratorKey === 'object') {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const cellKey = dataGeneratorKey.generateCell as string | undefined;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const chunkKey = dataGeneratorKey.generateChunk as string | undefined;
    dGeneratorKey = {};
    if (cellKey) {
      const fn = MethodRegistry['cell-map-generator'][cellKey] as
        | ((x: number, y: number, z: number) => CellData | undefined)
        | undefined;
      if (typeof fn === 'function') {
        dResolvedGenerateCell = fn;
        dGeneratorKey.generateCell = cellKey;
      } else {
        errors.push({
          code: 'MISSING_GENERATOR',
          message:
            `cell-map's saved generateCell key "${cellKey}" is not registered ` +
            `in MethodRegistry['cell-map-generator'] -- register it before ` +
            'loading this scene; the map will load without that generator',
        });
      }
    }
    if (chunkKey) {
      const fn = MethodRegistry['cell-map-generator'][chunkKey] as
        | ((cx: number, cy: number, cz: number) => CellData[])
        | undefined;
      if (typeof fn === 'function') {
        dResolvedGenerateChunk = fn;
        dGeneratorKey.generateChunk = chunkKey;
      } else {
        errors.push({
          code: 'MISSING_GENERATOR',
          message:
            `cell-map's saved generateChunk key "${chunkKey}" is not registered ` +
            `in MethodRegistry['cell-map-generator'] -- register it before ` +
            'loading this scene; the map will load without that generator',
        });
      }
    }
  }
  const dGenerator = wrapGenerator(
    dResolvedGenerateCell,
    dResolvedGenerateChunk,
  );

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

  // Restore the window's exact saved world-chunk anchor (not re-zeroed) --
  // coldStorageEntries are keyed by absolute world-chunk coordinates, and any
  // other saved world position (e.g. a player transform) needs the resident
  // window anchored where it actually was, not reset to the map's origin.
  const originChunk = {
    cx: (dataWindowOrigin as { cx: number }).cx,
    cy: (dataWindowOrigin as { cy: number }).cy,
    cz: (dataWindowOrigin as { cz: number }).cz,
  };

  const dColdStorage = new ChunkColdStorage({
    chunkCellCount: cks.x * cks.y * cks.z,
  });

  dColdStorage.loadEntries(dataColdStorageEntries);
  // The resident window's saved snapshot -- chunked into cold storage at its
  // actual saved world-chunk location (not (0,0,0)) so the window's own
  // reassemble (triggered by `setFocus` below) pulls it into the live WASM
  // store the same way every other chunk load already works, rather than
  // bulk-writing the store directly.
  chunkDenseArrayIntoColdStorage(
    dColdStorage,
    dataPackedData as number[],
    windowCellDims,
    cks,
    originChunk,
    true, // forceStoreAll -- see the parameter's doc comment
  );

  // emissionColorMap/smoothingWeights' own windowed persistence -- same
  // pattern as the primary channel above (load off-window entries, seed the
  // resident window's saved snapshot at its actual saved origin).
  const dEmissionChannel = new AuxiliaryChannel({
    chunkSize: cks,
    baselineValue: 0,
    trackDivergence: true,
    initialCellDims: windowCellDims,
  });
  if (Array.isArray(dataEmissionColorStorageEntries)) {
    dEmissionChannel.loadEntries(dataEmissionColorStorageEntries);
  }
  if (Array.isArray(dataEmissionColorData)) {
    dEmissionChannel.seedFromDense(
      dataEmissionColorData as number[],
      windowCellDims,
      originChunk,
    );
  }

  const dSmoothingIsUniform = dataSmoothingUniformWeight !== undefined;
  const dSmoothingBaselineValue = dSmoothingIsUniform
    ? ((dataSmoothingUniformWeight as number) ?? 8)
    : 8;
  const dSmoothingChannel = new AuxiliaryChannel({
    chunkSize: cks,
    baselineValue: dSmoothingBaselineValue,
    trackDivergence: !dSmoothingIsUniform,
    initialCellDims: windowCellDims,
  });
  if (!dSmoothingIsUniform) {
    if (Array.isArray(dataSmoothingWeightStorageEntries)) {
      dSmoothingChannel.loadEntries(dataSmoothingWeightStorageEntries);
    }
    if (Array.isArray(dataSmoothingWeightsData)) {
      dSmoothingChannel.seedFromDense(
        dataSmoothingWeightsData as number[],
        windowCellDims,
        originChunk,
      );
    }
  }
  // Fog-of-war "explored" channel -- same pattern as the two channels above
  // (load off-window entries at their actual saved world-chunk locations).
  // There's no resident-window dense snapshot to seed from (unlike
  // emissionColorData) -- see the matching comment on `exploredStorageEntries`
  // in `serialize()` above.
  const dExploredChannel = new AuxiliaryChannel({
    chunkSize: { x: 1, y: 1, z: 1 },
    baselineValue: 0,
    trackDivergence: true,
    initialCellDims: windowChunkGridDims,
  });
  // Uses the channel's own `loadEntries` wrapper (delegates straight to
  // `coldStorage.loadEntries`) for consistency with `dEmissionChannel`/
  // `dSmoothingChannel` just above, rather than reaching into `.coldStorage`
  // directly.
  dExploredChannel.loadEntries(
    (dataExploredStorageEntries as ColdStorageEntrySnapshot[] | undefined) ??
      [],
  );

  // Far-tier representative-material channel -- same {1,1,1}-trick pattern
  // as dExploredChannel, but a SEPARATE channel -- see cmFarMaterialMap's
  // doc comment for why.
  const dFarMaterialChannel = new AuxiliaryChannel({
    chunkSize: { x: 1, y: 1, z: 1 },
    baselineValue: 0xffff,
    trackDivergence: true,
    initialCellDims: windowChunkGridDims,
  });
  dFarMaterialChannel.loadEntries(
    (dataFarMaterialStorageEntries as
      | ColdStorageEntrySnapshot[]
      | undefined) ?? [],
  );

  // Near-tier "captured material" channel -- same pattern as the two
  // channels above (load off-window entries at their actual saved
  // world-chunk locations). No resident-window dense snapshot to seed from
  // (unlike emissionColorData), same as dExploredChannel.
  const dMemoryMaterialChannel = new AuxiliaryChannel({
    chunkSize: cks,
    baselineValue: 0xffff,
    trackDivergence: true,
    initialCellDims: windowCellDims,
  });
  dMemoryMaterialChannel.loadEntries(
    (dataMemoryMaterialStorageEntries as
      | ColdStorageEntrySnapshot[]
      | undefined) ?? [],
  );

  // Synchronous initial assignment -- see `makeAuxiliaryOnReassemble`'s doc
  // comment for why this can't wait for the hook alone.
  syncAuxiliaryFields(
    dEmissionChannel,
    dSmoothingChannel,
    dMemoryMaterialChannel,
    windowCellDims,
    true,
  );
  syncExploredField(dExploredChannel, dFarMaterialChannel, windowChunkGridDims);

  const dWindow = new CellWindow(
    {
      chunkSize: cks,
      radius,
      emptyCell: EMPTY_CELL,
      generator: dGenerator,
      onReassemble: makeAuxiliaryOnReassemble(
        dEmissionChannel,
        dSmoothingChannel,
        dExploredChannel,
        dMemoryMaterialChannel,
        dFarMaterialChannel,
      ),
    },
    dColdStorage,
  );
  // `onReassemble` fires within this call -- see the matching comment in
  // `builder()`'s legacy path.
  dWindow.setFocus(
    (originChunk.cx + radius.x) * cks.x,
    (originChunk.cy + radius.y) * cks.y,
    (originChunk.cz + radius.z) * cks.z,
  );

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

  // Assign to module-level storage. materialMap/shapeMap/visibilityMap have
  // no consumers post-construction (see builderGenerative's matching
  // comment) -- sized to the resident window as inert placeholders, same as
  // a fresh generative construction, rather than reconstructed from
  // packedData.
  cmMaterials = mats;
  cmMaterialMap = new Array3D<number>(windowCellDims, 0);
  cmShapeMap = new Array3D<number>(windowCellDims, 1);
  cmMeshes = dMeshes;
  cmEmissionMap = new Array3D<number>(windowCellDims, 0);
  cmVisibilityMap = new Array3D<boolean>(windowCellDims, true);
  cmCellSize = cs;
  cmChunkSize = cks;
  cmSmoothing = (dataSmoothing as number) ?? 0;
  cmNormalSmoothing = Math.max(
    0,
    Math.min(1, (dataNormalSmoothing as number) ?? 0),
  );
  cmNeedsGPUUpdate = true;
  cmWindow = dWindow;
  cmColdStorage = dColdStorage;
  cmEmissionColorChannel = dEmissionChannel;
  cmSmoothingWeightsChannel = dSmoothingChannel;
  cmExploredChannel = dExploredChannel;
  cmFarMaterialChannel = dFarMaterialChannel;
  cmMemoryMaterialChannel = dMemoryMaterialChannel;
  cmGeneratorKey = dGeneratorKey;
  cmMapSize = new Vector3D(
    dWindow.cellDimensions.x,
    dWindow.cellDimensions.y,
    dWindow.cellDimensions.z,
  );
  cmChunkGridSize = dWindow.gridDimensions;
  cmChunks = initChunks(dWindow.gridDimensions);
  cmRevealExempt = (dataRevealExempt as boolean) ?? false;
  cmAutoFocusFromCamera = true;
  cmAutoResizeFromZoom = true;
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
