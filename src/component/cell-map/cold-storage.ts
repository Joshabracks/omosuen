/**
 * Tiered, GC-avoidant storage for cell-map chunks that live outside the
 * shiftable hot window (see `window.ts`). Holds only chunks that diverge from
 * their baseline (a generated or default-empty state) — an untouched chunk
 * costs nothing here at all.
 *
 * Two slot tiers share the same pre-allocated-pool discipline:
 * - RLE (tier 0): run-value/run-length pairs, for chunks whose divergence
 *   compresses well (sparse edits against a baseline, or naturally repetitive
 *   hand-authored content).
 * - Dense (tier 1): one flat `chunkCellCount`-length array per slot, for
 *   chunks that don't compress well (no generator at all, or densely
 *   hand-detailed content) — the amount stored is proportional to the
 *   content's actual entropy, not a flaw in the RLE tier.
 *
 * Both tiers grow (double) only when their free-list empties, never per-chunk
 * — the data that scales with touched-chunk count lives in a handful of
 * long-lived typed-array buffers, not per-chunk objects.
 */

/** A pool of fixed-size typed-array slots, grow-only (doubles on demand). */
class SlabPool {
  private buffer: Uint32Array;
  private readonly slotWords: number;
  private readonly freeList: number[] = [];
  private allocatedSlots = 0;
  private capacitySlots: number;

  constructor(slotWords: number, initialCapacitySlots: number) {
    this.slotWords = slotWords;
    this.capacitySlots = Math.max(1, initialCapacitySlots);
    this.buffer = new Uint32Array(this.capacitySlots * slotWords);
  }

  allocate(): number {
    const reused = this.freeList.pop();
    if (reused !== undefined) return reused;
    if (this.allocatedSlots >= this.capacitySlots) this.grow();
    return this.allocatedSlots++;
  }

  free(slot: number): void {
    this.freeList.push(slot);
  }

  slotView(slot: number): Uint32Array {
    return this.buffer.subarray(
      slot * this.slotWords,
      (slot + 1) * this.slotWords,
    );
  }

  private grow(): void {
    const newCapacity = this.capacitySlots * 2;
    const newBuffer = new Uint32Array(newCapacity * this.slotWords);
    newBuffer.set(this.buffer);
    this.buffer = newBuffer;
    this.capacitySlots = newCapacity;
  }
}

/**
 * Packs a signed chunk coordinate into a single safe-integer Map key. 17 bits
 * per axis (bias 2^16), giving a range of ±65536 chunks per axis — generous
 * (millions of cells per axis at any reasonable chunk size) but not literally
 * unbounded; coordinates outside this range silently wrap rather than
 * throwing. Chosen over a string key to avoid a per-lookup string allocation.
 */
const AXIS_SPAN = 1 << 17;
const AXIS_BIAS = 1 << 16;

function packChunkKey(cx: number, cy: number, cz: number): number {
  const mask = AXIS_SPAN - 1;
  const bx = (cx + AXIS_BIAS) & mask;
  const by = (cy + AXIS_BIAS) & mask;
  const bz = (cz + AXIS_BIAS) & mask;
  return bx + by * AXIS_SPAN + bz * AXIS_SPAN * AXIS_SPAN;
}

/** Inverse of `packChunkKey`. */
function unpackChunkKey(key: number): {
  cx: number;
  cy: number;
  cz: number;
} {
  const bx = key % AXIS_SPAN;
  const rem = Math.floor(key / AXIS_SPAN);
  const by = rem % AXIS_SPAN;
  const bz = Math.floor(rem / AXIS_SPAN);
  return { cx: bx - AXIS_BIAS, cy: by - AXIS_BIAS, cz: bz - AXIS_BIAS };
}

interface SlotRef {
  tier: 0 | 1;
  slot: number;
}

/** Compresses `cells` into RLE runs, or returns null if it needs more than `maxRuns`. */
function tryEncodeRLE(
  cells: Uint32Array,
  maxRuns: number,
): { values: number[]; counts: number[] } | null {
  const values: number[] = [];
  const counts: number[] = [];
  let current = cells[0];
  let count = 1;
  for (let i = 1; i < cells.length; i++) {
    if (cells[i] === current) {
      count++;
      continue;
    }
    values.push(current);
    counts.push(count);
    if (values.length > maxRuns) return null;
    current = cells[i];
    count = 1;
  }
  values.push(current);
  counts.push(count);
  if (values.length > maxRuns) return null;
  return { values, counts };
}

/**
 * A stored chunk's contents in native tier form — the shape used for
 * serialization, so a save doesn't have to decode-then-recompress every
 * RLE-tier chunk. Plain numbers/arrays throughout so this round-trips
 * through JSON as-is.
 */
export type ColdStorageEntrySnapshot =
  | {
      cx: number;
      cy: number;
      cz: number;
      kind: 'rle';
      values: number[];
      counts: number[];
    }
  | { cx: number; cy: number; cz: number; kind: 'dense'; cells: number[] };

export interface ChunkColdStorageConfig {
  /** Cells per chunk (chunkSize.x * chunkSize.y * chunkSize.z). */
  chunkCellCount: number;
  /** Max RLE runs per compressed slot before falling back to the dense tier. Default 64. */
  maxRunsPerSlot?: number;
  /** Initial slot capacity per tier, before the first grow. Default 16. */
  initialCapacitySlots?: number;
}

export class ChunkColdStorage {
  private readonly chunkCellCount: number;
  private readonly maxRuns: number;
  private readonly rlePool: SlabPool;
  private readonly densePool: SlabPool;
  private readonly index = new Map<number, SlotRef>();

  constructor(config: ChunkColdStorageConfig) {
    this.chunkCellCount = config.chunkCellCount;
    this.maxRuns = config.maxRunsPerSlot ?? 64;
    const initialCapacitySlots = config.initialCapacitySlots ?? 16;
    // RLE slot layout: [runCount, v0,c0, v1,c1, ..., v(K-1),c(K-1)].
    this.rlePool = new SlabPool(1 + 2 * this.maxRuns, initialCapacitySlots);
    this.densePool = new SlabPool(this.chunkCellCount, initialCapacitySlots);
  }

  has(cx: number, cy: number, cz: number): boolean {
    return this.index.has(packChunkKey(cx, cy, cz));
  }

  /** Returns a freshly-decoded copy of the chunk's cells, or null if there's no entry. */
  get(cx: number, cy: number, cz: number): Uint32Array | null {
    const ref = this.index.get(packChunkKey(cx, cy, cz));
    if (!ref) return null;
    if (ref.tier === 1) {
      return this.densePool.slotView(ref.slot).slice();
    }
    const slot = this.rlePool.slotView(ref.slot);
    const runCount = slot[0];
    const out = new Uint32Array(this.chunkCellCount);
    let idx = 0;
    for (let r = 0; r < runCount; r++) {
      const value = slot[1 + r * 2];
      const count = slot[1 + r * 2 + 1];
      out.fill(value, idx, idx + count);
      idx += count;
    }
    return out;
  }

  /** Stores (or replaces) a chunk's cells, choosing whichever tier fits better. */
  set(cx: number, cy: number, cz: number, cells: Uint32Array): void {
    if (cells.length !== this.chunkCellCount) {
      throw new Error(
        `ChunkColdStorage.set: expected ${this.chunkCellCount} cells, got ${cells.length}`,
      );
    }
    // A chunk's compressibility can change between edits, so free any
    // existing entry before writing — it may need to move tiers.
    this.delete(cx, cy, cz);

    const key = packChunkKey(cx, cy, cz);
    const encoded = tryEncodeRLE(cells, this.maxRuns);
    if (encoded) {
      const slot = this.rlePool.allocate();
      const view = this.rlePool.slotView(slot);
      view[0] = encoded.values.length;
      for (let r = 0; r < encoded.values.length; r++) {
        view[1 + r * 2] = encoded.values[r];
        view[1 + r * 2 + 1] = encoded.counts[r];
      }
      this.index.set(key, { tier: 0, slot });
    } else {
      const slot = this.densePool.allocate();
      this.densePool.slotView(slot).set(cells);
      this.index.set(key, { tier: 1, slot });
    }
  }

  delete(cx: number, cy: number, cz: number): void {
    const key = packChunkKey(cx, cy, cz);
    const ref = this.index.get(key);
    if (!ref) return;
    if (ref.tier === 0) this.rlePool.free(ref.slot);
    else this.densePool.free(ref.slot);
    this.index.delete(key);
  }

  /** Number of chunks currently stored (diagnostics/tests). */
  get size(): number {
    return this.index.size;
  }

  /**
   * Dumps every stored chunk in its native tier representation (RLE runs or
   * a dense cell array) — the save-format shape a chunked serializer wants,
   * avoiding a decode-then-recompress round trip for RLE-tier chunks.
   */
  dumpEntries(): ColdStorageEntrySnapshot[] {
    const out: ColdStorageEntrySnapshot[] = [];
    for (const [key, ref] of this.index) {
      const { cx, cy, cz } = unpackChunkKey(key);
      if (ref.tier === 0) {
        const slot = this.rlePool.slotView(ref.slot);
        const runCount = slot[0];
        const values: number[] = new Array<number>(runCount);
        const counts: number[] = new Array<number>(runCount);
        for (let r = 0; r < runCount; r++) {
          values[r] = slot[1 + r * 2];
          counts[r] = slot[1 + r * 2 + 1];
        }
        out.push({ cx, cy, cz, kind: 'rle', values, counts });
      } else {
        out.push({
          cx,
          cy,
          cz,
          kind: 'dense',
          cells: Array.from(this.densePool.slotView(ref.slot)),
        });
      }
    }
    return out;
  }

  /**
   * Repopulates storage from a snapshot produced by `dumpEntries` (e.g. on
   * scene load). Clears any existing entries first.
   */
  loadEntries(entries: ColdStorageEntrySnapshot[]): void {
    this.clear();
    for (const entry of entries) {
      const key = packChunkKey(entry.cx, entry.cy, entry.cz);
      if (entry.kind === 'rle') {
        if (entry.values.length > this.maxRuns) {
          throw new Error(
            `ChunkColdStorage.loadEntries: RLE entry for chunk ` +
              `(${entry.cx},${entry.cy},${entry.cz}) has ${entry.values.length} runs, ` +
              `exceeding maxRunsPerSlot (${this.maxRuns})`,
          );
        }
        const slot = this.rlePool.allocate();
        const view = this.rlePool.slotView(slot);
        view[0] = entry.values.length;
        for (let r = 0; r < entry.values.length; r++) {
          view[1 + r * 2] = entry.values[r];
          view[1 + r * 2 + 1] = entry.counts[r];
        }
        this.index.set(key, { tier: 0, slot });
      } else {
        if (entry.cells.length !== this.chunkCellCount) {
          throw new Error(
            `ChunkColdStorage.loadEntries: dense entry for chunk ` +
              `(${entry.cx},${entry.cy},${entry.cz}) has ${entry.cells.length} cells, ` +
              `expected ${this.chunkCellCount}`,
          );
        }
        const slot = this.densePool.allocate();
        this.densePool.slotView(slot).set(entry.cells);
        this.index.set(key, { tier: 1, slot });
      }
    }
  }

  /** Frees every stored entry back to both tiers' free lists. */
  clear(): void {
    for (const ref of this.index.values()) {
      if (ref.tier === 0) this.rlePool.free(ref.slot);
      else this.densePool.free(ref.slot);
    }
    this.index.clear();
  }
}
