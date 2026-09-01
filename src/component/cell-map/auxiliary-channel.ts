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
  dims: { x: number; y: number; z: number },
  chunkSize: { x: number; y: number; z: number },
  wrap: { x: number; y: number; z: number },
): void {
  const { x: csx, y: csy, z: csz } = chunkSize;
  const { x: dimX, y: dimY } = dims;
  const baseX = (cx * csx + wrap.x) % dimX;
  const baseY = (cy * csy + wrap.y) % dimY;
  const baseZ = (cz * csz + wrap.z) % dims.z;
  let idx = 0;
  for (let z = 0; z < csz; z++) {
    for (let y = 0; y < csy; y++) {
      const rowStart = (baseZ + z) * dimY * dimX + (baseY + y) * dimX + baseX;
      out.set(flat.subarray(rowStart, rowStart + csx), idx);
      idx += csx;
    }
  }
}

/** Per-axis toroidal offset: `((v % n) + n) % n`, guarding a zero dimension. */
function wrapMod(v: number, n: number): number {
  return n > 0 ? ((v % n) + n) % n : 0;
}

/**
 * `writeChunk` addressing a toroidally-wrapped buffer.
 *
 * `wrap` is always a multiple of `chunkSize` (both the window origin in cells
 * and the window dims are), so a chunk never straddles the seam and each row
 * stays one contiguous run.
 */
function writeChunkWrapped(
  flat: Uint32Array,
  cx: number,
  cy: number,
  cz: number,
  cells: Uint32Array,
  dims: { x: number; y: number; z: number },
  chunkSize: { x: number; y: number; z: number },
  wrap: { x: number; y: number; z: number },
): void {
  const { x: csx, y: csy, z: csz } = chunkSize;
  const { x: dimX, y: dimY } = dims;
  const baseX = (cx * csx + wrap.x) % dimX;
  const baseY = (cy * csy + wrap.y) % dimY;
  const baseZ = (cz * csz + wrap.z) % dims.z;
  let idx = 0;
  for (let z = 0; z < csz; z++) {
    for (let y = 0; y < csy; y++) {
      const rowStart = (baseZ + z) * dimY * dimX + (baseY + y) * dimX + baseX;
      flat.set(cells.subarray(idx, idx + csx), rowStart);
      idx += csx;
    }
  }
}

/**
 * Fills one chunk's slot with a constant. Needed because a newly-exposed chunk
 * inherits whatever the evicted chunk left in that slot -- under toroidal
 * addressing nothing is wholesale-cleared, so clearing here is mandatory, not
 * an optimization.
 */
function fillChunkWrapped(
  flat: Uint32Array,
  cx: number,
  cy: number,
  cz: number,
  value: number,
  dims: { x: number; y: number; z: number },
  chunkSize: { x: number; y: number; z: number },
  wrap: { x: number; y: number; z: number },
): boolean {
  const { x: csx, y: csy, z: csz } = chunkSize;
  const { x: dimX, y: dimY } = dims;
  const baseX = (cx * csx + wrap.x) % dimX;
  const baseY = (cy * csy + wrap.y) % dimY;
  const baseZ = (cz * csz + wrap.z) % dims.z;
  // Reports whether anything actually changed. Callers use this to decide
  // whether a GPU texture derived from this buffer needs re-uploading at all --
  // clearing a slot that already held baseline is a no-op the renderer should
  // not have to pay for.
  let changed = false;
  for (let z = 0; z < csz; z++) {
    for (let y = 0; y < csy; y++) {
      const rowStart = (baseZ + z) * dimY * dimX + (baseY + y) * dimX + baseX;
      if (!changed) {
        for (let x = 0; x < csx; x++) {
          if (flat[rowStart + x] !== value) {
            changed = true;
            break;
          }
        }
      }
      flat.fill(value, rowStart, rowStart + csx);
    }
  }
  return changed;
}

/**
 * The shell between two windows -- the chunks in one but not the other -- as up
 * to six DISJOINT boxes, flattened as `[x0,x1,y0,y1,z0,z1, ...]` half-open, in
 * local chunk coordinates of the `g`-sized window.
 *
 * `lo`/`hi` are the overlap in those same local coordinates. An empty overlap
 * must arrive as all-zero, which collapses to a single box covering everything.
 *
 * Walking the shell rather than the whole window with a per-chunk "am I in the
 * overlap?" test is the difference between O(window volume) and O(slab area) --
 * which is the entire point of toroidal addressing, and was still being paid in
 * loop iterations even once the WRITES had been reduced to the slab. A 45x9x45
 * grid is ~18k chunks; its one-chunk shell is ~400. This runs once per channel
 * per commit, so the constant matters.
 *
 * Mirrors `CellWindow.writeExposedSlabs`'s decomposition exactly: X slabs span
 * the full Y/Z extent, Y slabs are then restricted to the overlap's X range and
 * Z slabs to its X and Y, which is what keeps the six boxes disjoint.
 */
function shellBoxes(
  lo: { x: number; y: number; z: number },
  hi: { x: number; y: number; z: number },
  g: { x: number; y: number; z: number },
): number[] {
  const boxes: number[] = [];
  if (lo.x > 0) boxes.push(0, lo.x, 0, g.y, 0, g.z);
  if (hi.x < g.x) boxes.push(hi.x, g.x, 0, g.y, 0, g.z);
  if (lo.y > 0) boxes.push(lo.x, hi.x, 0, lo.y, 0, g.z);
  if (hi.y < g.y) boxes.push(lo.x, hi.x, hi.y, g.y, 0, g.z);
  if (lo.z > 0) boxes.push(lo.x, hi.x, lo.y, hi.y, 0, lo.z);
  if (hi.z < g.z) boxes.push(lo.x, hi.x, lo.y, hi.y, hi.z, g.z);
  return boxes;
}

/**
 * `shellBoxes` for the overlap expressed in WORLD chunk coordinates, rebased
 * into the local coordinates of the window at `origin`. Half-open, and an empty
 * overlap (any axis inverted) collapses to "the whole window is shell".
 */
function shellBoxesFor(
  origin: ChunkCoord,
  gridDims: { x: number; y: number; z: number },
  ovMin: { cx: number; cy: number; cz: number },
  ovMax: { cx: number; cy: number; cz: number },
  hasOverlap: boolean,
): number[] {
  const lo = hasOverlap
    ? {
        x: ovMin.cx - origin.cx,
        y: ovMin.cy - origin.cy,
        z: ovMin.cz - origin.cz,
      }
    : { x: 0, y: 0, z: 0 };
  const hi = hasOverlap
    ? {
        x: ovMax.cx - origin.cx,
        y: ovMax.cy - origin.cy,
        z: ovMax.cz - origin.cz,
      }
    : { x: 0, y: 0, z: 0 };
  return shellBoxes(lo, hi, gridDims);
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
   * Whether this channel's buffer is toroidally addressed (a cell's slot
   * derived from its world position) rather than window-local.
   *
   * `true` makes a shift O(slab): retained cells keep their slots and only the
   * newly-exposed region is written. It requires that every consumer of
   * `value` wraps too — the cell-granular GPU textures do, via `windowSlot` in
   * unified.frag, and the mesher does for `MAP_WEIGHTS`.
   *
   * `true` for every channel now, including the fog "explored" one. That was
   * the last holdout: it was `false` because `exploredAt` wanted smooth
   * filtering and, under wrapping, the seam falls at an arbitrary point INSIDE
   * the visible window, where hardware bilinear would blend the two opposite
   * edges together into a hard line across the fog. That reasoning held only
   * while explored was one texel per chunk, which made re-laying it out on a
   * shift almost free; per CELL it would be a multi-megabyte rewrite plus a
   * full texture reupload on every camera chunk crossing. `exploredAt` now
   * does its own trilinear blend, wrapping each of its eight samples
   * independently, so no seam can form and this channel wraps like the rest.
   */
  toroidal: boolean;

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
   * Whether the most recent `onWindowChange` altered any cell. See
   * `shiftChangedContent`.
   */
  get changedOnLastWindowChange(): boolean {
    return this.shiftChangedContent;
  }

  /** See `AuxiliaryChannelConfig.toroidal`. */
  private readonly toroidal: boolean;
  /**
   * Whether the most recent `onWindowChange` actually altered any cell.
   *
   * Under toroidal addressing a shift leaves every retained cell in place, so
   * the only cells that can change are the newly-exposed slab's -- and for a
   * sparse channel like emission highlights, usually not even those. Consumers
   * holding a GPU copy read this to decide whether to re-upload at all; a full
   * rebuild is O(window) and was, when fired on every commit, by far the most
   * expensive thing on the frame.
   *
   * Set true (conservatively) by any non-shift path that cannot cheaply prove
   * otherwise, so it never claims "unchanged" when something did change.
   */
  private shiftChangedContent = false;
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
   * Recycled content is stale, so `relayoutWindowLocal` must write every cell
   * of its destination -- it does not get `new Uint32Array`'s zero-fill.
   *
   * Only the WINDOW-LOCAL re-layout needs this. A toroidal channel shifts in
   * place, so it has no second buffer at all.
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
    this.toroidal = config.toroidal;
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
   * Re-lays-out a WINDOW-LOCAL channel for a same-size shift: the overlapping
   * region carried across row-by-row, everything else baseline-filled, then
   * cold storage restored into the newly-exposed chunks.
   *
   * Only for `toroidal: false` channels, where a shift genuinely moves every
   * cell. Row memcpys rather than the per-chunk rebuild path, which at a large
   * render distance was ~80k iterations per channel per shift and measurably
   * dominated the commit frame.
   *
   * No channel is currently configured `toroidal: false` -- the fog "explored"
   * channel was the last one and now wraps like the rest (see
   * `AuxiliaryChannelConfig.toroidal`). Kept because the option is still
   * supported, not because anything exercises it.
   */
  private relayoutWindowLocal(
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
    newTotal: number,
  ): void {
    const oldOrigin = old.origin!;
    const { x: csx, y: csy, z: csz } = this.chunkSize;
    const { x: dimX, y: dimY, z: dimZ } = next.cellDims;

    // Recycled so a shift doesn't allocate a window-sized array per channel.
    let dest = this.spare;
    if (dest === null || dest.length !== newTotal) {
      dest = new Uint32Array(newTotal);
    }

    const oldOx = oldOrigin.cx * csx;
    const oldOy = oldOrigin.cy * csy;
    const oldOz = oldOrigin.cz * csz;
    const newOx = next.origin.cx * csx;
    const newOy = next.origin.cy * csy;
    const newOz = next.origin.cz * csz;

    // Overlap in NEW-local cells, half-open. Empty means "fill everything".
    let loX = Math.max(oldOx, newOx) - newOx;
    let hiX = Math.min(oldOx + old.cellDims.x, newOx + dimX) - newOx;
    let loY = Math.max(oldOy, newOy) - newOy;
    let hiY = Math.min(oldOy + old.cellDims.y, newOy + dimY) - newOy;
    let loZ = Math.max(oldOz, newOz) - newOz;
    let hiZ = Math.min(oldOz + old.cellDims.z, newOz + dimZ) - newOz;
    if (loX >= hiX || loY >= hiY || loZ >= hiZ) {
      loX = hiX = loY = hiY = loZ = hiZ = 0;
    }

    // `dest` is recycled and holds the previous window's contents, so every
    // cell must be written exactly once: overlap rows by the copy, the rest by
    // the fill.
    const runLength = hiX - loX;
    const oldDimX = old.cellDims.x;
    const oldDimY = old.cellDims.y;
    for (let lz = 0; lz < dimZ; lz++) {
      const rowZ = lz * dimY * dimX;
      const zInside = lz >= loZ && lz < hiZ;
      for (let ly = 0; ly < dimY; ly++) {
        const rowStart = rowZ + ly * dimX;
        if (!zInside || ly < loY || ly >= hiY || runLength === 0) {
          dest.fill(this.baselineValue, rowStart, rowStart + dimX);
          continue;
        }
        if (loX > 0) dest.fill(this.baselineValue, rowStart, rowStart + loX);
        if (hiX < dimX) {
          dest.fill(this.baselineValue, rowStart + hiX, rowStart + dimX);
        }
        const oldStart =
          (lz + newOz - oldOz) * oldDimY * oldDimX +
          (ly + newOy - oldOy) * oldDimX +
          (loX + newOx - oldOx);
        dest.set(
          this.resident.subarray(oldStart, oldStart + runLength),
          rowStart + loX,
        );
      }
    }

    this.spare = this.resident;
    this.resident = dest;
    this.currentOrigin = next.origin;
    this.currentGridDims = next.gridDims;
    this.currentCellDims = next.cellDims;
    // Every cell moved, so any GPU copy of this channel is wholesale stale.
    this.shiftChangedContent = true;

    // Restore cold-stored content for chunks that just ENTERED the window --
    // everything else was either carried by the copy above or baseline-filled.
    // Walked as the entering shell, so this stays O(slab) like the toroidal
    // path rather than sweeping the whole grid to reach a handful of chunks.
    const zeroWrap = { x: 0, y: 0, z: 0 };
    const cLo = {
      x: Math.max(oldOrigin.cx, next.origin.cx) - next.origin.cx,
      y: Math.max(oldOrigin.cy, next.origin.cy) - next.origin.cy,
      z: Math.max(oldOrigin.cz, next.origin.cz) - next.origin.cz,
    };
    const cHi = {
      x:
        Math.min(
          oldOrigin.cx + old.gridDims.x,
          next.origin.cx + next.gridDims.x,
        ) - next.origin.cx,
      y:
        Math.min(
          oldOrigin.cy + old.gridDims.y,
          next.origin.cy + next.gridDims.y,
        ) - next.origin.cy,
      z:
        Math.min(
          oldOrigin.cz + old.gridDims.z,
          next.origin.cz + next.gridDims.z,
        ) - next.origin.cz,
    };
    if (cLo.x >= cHi.x || cLo.y >= cHi.y || cLo.z >= cHi.z) {
      cLo.x = cHi.x = cLo.y = cHi.y = cLo.z = cHi.z = 0;
    }
    const boxes = shellBoxes(cLo, cHi, next.gridDims);
    for (let b = 0; b < boxes.length; b += 6) {
      for (let cz = boxes[b + 4]; cz < boxes[b + 5]; cz++) {
        const wcz = next.origin.cz + cz;
        for (let cy = boxes[b + 2]; cy < boxes[b + 3]; cy++) {
          const wcy = next.origin.cy + cy;
          for (let cx = boxes[b]; cx < boxes[b + 1]; cx++) {
            const wcx = next.origin.cx + cx;
            const stored = this.coldStorage.get(wcx, wcy, wcz);
            if (!stored) continue; // already baseline-filled
            if (this.touchedSinceBaseline) {
              this.touchedSinceBaseline.add(chunkKey(wcx, wcy, wcz));
            }
            writeChunkWrapped(
              this.resident,
              cx,
              cy,
              cz,
              stored,
              next.cellDims,
              this.chunkSize,
              zeroWrap,
            );
          }
        }
      }
    }
  }

  /**
   * Per-axis toroidal wrap offset for the CURRENT window, in cells. Mirrors
   * `CellWindow.wrapFor` — the two must agree, since a cell's slot is derived
   * from its world position and both sides address the same conceptual grid.
   *
   * Always a multiple of `chunkSize` (origin and dims both are), so a chunk
   * never straddles the seam and per-chunk row copies stay contiguous.
   */
  private currentWrap(): { x: number; y: number; z: number } {
    const o = this.currentOrigin;
    if (!o || !this.toroidal) return { x: 0, y: 0, z: 0 };
    const { x: csx, y: csy, z: csz } = this.chunkSize;
    const d = this.currentCellDims;
    const w = (v: number, n: number): number => (n > 0 ? ((v % n) + n) % n : 0);
    return {
      x: w(o.cx * csx, d.x),
      y: w(o.cy * csy, d.y),
      z: w(o.cz * csz, d.z),
    };
  }

  /**
   * A window-local cell coordinate expressed as its buffer SLOT coordinate.
   *
   * Callers that address this channel's buffer or its GPU texture by
   * coordinate -- the per-cell dirty logs feeding `texSubImage3D` -- must store
   * slots, not window-local coordinates, so the buffer read and the texel write
   * agree. Returns the input unchanged for a non-toroidal channel.
   */
  slotCoords(local: { x: number; y: number; z: number }): {
    x: number;
    y: number;
    z: number;
  } {
    const { x: dimX, y: dimY, z: dimZ } = this.currentCellDims;
    const wrap = this.currentWrap();
    return {
      x: (local.x + wrap.x) % dimX,
      y: (local.y + wrap.y) % dimY,
      z: (local.z + wrap.z) % dimZ,
    };
  }

  /** Buffer offset for a window-local cell coordinate under the current wrap. */
  private slot(local: { x: number; y: number; z: number }): number {
    const { x: dimX, y: dimY, z: dimZ } = this.currentCellDims;
    const wrap = this.currentWrap();
    const sx = (local.x + wrap.x) % dimX;
    const sy = (local.y + wrap.y) % dimY;
    const sz = (local.z + wrap.z) % dimZ;
    return sz * dimY * dimX + sy * dimX + sx;
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
      return this.resident[this.slot(local)];
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
      this.resident[this.slot(local)] = value;
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
    // Re-evaluated per call; only the toroidal slab path can prove "nothing
    // changed", so every other path below sets it true.
    this.shiftChangedContent = false;

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
      // Already uniform, and stays uniform -- nothing a consumer's GPU copy
      // could need to hear about.
      if (this.resident.length !== newTotal) {
        this.resident = new Uint32Array(newTotal).fill(this.baselineValue);
        this.shiftChangedContent = true; // reallocated: a new texture is needed
      } else {
        this.resident.fill(this.baselineValue);
      }
      this.currentOrigin = next.origin;
      this.currentGridDims = next.gridDims;
      this.currentCellDims = next.cellDims;
      return;
    }

    const { x: csx, y: csy, z: csz } = this.chunkSize;
    // The wrap the CURRENT buffer is addressed by. Everything read below --
    // the eviction pass, and a resize's carry-over -- must use this, because
    // it describes the data as it stands before the window moves.
    // Gated on `toroidal` for the same reason `currentWrap` is: a window-local
    // channel's buffer is NOT wrapped, so reading it through a non-zero offset
    // would pull every chunk from the wrong slot.
    const oldWrap =
      old.origin && this.toroidal
        ? {
            x: wrapMod(old.origin.cx * csx, old.cellDims.x),
            y: wrapMod(old.origin.cy * csy, old.cellDims.y),
            z: wrapMod(old.origin.cz * csz, old.cellDims.z),
          }
        : { x: 0, y: 0, z: 0 };

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
      // Chunks still resident after the shift keep whatever they hold; only the
      // DEPARTING shell is evicted, so only the departing shell is walked. The
      // old form iterated the whole old window and skipped ~97% of it with an
      // overlap test, which made eviction O(window volume) per channel however
      // little was actually leaving.
      const boxes = shellBoxesFor(
        old.origin,
        old.gridDims,
        { cx: ovMinCx, cy: ovMinCy, cz: ovMinCz },
        { cx: ovMaxCx, cy: ovMaxCy, cz: ovMaxCz },
        hasOverlap,
      );
      for (let b = 0; b < boxes.length; b += 6) {
        for (let cz = boxes[b + 4]; cz < boxes[b + 5]; cz++) {
          const wcz = old.origin.cz + cz;
          for (let cy = boxes[b + 2]; cy < boxes[b + 3]; cy++) {
            const wcy = old.origin.cy + cy;
            for (let cx = boxes[b]; cx < boxes[b + 1]; cx++) {
              const wcx = old.origin.cx + cx;
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
                oldWrap,
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
    }

    // A RESIZE changes cellDims, and with it every slot -- the toroidal
    // shortcut below does not apply, so retained chunks have to be physically
    // carried from their old slots to their new ones. O(window), but resizes
    // are debounced to at most one per zoom gesture (see RESIZE_SETTLE_FRAMES
    // in render-cell-maps.ts), unlike shifts which happen constantly.
    const dimsChanged =
      old.cellDims.x !== next.cellDims.x ||
      old.cellDims.y !== next.cellDims.y ||
      old.cellDims.z !== next.cellDims.z;

    // A non-toroidal channel's slots ARE window-local, so a plain shift moves
    // every cell. Re-laid-out ROW-WISE rather than through the per-chunk
    // rebuild below, which at a large render distance is ~80k iterations and
    // two function calls each, per channel, per shift; a row memcpy moves the
    // same bytes in a fraction of the time. Currently unreachable in-engine --
    // every channel is toroidal now (see `relayoutWindowLocal`).
    if (this.toroidal === false && !dimsChanged && old.origin) {
      this.relayoutWindowLocal(old, next, newTotal);
      return;
    }

    if (!this.toroidal || dimsChanged || !old.origin) {
      // Every cell is re-laid-out, so any GPU copy is wholesale stale.
      this.shiftChangedContent = true;
      const rebuilt = new Uint32Array(newTotal).fill(this.baselineValue);
      const prev = this.resident;
      this.resident = rebuilt;
      this.currentOrigin = next.origin;
      this.currentGridDims = next.gridDims;
      this.currentCellDims = next.cellDims;
      const wrapNew = this.currentWrap();
      const scratch = evictionScratch(csx * csy * csz);
      for (let cz = 0; cz < next.gridDims.z; cz++) {
        const wcz = next.origin.cz + cz;
        for (let cy = 0; cy < next.gridDims.y; cy++) {
          const wcy = next.origin.cy + cy;
          for (let cx = 0; cx < next.gridDims.x; cx++) {
            const wcx = next.origin.cx + cx;
            let cells: Uint32Array | undefined;
            if (old.origin && inOverlap(wcx, wcy, wcz)) {
              extractChunkInto(
                scratch,
                prev,
                wcx - old.origin.cx,
                wcy - old.origin.cy,
                wcz - old.origin.cz,
                old.cellDims,
                this.chunkSize,
                oldWrap,
              );
              cells = scratch;
            } else {
              const stored = this.coldStorage.get(wcx, wcy, wcz);
              if (stored) {
                if (this.touchedSinceBaseline) {
                  this.touchedSinceBaseline.add(chunkKey(wcx, wcy, wcz));
                }
                cells = stored;
              }
            }
            if (!cells) continue; // rebuilt buffer is already baseline
            writeChunkWrapped(
              this.resident,
              cx,
              cy,
              cz,
              cells,
              next.cellDims,
              this.chunkSize,
              wrapNew,
            );
          }
        }
      }
      return;
    }

    // Under toroidal addressing a cell's slot derives from its WORLD position,
    // so every chunk that stays resident is already in the slot the new origin
    // implies. There is nothing to carry across: declaring the new window IS
    // the shift. Only the newly-exposed slab gets written, which is what turns
    // this from O(window volume) into O(slab area) -- the difference between
    // 21ms and well under 2ms at a large render distance.
    //
    // The resident buffer is therefore kept in place rather than swapped, and
    // the `spare` double-buffer that the whole-window copy needed is gone.
    this.currentOrigin = next.origin;
    this.currentGridDims = next.gridDims;
    this.currentCellDims = next.cellDims;

    // Everything outside the overlap is newly exposed: reset it to baseline,
    // then restore anything cold storage held for it. Runs AFTER the window
    // state is updated above, so `slot`/`writeChunkWrapped` address the new
    // window.
    const wrap = this.currentWrap();
    // Walked as the exposed shell rather than the whole window with an overlap
    // skip: the WRITES were already slab-limited, but the ITERATION was not, so
    // this stayed O(window volume) per channel per commit -- ~18k iterations to
    // reach ~400 chunks of real work at a 3x render distance.
    const boxes = shellBoxesFor(
      next.origin,
      next.gridDims,
      { cx: ovMinCx, cy: ovMinCy, cz: ovMinCz },
      { cx: ovMaxCx, cy: ovMaxCy, cz: ovMaxCz },
      hasOverlap,
    );
    for (let b = 0; b < boxes.length; b += 6) {
      for (let cz = boxes[b + 4]; cz < boxes[b + 5]; cz++) {
        const wcz = next.origin.cz + cz;
        for (let cy = boxes[b + 2]; cy < boxes[b + 3]; cy++) {
          const wcy = next.origin.cy + cy;
          for (let cx = boxes[b]; cx < boxes[b + 1]; cx++) {
            const wcx = next.origin.cx + cx;
            const stored = this.coldStorage.get(wcx, wcy, wcz);
            if (stored) {
              if (this.touchedSinceBaseline) {
                this.touchedSinceBaseline.add(chunkKey(wcx, wcy, wcz));
              }
              writeChunkWrapped(
                this.resident,
                cx,
                cy,
                cz,
                stored,
                next.cellDims,
                this.chunkSize,
                wrap,
              );
              this.shiftChangedContent = true;
            } else {
              // The slot still holds the evicted chunk's data, so clearing is
              // mandatory rather than an optimization.
              if (
                fillChunkWrapped(
                  this.resident,
                  cx,
                  cy,
                  cz,
                  this.baselineValue,
                  next.cellDims,
                  this.chunkSize,
                  wrap,
                )
              ) {
                this.shiftChangedContent = true;
              }
            }
          }
        }
      }
    }
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
