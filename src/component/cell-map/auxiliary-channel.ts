/**
 * A secondary per-cell data channel (emission-color highlights, smoothing
 * weights) that stays in sync with a `CellWindow`'s resident window, without
 * sharing any of `CellWindow`'s multi-frame shift-staging machinery.
 *
 * Unlike primary cell data, these channels have no procedural-generation
 * cost — a newly-exposed chunk's baseline is a flat constant, not a
 * generator call — so the whole reason `CellWindow.pendingShift`/`advance()`
 * exists (spreading expensive generation across frames to avoid an FPS
 * hitch) doesn't apply here. Instead, an `AuxiliaryChannel` reacts
 * synchronously to `CellWindow`'s `onReassemble` hook (see `window.ts`),
 * which fires once at the single point the window's committed position
 * actually changes — whether that shift committed immediately or via a
 * staged `pendingShift` — running its own evict/assemble pass that mirrors
 * `CellWindow.reassemble`'s own logic, just on a plain JS buffer instead of
 * the WASM store.
 */
import { ChunkColdStorage } from './cold-storage';
import type { ColdStorageEntrySnapshot } from './cold-storage';
import type { ChunkCoord } from './window';

/** Stable string key for a world-chunk coordinate (matches `CellWindow`'s own `chunkKey`). */
function chunkKey(cx: number, cy: number, cz: number): string {
  return `${cx},${cy},${cz}`;
}

/**
 * Extracts one chunk's cells (at chunk-grid position cx,cy,cz) from a dense
 * flat array of the given cell dims, into a caller-owned buffer, in chunk-local
 * (0..chunkSize) order. Mirrors `CellWindow`'s private `extractChunk`, except
 * that the destination is supplied rather than allocated: the eviction pass
 * runs this for a whole boundary slab per channel per commit, so allocating a
 * result each time meant thousands of short-lived typed arrays on the frame
 * least able to afford the garbage.
 *
 * `out` must be at least `chunkSize.x*y*z` long; only that prefix is written.
 */
function extractChunkInto(
  out: Uint32Array,
  flat: Uint32Array,
  cx: number,
  cy: number,
  cz: number,
  dims: { x: number; y: number },
  chunkSize: { x: number; y: number; z: number },
): void {
  const { x: csx, y: csy, z: csz } = chunkSize;
  const { x: dimX, y: dimY } = dims;
  const baseX = cx * csx;
  const baseY = cy * csy;
  const baseZ = cz * csz;
  let idx = 0;
  for (let z = 0; z < csz; z++) {
    for (let y = 0; y < csy; y++) {
      const rowStart = (baseZ + z) * dimY * dimX + (baseY + y) * dimX + baseX;
      out.set(flat.subarray(rowStart, rowStart + csx), idx);
      idx += csx;
    }
  }
}

/**
 * Shared scratch for the eviction pass's chunk extraction. Module-scope rather
 * than per-channel: `onWindowChange` runs the channels one after another and
 * never holds the buffer across calls, so one is enough for all of them.
 */
let evictionScratchBuffer: Uint32Array | null = null;

function evictionScratch(length: number): Uint32Array {
  if (
    evictionScratchBuffer === null ||
    evictionScratchBuffer.length !== length
  ) {
    evictionScratchBuffer = new Uint32Array(length);
  }
  return evictionScratchBuffer;
}

/** Writes one chunk's cells into a dense flat array of the given cell dims
 *  at chunk-grid position cx,cy,cz. Mirrors `CellWindow`'s private `writeChunk`. */
function writeChunk(
  flat: Uint32Array,
  cx: number,
  cy: number,
  cz: number,
  cells: Uint32Array,
  dims: { x: number; y: number },
  chunkSize: { x: number; y: number; z: number },
): void {
  const { x: csx, y: csy, z: csz } = chunkSize;
  const { x: dimX, y: dimY } = dims;
  const baseX = cx * csx;
  const baseY = cy * csy;
  const baseZ = cz * csz;
  let idx = 0;
  for (let z = 0; z < csz; z++) {
    for (let y = 0; y < csy; y++) {
      const rowStart = (baseZ + z) * dimY * dimX + (baseY + y) * dimX + baseX;
      flat.set(cells.subarray(idx, idx + csx), rowStart);
      idx += csx;
    }
  }
}

function matchesBaselineFlat(
  cells: Uint32Array,
  baselineValue: number,
): boolean {
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] !== baselineValue) return false;
  }
  return true;
}

export interface AuxiliaryChannelConfig {
  chunkSize: { x: number; y: number; z: number };
  /** Value a cell has when nothing's ever diverged from it (e.g. 0 for emission color). */
  baselineValue: number;
  /**
   * Whether this channel can ever hold non-baseline content. `false` (the
   * common case for a uniform `smoothingWeights` number, which has no live
   * per-cell setter and so can never diverge post-construction) skips
   * eviction's extract+compare pass entirely, forever — there's nothing to
   * track. `true` enables the same "skip eviction for chunks provably still
   * at baseline" optimization the primary channel's `editedSinceBaseline`
   * provides.
   */
  trackDivergence: boolean;
  /**
   * The window's initial size in cells. The resident buffer is baseline-
   * filled at this size immediately, synchronously, in the constructor --
   * not left empty until the first `onWindowChange` -- because a window
   * whose initial construction needs staged generation (any chunk not
   * already resolvable from cold storage) doesn't commit its first
   * `reassemble()` synchronously; it can take several frames of
   * `advanceWindowGeneration` to drain. `value` must be usable (correctly
   * sized, baseline-filled) the whole time, or the very first render pass
   * crashes reading it before any reassemble has ever fired.
   */
  initialCellDims: { x: number; y: number; z: number };
}

export class AuxiliaryChannel {
  readonly coldStorage: ChunkColdStorage;
  private readonly chunkSize: { x: number; y: number; z: number };
  private readonly baselineValue: number;
  /** null when this channel can never diverge from baseline (see `trackDivergence`). */
  private readonly touchedSinceBaseline: Set<string> | null;
  /**
   * Whether an in-window `set` has ever landed on a channel that is NOT
   * tracking divergence. Such a write leaves no record in
   * `touchedSinceBaseline` (there is no set) and none in cold storage (it went
   * straight into `resident`), so without this flag `isEntirelyBaseline` would
   * claim the channel is still uniformly baseline and callers acting on that
   * would discard the write. Configuring `trackDivergence: false` is a promise
   * that no such setter exists, but this makes the predicate honest rather
   * than dependent on every caller keeping that promise.
   */
  private everWrittenUntracked = false;
  private resident: Uint32Array = new Uint32Array(0);
  /**
   * The previous window's buffer, kept for reuse as the next shift's
   * destination instead of allocating a fresh window-sized array each time.
   * The two swap roles on every commit. Null until the first shift has one to
   * hand back; discarded when a resize changes the required length.
   *
   * Recycled content is stale, so `onWindowChange` must write every cell of
   * its destination -- it does not get `new Uint32Array`'s zero-fill.
   */
  private spare: Uint32Array | null = null;
  private currentOrigin: ChunkCoord | null = null;
  private currentGridDims: { x: number; y: number; z: number } = {
    x: 0,
    y: 0,
    z: 0,
  };
  private currentCellDims: { x: number; y: number; z: number } = {
    x: 0,
    y: 0,
    z: 0,
  };

  constructor(config: AuxiliaryChannelConfig) {
    this.chunkSize = config.chunkSize;
    this.baselineValue = config.baselineValue;
    this.touchedSinceBaseline = config.trackDivergence ? new Set() : null;
    this.coldStorage = new ChunkColdStorage({
      chunkCellCount:
        config.chunkSize.x * config.chunkSize.y * config.chunkSize.z,
    });
    this.currentCellDims = config.initialCellDims;
    const count =
      config.initialCellDims.x *
      config.initialCellDims.y *
      config.initialCellDims.z;
    this.resident = new Uint32Array(count).fill(config.baselineValue);
  }

  /** The current window's resident content, one value per cell (x-fastest/y/z-slowest). */
  get value(): Uint32Array {
    return this.resident;
  }

  /** Whether this channel can ever hold non-baseline content (see `AuxiliaryChannelConfig`). */
  get canDiverge(): boolean {
    return this.touchedSinceBaseline !== null;
  }

  /**
   * Whether this channel is provably still uniformly `baselineValue`
   * everywhere -- resident and cold-stored alike. Conservative in both
   * directions that matter: any `set` marks the channel diverged even when it
   * wrote the baseline value itself, and an untracked channel falls back to
   * `everWrittenUntracked`, so this never returns true for a channel that
   * holds real content.
   */
  get isEntirelyBaseline(): boolean {
    if (this.coldStorage.size > 0) return false;
    if (this.touchedSinceBaseline) return this.touchedSinceBaseline.size === 0;
    return !this.everWrittenUntracked;
  }

  /**
   * World-chunk coordinates that may hold non-baseline content, or `null` when
   * this channel doesn't track divergence (`trackDivergence: false`) and so
   * cannot answer.
   *
   * A conservative SUPERSET, never a subset: `set` records a chunk even when it
   * writes the baseline value itself, so a chunk can appear here after its
   * content has been cleared. Callers may therefore process a chunk that turns
   * out to be entirely baseline, but will never miss one that isn't -- which is
   * the direction that matters for anything using this to decide what to
   * redraw.
   */
  touchedChunks(): ChunkCoord[] | null {
    if (!this.touchedSinceBaseline) return null;
    const out: ChunkCoord[] = [];
    for (const key of this.touchedSinceBaseline) {
      const [cx, cy, cz] = key.split(',');
      out.push({ cx: Number(cx), cy: Number(cy), cz: Number(cz) });
    }
    return out;
  }

  /** The current window's size in cells (matches the primary `CellWindow`'s `cellDimensions`). */
  get cellDims(): { x: number; y: number; z: number } {
    return this.currentCellDims;
  }

  /** The current window's size in chunks (matches the primary `CellWindow`'s `gridDimensions`). */
  get gridDims(): { x: number; y: number; z: number } {
    return this.currentGridDims;
  }

  /** The current window's world-chunk origin, or null before the first `onWindowChange`. */
  get origin(): ChunkCoord | null {
    return this.currentOrigin;
  }

  /**
   * Reads a world cell coordinate. `local` is the caller's own
   * `CellWindow.worldToLocal(worldX, worldY, worldZ)` result — passed in
   * rather than recomputed here so the in-window decision always matches
   * the primary window's exactly, with no risk of the two drifting.
   */
  get(
    worldX: number,
    worldY: number,
    worldZ: number,
    local: { x: number; y: number; z: number } | null,
  ): number {
    if (local) {
      const { x: dimX, y: dimY } = this.currentCellDims;
      return this.resident[local.z * dimY * dimX + local.y * dimX + local.x];
    }
    const { x: csx, y: csy, z: csz } = this.chunkSize;
    const worldChunk: ChunkCoord = {
      cx: Math.floor(worldX / csx),
      cy: Math.floor(worldY / csy),
      cz: Math.floor(worldZ / csz),
    };
    const stored = this.coldStorage.get(
      worldChunk.cx,
      worldChunk.cy,
      worldChunk.cz,
    );
    if (stored) {
      const localX = worldX - worldChunk.cx * csx;
      const localY = worldY - worldChunk.cy * csy;
      const localZ = worldZ - worldChunk.cz * csz;
      return stored[localZ * csy * csx + localY * csx + localX];
    }
    return this.baselineValue;
  }

  /** Writes a world cell coordinate. `local` — see `get`'s doc comment. */
  set(
    worldX: number,
    worldY: number,
    worldZ: number,
    local: { x: number; y: number; z: number } | null,
    value: number,
  ): void {
    if (local) {
      const { x: dimX, y: dimY } = this.currentCellDims;
      this.resident[local.z * dimY * dimX + local.y * dimX + local.x] = value;
      if (!this.touchedSinceBaseline) this.everWrittenUntracked = true;
      if (this.touchedSinceBaseline) {
        const { x: csx, y: csy, z: csz } = this.chunkSize;
        const worldChunk: ChunkCoord = {
          cx: Math.floor(worldX / csx),
          cy: Math.floor(worldY / csy),
          cz: Math.floor(worldZ / csz),
        };
        this.touchedSinceBaseline.add(
          chunkKey(worldChunk.cx, worldChunk.cy, worldChunk.cz),
        );
      }
      return;
    }
    const { x: csx, y: csy, z: csz } = this.chunkSize;
    const worldChunk: ChunkCoord = {
      cx: Math.floor(worldX / csx),
      cy: Math.floor(worldY / csy),
      cz: Math.floor(worldZ / csz),
    };
    const cells =
      this.coldStorage.get(worldChunk.cx, worldChunk.cy, worldChunk.cz) ??
      new Uint32Array(csx * csy * csz).fill(this.baselineValue);
    const localX = worldX - worldChunk.cx * csx;
    const localY = worldY - worldChunk.cy * csy;
    const localZ = worldZ - worldChunk.cz * csz;
    cells[localZ * csy * csx + localY * csx + localX] = value;
    if (matchesBaselineFlat(cells, this.baselineValue)) {
      this.coldStorage.delete(worldChunk.cx, worldChunk.cy, worldChunk.cz);
    } else {
      this.coldStorage.set(worldChunk.cx, worldChunk.cy, worldChunk.cz, cells);
    }
  }

  /**
   * The synchronous evict/assemble cycle, called from `CellWindow`'s
   * `onReassemble` hook. Mirrors `CellWindow.reassemble`'s own eviction and
   * assembly loops (see `window.ts`), operating on `this.resident` instead
   * of the WASM store.
   */
  onWindowChange(
    old: {
      origin: ChunkCoord | null;
      gridDims: { x: number; y: number; z: number };
      cellDims: { x: number; y: number; z: number };
    },
    next: {
      origin: ChunkCoord;
      gridDims: { x: number; y: number; z: number };
      cellDims: { x: number; y: number; z: number };
    },
  ): void {
    const newTotal = next.cellDims.x * next.cellDims.y * next.cellDims.z;

    // Fast path: a channel with nothing in cold storage and nothing touched
    // since baseline is uniformly `baselineValue` everywhere, so the window's
    // new contents are that same constant no matter how it moved -- there is
    // nothing to evict and nothing to carry across. Skips the assembly loop
    // below, which otherwise allocates a fresh `Uint32Array` per chunk (via
    // `extractChunk`) for every chunk in the window on every shift. This is
    // the normal state of the smoothing channel (no live per-cell setter at
    // all) and of the emission channel until something is actually
    // highlighted. `isEntirelyBaseline` is conservative -- `set` records a
    // touch even when writing the baseline value itself -- so it can't
    // wrongly claim a diverged channel is clean.
    if (this.isEntirelyBaseline) {
      if (this.resident.length !== newTotal) {
        this.resident = new Uint32Array(newTotal).fill(this.baselineValue);
      } else {
        this.resident.fill(this.baselineValue);
      }
      this.currentOrigin = next.origin;
      this.currentGridDims = next.gridDims;
      this.currentCellDims = next.cellDims;
      return;
    }

    // Reuse the spare buffer from the previous shift rather than allocating a
    // new window-sized array every time. A shift touches three cell-granular
    // channels, so allocating here meant several multi-MB arrays per commit
    // plus the GC that eventually follows them -- on the single frame that can
    // least afford either. The two buffers simply trade places each shift.
    let newResident = this.spare;
    if (newResident === null || newResident.length !== newTotal) {
      newResident = new Uint32Array(newTotal);
    }

    const { x: csx, y: csy, z: csz } = this.chunkSize;

    // The overlap in WORLD chunk coordinates, half-open. Computed once and used
    // by both chunk loops below and by the cell-space memcpy further down --
    // `cellDims === gridDims * chunkSize` holds on every construction and
    // resize path, so the chunk-space and cell-space overlaps describe the same
    // region and the cell bounds are just these scaled by chunkSize.
    const ovMinCx = old.origin
      ? Math.max(old.origin.cx, next.origin.cx)
      : next.origin.cx;
    const ovMaxCx = old.origin
      ? Math.min(
          old.origin.cx + old.gridDims.x,
          next.origin.cx + next.gridDims.x,
        )
      : next.origin.cx;
    const ovMinCy = old.origin
      ? Math.max(old.origin.cy, next.origin.cy)
      : next.origin.cy;
    const ovMaxCy = old.origin
      ? Math.min(
          old.origin.cy + old.gridDims.y,
          next.origin.cy + next.gridDims.y,
        )
      : next.origin.cy;
    const ovMinCz = old.origin
      ? Math.max(old.origin.cz, next.origin.cz)
      : next.origin.cz;
    const ovMaxCz = old.origin
      ? Math.min(
          old.origin.cz + old.gridDims.z,
          next.origin.cz + next.gridDims.z,
        )
      : next.origin.cz;
    const hasOverlap =
      ovMinCx < ovMaxCx && ovMinCy < ovMaxCy && ovMinCz < ovMaxCz;

    /** Whether a world chunk coordinate lies in the region both windows share. */
    const inOverlap = (wcx: number, wcy: number, wcz: number): boolean =>
      hasOverlap &&
      wcx >= ovMinCx &&
      wcx < ovMaxCx &&
      wcy >= ovMinCy &&
      wcy < ovMaxCy &&
      wcz >= ovMinCz &&
      wcz < ovMaxCz;

    if (old.origin && this.touchedSinceBaseline) {
      const scratch = evictionScratch(csx * csy * csz);
      for (let cz = 0; cz < old.gridDims.z; cz++) {
        const wcz = old.origin.cz + cz;
        for (let cy = 0; cy < old.gridDims.y; cy++) {
          const wcy = old.origin.cy + cy;
          for (let cx = 0; cx < old.gridDims.x; cx++) {
            const wcx = old.origin.cx + cx;
            // Chunks still resident after the shift are carried by the memcpy;
            // only the boundary slab is evicted. Tested with plain number
            // comparisons against the precomputed overlap rather than building
            // a ChunkCoord per iteration -- this loop runs over the whole old
            // window, for every channel, on every commit.
            if (inOverlap(wcx, wcy, wcz)) continue;
            const key = chunkKey(wcx, wcy, wcz);
            if (!this.touchedSinceBaseline.has(key)) continue;
            // Extracted into a reused buffer: `coldStorage.set` encodes or
            // copies out of it and never retains it, so one scratch serves
            // every chunk in the slab instead of an allocation each.
            extractChunkInto(
              scratch,
              this.resident,
              cx,
              cy,
              cz,
              old.cellDims,
              this.chunkSize,
            );
            if (matchesBaselineFlat(scratch, this.baselineValue)) {
              this.touchedSinceBaseline.delete(key);
            } else {
              this.coldStorage.set(wcx, wcy, wcz, scratch);
            }
          }
        }
      }
    }

    // Carry the overlapping region across as a straight row-by-row memcpy, and
    // baseline-fill only what that copy does NOT cover.
    //
    // A shift is a pure translation, so the region resident in BOTH windows is
    // one contiguous box in each -- the same cells, at a fixed offset. The old
    // code moved it one chunk at a time through `extractChunk` + `writeChunk`,
    // which allocated a scratch buffer per chunk and copied every cell twice.
    //
    // `newResident` may be a recycled buffer holding the PREVIOUS window's
    // contents, so every cell must be written exactly once here: the overlap
    // rows by the copy, everything else by the fill. Filling the whole buffer
    // first would be simpler but writes the bulk of the window twice, which on
    // a large window is the same order of cost as the copy itself.
    //
    // Chunk grids map cleanly onto cell grids here because every construction
    // and resize path keeps `cellDims === gridDims * chunkSize` (the
    // chunk-granular channels satisfy it trivially with `chunkSize` 1), so the
    // chunk-space overlap and the cell-space overlap describe the same region.
    const newDimX = next.cellDims.x;
    const newDimY = next.cellDims.y;
    const newDimZ = next.cellDims.z;
    const newOx = next.origin.cx * csx;
    const newOy = next.origin.cy * csy;
    const newOz = next.origin.cz * csz;

    // Overlap in NEW-window local CELL coordinates, half-open -- the chunk
    // overlap above scaled by chunkSize. An empty range (lo >= hi) means "no
    // overlap", so every row gets filled instead of copied.
    const oldOx = old.origin ? old.origin.cx * csx : 0;
    const oldOy = old.origin ? old.origin.cy * csy : 0;
    const oldOz = old.origin ? old.origin.cz * csz : 0;
    const loX = hasOverlap ? ovMinCx * csx - newOx : 0;
    const hiX = hasOverlap ? ovMaxCx * csx - newOx : 0;
    const loY = hasOverlap ? ovMinCy * csy - newOy : 0;
    const hiY = hasOverlap ? ovMaxCy * csy - newOy : 0;
    const loZ = hasOverlap ? ovMinCz * csz - newOz : 0;
    const hiZ = hasOverlap ? ovMaxCz * csz - newOz : 0;

    const oldDimX = old.cellDims.x;
    const oldDimY = old.cellDims.y;
    const runLength = hiX - loX;
    for (let lz = 0; lz < newDimZ; lz++) {
      const rowZ = lz * newDimY * newDimX;
      const zInside = lz >= loZ && lz < hiZ;
      for (let ly = 0; ly < newDimY; ly++) {
        const rowStart = rowZ + ly * newDimX;
        if (!zInside || ly < loY || ly >= hiY || runLength === 0) {
          newResident.fill(this.baselineValue, rowStart, rowStart + newDimX);
          continue;
        }
        // Baseline the margins on either side of the carried-over run.
        if (loX > 0) {
          newResident.fill(this.baselineValue, rowStart, rowStart + loX);
        }
        if (hiX < newDimX) {
          newResident.fill(
            this.baselineValue,
            rowStart + hiX,
            rowStart + newDimX,
          );
        }
        const oldStart =
          (lz + newOz - oldOz) * oldDimY * oldDimX +
          (ly + newOy - oldOy) * oldDimX +
          (loX + newOx - oldOx);
        newResident.set(
          this.resident.subarray(oldStart, oldStart + runLength),
          rowStart + loX,
        );
      }
    }

    // Everything left is a chunk that entered the window from outside it.
    // Only those need per-chunk resolution, and only when cold storage
    // actually holds something for them -- otherwise the baseline seed above
    // already covers it.
    for (let cz = 0; cz < next.gridDims.z; cz++) {
      const wcz = next.origin.cz + cz;
      for (let cy = 0; cy < next.gridDims.y; cy++) {
        const wcy = next.origin.cy + cy;
        for (let cx = 0; cx < next.gridDims.x; cx++) {
          const wcx = next.origin.cx + cx;
          // Same overlap test as the eviction pass, for the same reason: this
          // runs over the whole new window per channel per commit, and only the
          // newly-exposed slab needs anything done to it.
          if (inOverlap(wcx, wcy, wcz)) {
            continue; // carried over by the overlap copy above
          }
          const worldChunk: ChunkCoord = { cx: wcx, cy: wcy, cz: wcz };
          const stored = this.coldStorage.get(
            worldChunk.cx,
            worldChunk.cy,
            worldChunk.cz,
          );
          if (!stored) continue; // already baseline
          if (this.touchedSinceBaseline) {
            this.touchedSinceBaseline.add(
              chunkKey(worldChunk.cx, worldChunk.cy, worldChunk.cz),
            );
          }
          writeChunk(
            newResident,
            cx,
            cy,
            cz,
            stored,
            next.cellDims,
            this.chunkSize,
          );
        }
      }
    }

    // Hand the outgoing buffer back for the next shift to write into.
    this.spare = this.resident;
    this.resident = newResident;
    this.currentOrigin = next.origin;
    this.currentGridDims = next.gridDims;
    this.currentCellDims = next.cellDims;
  }

  /**
   * Chunks pre-authored whole-map data into cold storage, before the first
   * window `setFocus` -- mirrors the primary channel's
   * `chunkDenseArrayIntoColdStorage` (`data.ts`) exactly, minus the primary
   * channel's `forceStoreAll` concern: there's no generator here, so a
   * baseline-matching chunk left out of cold storage always resolves
   * correctly (baseline IS the correct value, not a second-guessable one).
   */
  seedFromDense(
    dense: ArrayLike<number>,
    dims: { x: number; y: number; z: number },
    originChunk: ChunkCoord = { cx: 0, cy: 0, cz: 0 },
  ): void {
    const gridX = Math.ceil(dims.x / this.chunkSize.x);
    const gridY = Math.ceil(dims.y / this.chunkSize.y);
    const gridZ = Math.ceil(dims.z / this.chunkSize.z);
    const { x: csx, y: csy, z: csz } = this.chunkSize;
    const chunkCellCount = csx * csy * csz;

    for (let cz = 0; cz < gridZ; cz++) {
      for (let cy = 0; cy < gridY; cy++) {
        for (let cx = 0; cx < gridX; cx++) {
          const cells = new Uint32Array(chunkCellCount);
          let differs = false;
          let idx = 0;
          for (let lz = 0; lz < csz; lz++) {
            const wz = cz * csz + lz;
            for (let ly = 0; ly < csy; ly++) {
              const wy = cy * csy + ly;
              for (let lx = 0; lx < csx; lx++) {
                const wx = cx * csx + lx;
                let value = this.baselineValue;
                if (wx < dims.x && wy < dims.y && wz < dims.z) {
                  value = dense[wz * dims.y * dims.x + wy * dims.x + wx];
                }
                cells[idx++] = value;
                if (value !== this.baselineValue) differs = true;
              }
            }
          }
          if (differs) {
            this.coldStorage.set(
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

  dumpEntries(): ColdStorageEntrySnapshot[] {
    return this.coldStorage.dumpEntries();
  }

  loadEntries(entries: ColdStorageEntrySnapshot[]): void {
    this.coldStorage.loadEntries(entries);
  }
}
