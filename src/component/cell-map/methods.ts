import { ComponentMethods } from '../types';
import { Vector3D } from '../../math';
import {
  CellMapT,
  reassembleChunks,
  takePendingBufferCleanup,
  resetCellMapState,
  cmEmissionColorChannel,
  cmExploredChannel,
  enqueuePendingSetCells,
  getPendingSetCells,
  clearPendingSetCells,
  invalidateCachedChunk,
  drainAuxWindowChangeMs,
  drainAuxFieldSyncMs,
} from './data';
import {
  CellData,
  Material,
  Mesh,
  ChunkMesh,
  packCell,
  unpackCell,
} from './types';
import type { RaycastHit, SurfaceHit, RaycastOptions } from './types';
import type { ChunkCoord } from './window';
import { markChunksDirty, markChunkAndNeighborsDirty } from './mesh-builder';
import { deferCellWriteIfUnobserved } from './deferred-presentation';
import {
  raycastCellMap,
  cellSurfacePoint,
  sampleSurfaceHeight,
} from './raycast';
import { cellStoreFlush } from '../camera/render/wasm';
import { bumpRenderableVersion } from '../renderable-version';
import { isProfilingEnabled, recordComponentUpdate } from '../../loop/profile';

/**
 * Records a cell-map window-management call's cost under a synthetic
 * `'cell-map:<phase>'` type so it shows up in the perf-monitor's per-type
 * breakdown -- `camera.render()` runs entirely outside the update-phase
 * traversal that normally populates this, so cell-map's window/mesh/GPU
 * costs are otherwise invisible there. `reassemble()`'s cost (which can fire
 * from underneath any of setFocus/setWindowRadius/advanceWindowGeneration)
 * is drained and recorded separately under `'cell-map:reassemble'`, keeping
 * buckets exclusive rather than double-counted. Only called when profiling
 * is enabled -- see `isProfilingEnabled`.
 */
function recordCellMapPhase(
  component: CellMapT,
  type: string,
  t0: number,
): void {
  const id = component.id ?? -1;
  // Three exclusive slices of what used to be one 'cell-map:reassemble' lump:
  // the store's own evict/assemble/commit, the auxiliary channels' window
  // change, and the public-field resync. They're separated because they have
  // independent causes and independent fixes -- a single number couldn't say
  // which of them a commit-frame spike actually came from.
  const reassembleMs = component.window.drainReassembleMs();
  const auxMs = component.window.drainAuxReassembleMs();
  const auxWindowChangeMs = drainAuxWindowChangeMs();
  const auxFieldSyncMs = drainAuxFieldSyncMs();
  const ownMs = performance.now() - t0 - reassembleMs - auxMs;
  recordComponentUpdate(id, component.name, type, ownMs);
  if (reassembleMs > 0) {
    recordComponentUpdate(
      id,
      component.name,
      'cell-map:reassembleStore',
      reassembleMs,
    );
  }
  if (auxWindowChangeMs > 0) {
    recordComponentUpdate(
      id,
      component.name,
      'cell-map:auxWindowChange',
      auxWindowChangeMs,
    );
  }
  if (auxFieldSyncMs > 0) {
    recordComponentUpdate(
      id,
      component.name,
      'cell-map:auxFieldSync',
      auxFieldSyncMs,
    );
  }
}

/**
 * Rejects a malformed coordinate (NaN, ±Infinity, non-numeric) before it
 * reaches the WASM store or an Array3D. This is a well-formedness check, not
 * a spatial bounds check — plain range comparisons (`x < 0 || x >= mapSize.x`)
 * silently let NaN through, since every comparison against NaN is false. A
 * bad coordinate is a bug regardless of where a shiftable window (once one
 * exists) happens to be, so this throws unconditionally.
 */
function assertFiniteCoordinates(x: number, y: number, z: number): void {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    throw new Error(
      `[cell-map] Invalid coordinates: (${x}, ${y}, ${z}) — must be finite numbers`,
    );
  }
}

/**
 * Resolves a WORLD chunk coordinate to the resident window's local chunk-grid
 * coordinate, or `null` if the window hasn't committed a focus yet
 * (`component.window.origin === null`) or the chunk currently falls outside
 * the resident window -- mirroring `CellWindow.worldToLocal`'s CELL-level
 * local lookup (used by `setEmissionColor`/`getEmissionColor`), but at chunk
 * granularity: there is no chunk-level `worldToLocal` helper on
 * `CellWindow` itself, so it's computed inline here from
 * `component.window.origin` and `component.chunkGridSize` (the window's
 * size in chunks).
 */
function chunkLocalCoords(
  component: CellMapT,
  worldCx: number,
  worldCy: number,
  worldCz: number,
): { x: number; y: number; z: number } | null {
  const origin = component.window.origin;
  if (!origin) return null;
  const lx = worldCx - origin.cx;
  const ly = worldCy - origin.cy;
  const lz = worldCz - origin.cz;
  const dims = component.chunkGridSize;
  if (
    lx < 0 ||
    lx >= dims.x ||
    ly < 0 ||
    ly >= dims.y ||
    lz < 0 ||
    lz >= dims.z
  ) {
    return null;
  }
  return { x: lx, y: ly, z: lz };
}

/**
 * Cap on the retained per-cell emission-color dirty log; on overflow the log
 * is cleared and `emissionColorFullVersion` is bumped, forcing one full
 * `texImage3D` reupload for any straggler camera instead of growing the log
 * unboundedly. Sized generously above typical usage (a hover highlight is
 * 1 cell/frame; a selection/zone-glow batch might touch a few hundred) so a
 * realistic single-frame batch still gets per-cell `texSubImage3D` instead of
 * falling back -- thousands of tiny `texSubImage3D` calls are still far
 * cheaper than one full-window `texImage3D` rebuild for any non-trivial
 * resident window.
 */
const CELL_EMISSION_COLOR_DIRTY_CAP = 2048;

/**
 * Cap on the retained per-chunk fog-of-war "explored" dirty log; on overflow
 * the log is cleared and `exploredFullVersion` is bumped, forcing one full
 * reupload instead of growing the log unboundedly. Mirrors
 * `CELL_EMISSION_COLOR_DIRTY_CAP` -- reuses the same value since explored
 * writes are chunk-granular (far fewer chunks than cells in a window), so
 * this cap is comparatively even more generous in practice.
 */
const CELL_EXPLORED_DIRTY_CAP = 2048;

export interface CellMapMethods extends ComponentMethods {
  type: 'cell-map';

  /**
   * Get all data for a cell at the given coordinates
   */
  getCellData: (component: CellMapT, coordinates: Vector3D) => CellData;

  /**
   * Set all data for a cell at the given coordinates
   */
  setCellData: (
    component: CellMapT,
    coordinates: Vector3D,
    data: CellData,
  ) => void;

  /**
   * Set only the material index for a cell
   */
  setMaterial: (
    component: CellMapT,
    coordinates: Vector3D,
    materialIndex: number,
  ) => void;

  /**
   * Set only the shape index for a cell
   */
  setShape: (
    component: CellMapT,
    coordinates: Vector3D,
    shapeIndex: number,
  ) => void;

  /**
   * Set only the emission intensity for a cell
   */
  setEmission: (
    component: CellMapT,
    coordinates: Vector3D,
    intensity: number,
  ) => void;

  /**
   * Set the per-cell emission (highlight) color. `color` channels are 0-1; (0,0,0)
   * clears the highlight. Independent of `setEmission` (which drives the emissive
   * texture brightness). Updates a GPU texture next frame — no remesh.
   * `coordinates` is a WORLD cell coordinate (matching `setCellData`) — an
   * off-window coordinate is fully supported, persisted via cold storage,
   * and survives a window shift or save/load, the same as primary cell
   * data. (Previously window-local only, with no off-window support at all.)
   */
  setEmissionColor: (
    component: CellMapT,
    coordinates: Vector3D,
    color: Vector3D,
  ) => void;

  /**
   * Get the per-cell emission (highlight) color as a Vector3D (channels
   * 0-1). `coordinates` is a WORLD cell coordinate — see `setEmissionColor`.
   */
  getEmissionColor: (component: CellMapT, coordinates: Vector3D) => Vector3D;

  /**
   * Marks a chunk as explored for fog-of-war purposes (idempotent -- a
   * no-op if the chunk is already explored, so repeated per-frame vision
   * updates don't flood the dirty log). `worldCx`/`worldCy`/`worldCz` are
   * WORLD CHUNK coordinates (not cell coordinates, and not window-local) --
   * an off-window chunk is fully supported, persisted via the explored
   * channel's own cold storage, and survives a window shift or save/load,
   * the same as `setEmissionColor`'s off-window support for cells.
   */
  setChunkExplored: (
    component: CellMapT,
    worldCx: number,
    worldCy: number,
    worldCz: number,
  ) => void;

  /**
   * Whether the given WORLD CHUNK coordinate has ever been explored (see
   * `setChunkExplored`).
   */
  isChunkExplored: (
    component: CellMapT,
    worldCx: number,
    worldCy: number,
    worldCz: number,
  ) => boolean;

  /**
   * Set only the visibility flag for a cell
   */
  setVisible: (
    component: CellMapT,
    coordinates: Vector3D,
    visible: boolean,
  ) => void;

  /**
   * Get a material definition by index
   */
  getMaterial: (component: CellMapT, index: number) => Material | undefined;

  /**
   * Get a mesh by index
   */
  getMesh: (component: CellMapT, index: number) => Mesh | undefined;

  /**
   * Add a new material and return its index
   */
  addMaterial: (component: CellMapT, material: Material) => number;

  /**
   * Add a new mesh and return its index
   */
  addMesh: (component: CellMapT, mesh: Mesh) => number;

  /**
   * Mark GPU data as clean (called after upload to GPU)
   */
  markGPUClean: (component: CellMapT) => void;

  /**
   * World-space position of the center of a cell's TOP face for the given cell
   * coordinates: horizontally centered (x, z) and at the cell's top edge (y). Handy
   * for seating an entity — e.g. a bottom-center-anchored sprite — on top of a cell
   * without computing cellSize offsets by hand. (Coordinates are not bounds-checked.)
   */
  cellToWorldCoordinates: (
    component: CellMapT,
    coordinates: Vector3D,
  ) => Vector3D;

  /**
   * Get world-space bounding box
   */
  getBounds: (component: CellMapT) => { min: Vector3D; max: Vector3D };

  /**
   * Move the resident window to cover the given world position, shifting the
   * hot buffer if needed. On a shift, reassembles the chunk-mesh array so
   * only the newly-exposed slab is marked dirty — chunks whose world
   * coordinate stays resident keep their existing mesh and GPU buffers, and
   * chunks that fall out of the window are queued for GPU buffer cleanup
   * (see `reassembleChunks` in `data.ts`). Called once per frame by the
   * render loop when `autoFocusFromCamera` is enabled; also public for games
   * that want explicit control instead.
   */
  setFocus: (
    component: CellMapT,
    worldX: number,
    worldY: number,
    worldZ: number,
  ) => void;

  /**
   * Grows or shrinks the resident window's padding radius (in chunks per
   * axis), clamped to `component.maxTerrainLoadDimensions`, and re-centers
   * it on the current focus point. Reassembles the chunk-mesh array the same
   * way a `setFocus` shift does (see `reassembleChunks` in `data.ts`) — only
   * genuinely new chunks are marked dirty, the rest keep their existing
   * mesh/GPU buffers. `emissionColorMap`/`smoothingWeights` resync via their
   * own windowed persistence on the same resize (see `auxiliary-channel.ts`)
   * rather than being reallocated-to-baseline. Called once per frame by the
   * render loop when `autoResizeFromZoom` is enabled; also public for games
   * that want explicit control instead. Returns whether a resize happened.
   */
  setWindowRadius: (
    component: CellMapT,
    radius: { x: number; y: number; z: number },
  ) => boolean;

  /**
   * Advances any pending shift/resize's chunk-*data* generation (see
   * `CellWindow.advance`) by one frame's budget, committing it (updating the
   * resident window and reassembling the chunk-mesh array, same as a direct
   * `setFocus`/`setWindowRadius` commit) once every needed chunk's data is
   * ready. A target with genuinely-new chunks doesn't move the resident
   * window until this finishes generating them — spreads that cost across
   * frames instead of paying it synchronously inside a single shift. Call
   * once per frame regardless of `autoFocusFromCamera`/`autoResizeFromZoom`,
   * since a pending target needs driving forward even when neither is being
   * auto-driven that frame.
   */
  /**
   * Drives a pending window shift/resize forward by one frame's budget.
   * Returns whether the shift COMMITTED this call -- the commit frame is by
   * far the most expensive one (store reassembly, five auxiliary channels,
   * full texture invalidation, chunk-array rebuild), so callers can use this
   * to hold other heavy optional work off that frame. See the fog-of-war
   * sweep's use of it in render-cell-maps.ts.
   */
  advanceWindowGeneration: (component: CellMapT) => boolean;

  /**
   * Forces chunks in `[min, max]` (inclusive, WORLD cell coordinates) — or
   * the entire resident window if `min` is null — to re-derive from the
   * configured `ChunkGenerator` instead of continuing to treat their
   * previously-visited answer as permanent. Fixes generative worlds that
   * grow over time: once a chunk is visited, nothing else ever re-asks the
   * generator for it, so newly-generatable content at an already-visited
   * coordinate would otherwise never appear. Resident chunks with a live
   * edit are left untouched (see `skippedEditedChunks`) — edits are tracked
   * per-chunk, not per-cell, so there's no way to know which cells inside an
   * edited chunk are real player changes vs. generator-original; overwriting
   * the whole chunk would silently destroy them.
   *
   * Synchronous, not budgeted — this is an occasional/deliberate operation
   * (call when new content becomes generatable, not every frame), but a
   * refresh over many resident chunks (especially `refreshChunks(null)` on a
   * large window) can cost real time: each refreshed chunk is one generator
   * call plus one WASM write per cell in the chunk.
   */
  refreshChunks: (
    component: CellMapT,
    min: { x: number; y: number; z: number } | null,
    max?: { x: number; y: number; z: number },
  ) => {
    refreshedChunks: number;
    skippedEditedChunks: number;
    clearedChunks: number;
  };

  /**
   * Frame-budgeted bulk write of already-known cell values (as opposed to
   * `refreshChunks`, which re-derives from the generator). Entries from this
   * and any other in-flight `setCells` call are applied a few at a time by
   * `advanceSetCells` (driven every frame by the render loop, same as
   * `advanceWindowGeneration`) instead of all at once, so a large batch
   * can't stall a single frame — the caller doesn't need to hand-roll their
   * own per-frame slicing. `markChunksDirty`-equivalent work is batched once
   * per touched chunk, not once per cell. Returns a Promise that resolves
   * once these entries (specifically) have been applied, or rejects if the
   * component is disposed first.
   */
  setCells: (
    component: CellMapT,
    entries: { x: number; y: number; z: number; data: CellData }[],
    opts?: { budgetMs?: number },
  ) => Promise<void>;

  /**
   * Advances any in-flight `setCells` batch by one frame's budget. Call once
   * per frame unconditionally (no-ops cheaply when nothing is pending) —
   * mirrors `advanceWindowGeneration`'s existing shape exactly.
   */
  advanceSetCells: (component: CellMapT) => void;

  /**
   * Drains and returns chunk meshes that were evicted from the resident
   * window since the last call, whose GPU buffers (`glVertexBuffer`/
   * `glIndexBuffer`) still need `gl.deleteBuffer`ing. This component has no
   * GL context of its own, so the renderer calls this once per frame and
   * does the actual deletion. See `reassembleChunks` in `data.ts`.
   */
  takePendingBufferCleanup: (component: CellMapT) => ChunkMesh[];

  /**
   * Cast a ray against the cell-map's ACTUAL rendered surface (smoothing + custom
   * meshes accounted for) and return the nearest hit, or null on a miss. `dir` need
   * not be normalized; `distance` is in world units.
   */
  raycast: (
    component: CellMapT,
    origin: Vector3D,
    dir: Vector3D,
    opts?: RaycastOptions,
  ) => RaycastHit | null;

  /**
   * World-space point on the real top surface at a cell's top-center — the accurate,
   * smoothing/custom-mesh-aware counterpart to `cellToWorldCoordinates` for seating a
   * bottom-center-anchored sprite. Falls back to the analytic top-face center when the
   * cell has no exposed top surface (air / fully-enclosed).
   */
  getSurfacePoint: (
    component: CellMapT,
    coordinates: Vector3D,
    opts?: RaycastOptions,
  ) => Vector3D;

  /**
   * Topmost real surface (point + normal) at an arbitrary world (x,z) — for smooth
   * cell-to-cell traversal as an entity walks. Returns null if the column is empty.
   */
  sampleSurfaceHeight: (
    component: CellMapT,
    worldX: number,
    worldZ: number,
    opts?: RaycastOptions,
  ) => SurfaceHit | null;

  /**
   * Flush dirty changes to compressed storage
   */
  flush: (component: CellMapT) => void;
}

export const CellMap: CellMapMethods = {
  type: 'cell-map',

  getCellData: (component: CellMapT, coordinates: Vector3D): CellData => {
    const { x, y, z } = coordinates;
    const packed = component.window.queryCell(x, y, z);
    return unpackCell(packed);
  },

  setCellData: (
    component: CellMapT,
    coordinates: Vector3D,
    data: CellData,
  ): void => {
    // Clamp values to valid ranges
    const clamped: CellData = {
      materialIndex: Math.max(0, Math.min(0xfff, data.materialIndex)),
      shapeIndex: Math.max(0, Math.min(0xfff, data.shapeIndex)),
      emissionIntensity: Math.max(0, Math.min(0x1f, data.emissionIntensity)),
      visible: data.visible,
    };

    const packed = packCell(clamped);

    // Fog-of-war deferred presentation: if the player cannot currently see
    // this cell, record what they last saw here BEFORE overwriting it, and
    // skip the dirty mark so the chunk keeps meshing as it was. The write
    // itself still goes through unconditionally -- the store stays
    // authoritative for gameplay, line-of-sight and collision, and only the
    // MESH lags. See deferred-presentation.ts. No-op when fog isn't running.
    const deferred = deferCellWriteIfUnobserved(component, coordinates);

    component.window.setCell(
      coordinates.x,
      coordinates.y,
      coordinates.z,
      packed,
    );
    component.needsGPUUpdate = true;
    // Recording the old value AND withholding the dirty mark is what keeps
    // this exact per cell: a later rebuild of this chunk (triggered by an
    // edit the player CAN see, elsewhere in it) still honours the overlay,
    // so a visible edit never leaks its chunk-mates' hidden ones.
    if (!deferred) {
      markChunksDirty(component, coordinates.x, coordinates.y, coordinates.z);
    }
  },

  setMaterial: (
    component: CellMapT,
    coordinates: Vector3D,
    materialIndex: number,
  ): void => {
    const current = CellMap.getCellData(component, coordinates);
    current.materialIndex = Math.max(0, Math.min(0xfff, materialIndex));
    CellMap.setCellData(component, coordinates, current);
  },

  setShape: (
    component: CellMapT,
    coordinates: Vector3D,
    shapeIndex: number,
  ): void => {
    const current = CellMap.getCellData(component, coordinates);
    current.shapeIndex = Math.max(0, Math.min(0xfff, shapeIndex));
    CellMap.setCellData(component, coordinates, current);
  },

  setEmission: (
    component: CellMapT,
    coordinates: Vector3D,
    intensity: number,
  ): void => {
    const current = CellMap.getCellData(component, coordinates);
    current.emissionIntensity = Math.max(0, Math.min(0x1f, intensity));
    CellMap.setCellData(component, coordinates, current);
  },

  setEmissionColor: (
    component: CellMapT,
    coordinates: Vector3D,
    color: Vector3D,
  ): void => {
    assertFiniteCoordinates(coordinates.x, coordinates.y, coordinates.z);
    const to255 = (c: number): number =>
      Math.max(0, Math.min(255, Math.round(c * 255)));
    const packed =
      (to255(color.x) << 16) | (to255(color.y) << 8) | to255(color.z);
    // Per-cell color is a texture-side channel (not baked into vertices), so
    // this never triggers a remesh -- just flags the GPU texture for
    // re-upload when the write is actually visible (in-window). An
    // off-window write is fully supported -- persisted via the channel's
    // own cold storage and correctly reappears when the window shifts back,
    // the same as a primary-channel edit (see `auxiliary-channel.ts`).
    const local = component.window.worldToLocal(
      coordinates.x,
      coordinates.y,
      coordinates.z,
    );
    cmEmissionColorChannel!.set(
      coordinates.x,
      coordinates.y,
      coordinates.z,
      local,
      packed,
    );
    if (local) {
      // No separate `emissionColorMap.set` here: the map is an `Array3Du32`
      // adopting the channel's own buffer, so the channel write above already
      // stored the value. Writing again through the map would ALSO be wrong --
      // its indexing is plain window-local, while the buffer is toroidally
      // addressed, so it would land on a different cell entirely.
      //
      // Version-tagged per-cell dirty log (mirrors atlas-manager's
      // dirtyRegions) instead of a single whole-map dirty flag -- lets the
      // renderer patch just this texel via texSubImage3D per camera instead
      // of rebuilding + re-uploading the entire resident window on every
      // call. Deliberately no value-diffing against the previous color: a
      // no-op write (same color as before) still bumps the version and logs
      // a region, trading an occasional redundant 1-texel texSubImage3D for
      // keeping this hot path a single unconditional write (a read-before-
      // write compare would itself cost more than the upload it would
      // occasionally save).
      component.emissionColorVersion = component.emissionColorVersion + 1;
      const version = component.emissionColorVersion;
      // Logged as a SLOT, not a window-local coordinate: the delta uploader
      // reads the buffer and writes the texel at the same coordinate, and both
      // are toroidally addressed.
      const s = cmEmissionColorChannel!.slotCoords(local);
      component.emissionColorDirtyRegions.push({
        version,
        x: s.x,
        y: s.y,
        z: s.z,
      });
      if (
        component.emissionColorDirtyRegions.length >
        CELL_EMISSION_COLOR_DIRTY_CAP
      ) {
        component.emissionColorDirtyRegions = [];
        component.emissionColorFullVersion = version;
      }
    }
  },

  getEmissionColor: (component: CellMapT, coordinates: Vector3D): Vector3D => {
    assertFiniteCoordinates(coordinates.x, coordinates.y, coordinates.z);
    const local = component.window.worldToLocal(
      coordinates.x,
      coordinates.y,
      coordinates.z,
    );
    const packed =
      cmEmissionColorChannel!.get(
        coordinates.x,
        coordinates.y,
        coordinates.z,
        local,
      ) | 0;
    return new Vector3D(
      ((packed >> 16) & 0xff) / 255,
      ((packed >> 8) & 0xff) / 255,
      (packed & 0xff) / 255,
    );
  },

  setChunkExplored: (
    component: CellMapT,
    worldCx: number,
    worldCy: number,
    worldCz: number,
  ): void => {
    assertFiniteCoordinates(worldCx, worldCy, worldCz);
    const local = chunkLocalCoords(component, worldCx, worldCy, worldCz);
    // Idempotent no-op once already explored -- avoids flooding the dirty
    // log on repeated per-frame vision updates over already-explored ground.
    if (cmExploredChannel!.get(worldCx, worldCy, worldCz, local) === 1) {
      return;
    }
    cmExploredChannel!.set(worldCx, worldCy, worldCz, local, 1);
    if (local) {
      component.exploredMap.set(new Vector3D(local.x, local.y, local.z), 1);
      component.exploredVersion = component.exploredVersion + 1;
      const version = component.exploredVersion;
      component.exploredDirtyRegions.push({
        version,
        x: local.x,
        y: local.y,
        z: local.z,
      });
      if (component.exploredDirtyRegions.length > CELL_EXPLORED_DIRTY_CAP) {
        component.exploredDirtyRegions = [];
        component.exploredFullVersion = version;
      }
    }
  },

  isChunkExplored: (
    component: CellMapT,
    worldCx: number,
    worldCy: number,
    worldCz: number,
  ): boolean => {
    assertFiniteCoordinates(worldCx, worldCy, worldCz);
    const local = chunkLocalCoords(component, worldCx, worldCy, worldCz);
    return cmExploredChannel!.get(worldCx, worldCy, worldCz, local) === 1;
  },

  setVisible: (
    component: CellMapT,
    coordinates: Vector3D,
    visible: boolean,
  ): void => {
    const current = CellMap.getCellData(component, coordinates);
    current.visible = visible;
    CellMap.setCellData(component, coordinates, current);
  },

  getMaterial: (component: CellMapT, index: number): Material | undefined => {
    return component.materials[index];
  },

  getMesh: (component: CellMapT, index: number): Mesh | undefined => {
    return component.meshes[index];
  },

  addMaterial: (component: CellMapT, material: Material): number => {
    component.materials.push(material);
    const index = component.materials.length - 1;

    if (index > 0xfff) {
      console.warn(
        `Material index ${index} exceeds maximum (4095). Consider using fewer materials.`,
      );
    }

    return index;
  },

  addMesh: (component: CellMapT, mesh: Mesh): number => {
    component.meshes.push(mesh);
    const index = component.meshes.length - 1;
    // Only this one new index needs to reach WASM -- meshes is append-only
    // via this method, so nothing else has gone stale. If a full resync is
    // already pending (e.g. a wholesale `meshes` reassignment), the
    // consumer ignores this list entirely, so pushing unconditionally is
    // harmless either way.
    component.customShapesPendingIndices.push(index);

    if (index > 0xfff) {
      console.warn(
        `Mesh index ${index} exceeds maximum (4095). Consider using fewer meshes.`,
      );
    }

    return index;
  },

  markGPUClean: (component: CellMapT): void => {
    component.needsGPUUpdate = false;
  },

  takePendingBufferCleanup: (): ChunkMesh[] => {
    return takePendingBufferCleanup();
  },

  cellToWorldCoordinates: (
    component: CellMapT,
    coordinates: Vector3D,
  ): Vector3D => {
    const { cellSize } = component;
    return new Vector3D(
      (coordinates.x + 0.5) * cellSize.x, // horizontal center
      (coordinates.y + 1) * cellSize.y, // top face of the cell
      (coordinates.z + 0.5) * cellSize.z, // depth center
    );
  },

  getBounds: (component: CellMapT): { min: Vector3D; max: Vector3D } => {
    const origin = component.window.origin;
    const ox = (origin?.cx ?? 0) * component.chunkSize.x * component.cellSize.x;
    const oy = (origin?.cy ?? 0) * component.chunkSize.y * component.cellSize.y;
    const oz = (origin?.cz ?? 0) * component.chunkSize.z * component.cellSize.z;
    const min = new Vector3D(ox, oy, oz);
    const max = new Vector3D(
      ox + component.mapSize.x * component.cellSize.x,
      oy + component.mapSize.y * component.cellSize.y,
      oz + component.mapSize.z * component.cellSize.z,
    );
    return { min, max };
  },

  setFocus: (
    component: CellMapT,
    worldX: number,
    worldY: number,
    worldZ: number,
  ): void => {
    const profiling = isProfilingEnabled();
    const t0 = profiling ? performance.now() : 0;
    const oldOrigin = component.window.origin;
    const oldChunks = component.chunks;
    const shifted = component.window.setFocus(
      Math.floor(worldX / component.cellSize.x),
      Math.floor(worldY / component.cellSize.y),
      Math.floor(worldZ / component.cellSize.z),
    );
    if (shifted) {
      // Non-null immediately after a shift -- setFocus just set it.
      component.chunks = reassembleChunks(
        oldChunks,
        oldOrigin,
        component.window.origin!,
        component.window.gridDimensions,
      );
    }
    if (profiling) recordCellMapPhase(component, 'cell-map:setFocus', t0);
  },

  setWindowRadius: (
    component: CellMapT,
    radius: { x: number; y: number; z: number },
  ): boolean => {
    const profiling = isProfilingEnabled();
    const t0 = profiling ? performance.now() : 0;
    try {
      // maxTerrainLoadDimensions is a world-space radius, not chunks -- convert
      // to a chunk-radius cap the same way renderDistance/frustumPadding are
      // converted elsewhere (floor-divide by chunkSize*cellSize per axis).
      const maxWorld = component.maxTerrainLoadDimensions;
      const maxChunks = {
        x: Math.max(
          0,
          Math.floor(
            maxWorld.x / (component.chunkSize.x * component.cellSize.x),
          ),
        ),
        y: Math.max(
          0,
          Math.floor(
            maxWorld.y / (component.chunkSize.y * component.cellSize.y),
          ),
        ),
        z: Math.max(
          0,
          Math.floor(
            maxWorld.z / (component.chunkSize.z * component.cellSize.z),
          ),
        ),
      };
      const clamped = {
        x: Math.min(radius.x, maxChunks.x),
        y: Math.min(radius.y, maxChunks.y),
        z: Math.min(radius.z, maxChunks.z),
      };
      const oldOrigin = component.window.origin;
      const oldChunks = component.chunks;
      const resized = component.window.resize(clamped);
      if (!resized) return false;

      component.mapSize = new Vector3D(
        component.window.cellDimensions.x,
        component.window.cellDimensions.y,
        component.window.cellDimensions.z,
      );
      component.chunkGridSize = component.window.gridDimensions;
      // Non-null immediately after a resize -- window.resize just set it.
      component.chunks = reassembleChunks(
        oldChunks,
        oldOrigin,
        component.window.origin!,
        component.window.gridDimensions,
      );

      return true;
    } finally {
      if (profiling)
        recordCellMapPhase(component, 'cell-map:setWindowRadius', t0);
    }
  },

  advanceWindowGeneration: (component: CellMapT): boolean => {
    const profiling = isProfilingEnabled();
    const t0 = profiling ? performance.now() : 0;
    try {
      const oldOrigin = component.window.origin;
      const oldChunks = component.chunks;
      const oldGridDims = component.window.gridDimensions;
      const committed = component.window.advance();
      if (!committed) return false;

      // A committed target's dims may or may not have changed depending on
      // whether it originated from setFocus (dims unchanged) or
      // setWindowRadius (dims changed) -- window.advance() doesn't distinguish,
      // so derive it here instead of threading that through the window API.
      const dimsChanged =
        component.window.gridDimensions.x !== oldGridDims.x ||
        component.window.gridDimensions.y !== oldGridDims.y ||
        component.window.gridDimensions.z !== oldGridDims.z;

      if (dimsChanged) {
        component.mapSize = new Vector3D(
          component.window.cellDimensions.x,
          component.window.cellDimensions.y,
          component.window.cellDimensions.z,
        );
        component.chunkGridSize = component.window.gridDimensions;
      }

      component.chunks = reassembleChunks(
        oldChunks,
        oldOrigin,
        component.window.origin!,
        component.window.gridDimensions,
      );
      return true;
    } finally {
      if (profiling)
        recordCellMapPhase(component, 'cell-map:advanceWindowGeneration', t0);
    }
  },

  refreshChunks: (
    component: CellMapT,
    min: { x: number; y: number; z: number } | null,
    max?: { x: number; y: number; z: number },
  ): {
    refreshedChunks: number;
    skippedEditedChunks: number;
    clearedChunks: number;
  } => {
    const profiling = isProfilingEnabled();
    const t0 = profiling ? performance.now() : 0;
    try {
      let minChunk: ChunkCoord | null = null;
      let maxChunk: ChunkCoord | null = null;
      if (min) {
        assertFiniteCoordinates(min.x, min.y, min.z);
        if (!max) {
          throw new Error(
            '[cell-map] refreshChunks: max is required when min is provided',
          );
        }
        assertFiniteCoordinates(max.x, max.y, max.z);
        const { x: csx, y: csy, z: csz } = component.chunkSize;
        minChunk = {
          cx: Math.floor(min.x / csx),
          cy: Math.floor(min.y / csy),
          cz: Math.floor(min.z / csz),
        };
        maxChunk = {
          cx: Math.floor(max.x / csx),
          cy: Math.floor(max.y / csy),
          cz: Math.floor(max.z / csz),
        };
      }

      const { refreshed, skippedEdited, clearedEvicted } =
        component.window.refreshChunkRange(minChunk, maxChunk);

      for (const wc of refreshed) markChunkAndNeighborsDirty(component, wc);
      for (const wc of clearedEvicted)
        invalidateCachedChunk(wc.cx, wc.cy, wc.cz);
      if (refreshed.length > 0) component.needsGPUUpdate = true;

      return {
        refreshedChunks: refreshed.length,
        skippedEditedChunks: skippedEdited.length,
        clearedChunks: clearedEvicted.length,
      };
    } finally {
      if (profiling)
        recordCellMapPhase(component, 'cell-map:refreshChunks', t0);
    }
  },

  setCells: (
    component: CellMapT,
    entries: { x: number; y: number; z: number; data: CellData }[],
    opts?: { budgetMs?: number },
  ): Promise<void> => {
    for (const entry of entries) {
      assertFiniteCoordinates(entry.x, entry.y, entry.z);
    }
    return enqueuePendingSetCells(entries, opts?.budgetMs);
  },

  advanceSetCells: (component: CellMapT): void => {
    const profiling = isProfilingEnabled();
    const t0 = profiling ? performance.now() : 0;
    try {
      const pending = getPendingSetCells();
      if (!pending) return;

      const deadline = performance.now() + pending.budgetMs;
      const touchedChunks = new Map<string, ChunkCoord>();
      const batch: {
        worldX: number;
        worldY: number;
        worldZ: number;
        value: number;
      }[] = [];
      let processed = 0;
      while (pending.cursor < pending.entries.length) {
        if (processed > 0 && performance.now() > deadline) break;
        const entry = pending.entries[pending.cursor];
        const clamped: CellData = {
          materialIndex: Math.max(0, Math.min(0xfff, entry.data.materialIndex)),
          shapeIndex: Math.max(0, Math.min(0xfff, entry.data.shapeIndex)),
          emissionIntensity: Math.max(
            0,
            Math.min(0x1f, entry.data.emissionIntensity),
          ),
          visible: entry.data.visible,
        };
        batch.push({
          worldX: entry.x,
          worldY: entry.y,
          worldZ: entry.z,
          value: packCell(clamped),
        });
        const { x: csx, y: csy, z: csz } = component.chunkSize;
        const cx = Math.floor(entry.x / csx);
        const cy = Math.floor(entry.y / csy);
        const cz = Math.floor(entry.z / csz);
        touchedChunks.set(`${cx},${cy},${cz}`, { cx, cy, cz });
        pending.cursor++;
        processed++;
      }

      // Applies this frame's whole budget-bounded slice in one call --
      // off-window entries are resolved/compared/stored once per chunk they
      // land in, not once per entry (see CellWindow.setCellsBatch).
      if (batch.length > 0) component.window.setCellsBatch(batch);

      if (processed > 0) component.needsGPUUpdate = true;
      for (const wc of touchedChunks.values()) {
        markChunkAndNeighborsDirty(component, wc);
      }

      while (
        pending.waiters.length &&
        pending.waiters[0].targetCursor <= pending.cursor
      ) {
        pending.waiters.shift()!.resolve();
      }
      if (
        pending.cursor >= pending.entries.length &&
        pending.waiters.length === 0
      ) {
        clearPendingSetCells();
      }
    } finally {
      if (profiling)
        recordCellMapPhase(component, 'cell-map:advanceSetCells', t0);
    }
  },

  raycast: (
    component: CellMapT,
    origin: Vector3D,
    dir: Vector3D,
    opts?: RaycastOptions,
  ): RaycastHit | null => raycastCellMap(component, origin, dir, opts),

  getSurfacePoint: (
    component: CellMapT,
    coordinates: Vector3D,
    opts?: RaycastOptions,
  ): Vector3D => cellSurfacePoint(component, coordinates, opts),

  sampleSurfaceHeight: (
    component: CellMapT,
    worldX: number,
    worldZ: number,
    opts?: RaycastOptions,
  ): SurfaceHit | null => sampleSurfaceHeight(component, worldX, worldZ, opts),

  flush: (component: CellMapT): void => {
    cellStoreFlush();
    component.needsGPUUpdate = true;
  },

  dispose: (c) => {
    const cm = c as unknown as CellMapT;
    for (const chunk of cm.chunks) {
      chunk.glVertexBuffer = null;
      chunk.glIndexBuffer = null;
      chunk.vertices = null;
      chunk.indices = null;
    }
    resetCellMapState();
    cm._disposed = true;
    bumpRenderableVersion('cell-map');
  },
};
