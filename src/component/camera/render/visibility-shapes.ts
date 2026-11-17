/**
 * The shared visibility-shape store: every vision-source SPHERE and every
 * visibility-volume BOX, binned on one uniform XZ grid so a lookup only visits
 * the shapes that could reach a point.
 *
 * One structure serves both sides of the fog system:
 *
 *   - the GPU, which receives the shapes and the bins as two data textures
 *     (`packShapeTexels` / `packBinWords`) and walks the bin under each fragment;
 *   - the CPU, whose `computeFogVisibility` / `isVisibleFrom` callers gather the
 *     same bin's shapes (`gatherShapesAt` / `gatherShapesInRect`) before testing.
 *
 * Because both sides read the same bin for the same point, the CPU and GPU
 * still see exactly the same candidate set, which is what keeps sprite fog,
 * terrain fog and explored marking in agreement. There is no compiled-in shape
 * count anywhere: the store, the bins and the textures all size to the data.
 *
 * Deliberately a leaf module: no GL, no component imports, nothing from the
 * registry -- same reasoning as fog-of-war/sweep.ts. Its runtime imports are
 * none; `ResolvedSource` is a type and erases.
 */

import type { ResolvedSource } from '../../fog-of-war/sweep';

/**
 * Upper bound on bins along either axis. Keeps a scene whose shapes are spread
 * very far apart from allocating an enormous grid: past this the bins simply
 * get coarser, which costs per-fragment work but never correctness.
 */
export const MAX_BINS_PER_AXIS = 256;

/**
 * Texel width of both data textures. 1024 is half WebGL2's guaranteed
 * `MAX_TEXTURE_SIZE` minimum (2048), so it is valid on every device; capacity
 * grows by adding rows.
 */
export const VIS_TEX_WIDTH = 1024;

/** Texels per shape in the shape texture (two RGBA32F texels). */
export const TEXELS_PER_SHAPE = 2;

/** Whether a resolved shape is a box (visibility-volume) rather than a sphere. */
export function isBoxShape(s: ResolvedSource): boolean {
  return s.half !== undefined && s.half !== null;
}

/**
 * Visibility a box contributes at a point, 0..1. Mirrors unified.frag's
 * `boxVisibility` term for term.
 *
 * `(cx, cy, cz)` is the CENTRE of the cell being asked about, never a raw
 * fragment position: a volume's edge lands on the cell grid, so a cell is wholly
 * inside or wholly outside. Inside (or exactly on the surface) is 1. Outside it
 * ramps to 0 across `fade` with the same smoothstep convention vision sources
 * use, and a zero `fade` is a hard edge.
 */
export function boxVisibility(
  cx: number,
  cy: number,
  cz: number,
  center: { x: number; y: number; z: number },
  half: { x: number; y: number; z: number },
  fade: number,
): number {
  const dx = Math.max(Math.abs(cx - center.x) - half.x, 0);
  const dy = Math.max(Math.abs(cy - center.y) - half.y, 0);
  const dz = Math.max(Math.abs(cz - center.z) - half.z, 0);
  const distSq = dx * dx + dy * dy + dz * dz;
  if (distSq <= 0) return 1;
  if (!(fade > 0)) return 0;
  const dist = Math.sqrt(distSq);
  if (dist >= fade) return 0;
  const t = dist / fade;
  return 1 - t * t * (3 - 2 * t);
}

/**
 * The world-space centre of the cell containing `p`. Boxes are tested against
 * this rather than `p` itself -- see `boxVisibility`.
 */
export function cellCentreOf(p: number, cellSize: number): number {
  return (Math.floor(p / cellSize) + 0.5) * cellSize;
}

/** A uniform XZ grid of shape indices. Pooled; rebuild with `buildShapeGrid`. */
export interface ShapeGrid {
  /** World X/Z of bin (0, 0)'s minimum corner. */
  originX: number;
  originZ: number;
  /** Edge length of one (square) bin, in world units. */
  binSize: number;
  /** Bin counts. Both 0 when there is nothing to bin. */
  binsX: number;
  binsZ: number;
  /**
   * Prefix offsets into `indices`, `binsX * binsZ + 1` valid entries: bin `b`
   * owns `indices[offsets[b] .. offsets[b + 1])`. Grown to a high-water mark.
   */
  offsets: Uint32Array;
  /** Shape indices, grouped by bin; `indexCount` valid entries. */
  indices: Uint32Array;
  indexCount: number;
  /** Fill scratch, one per bin. */
  cursor: Uint32Array;
}

export function createShapeGrid(): ShapeGrid {
  return {
    originX: 0,
    originZ: 0,
    binSize: 1,
    binsX: 0,
    binsZ: 0,
    offsets: new Uint32Array(1),
    indices: new Uint32Array(0),
    indexCount: 0,
    cursor: new Uint32Array(0),
  };
}

/** Optional world-space XZ rectangle the grid is clipped to. */
export interface GridClamp {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/** Number of bins in a built grid. */
export function binCount(grid: ShapeGrid): number {
  return grid.binsX * grid.binsZ;
}

function grow(arr: Uint32Array, needed: number): Uint32Array {
  if (arr.length >= needed) return arr;
  let size = Math.max(16, arr.length);
  while (size < needed) size *= 2;
  return new Uint32Array(size);
}

/**
 * XZ half-extent of a shape's influence. A box is padded by `boxPad` (a cell)
 * because it is tested at the CELL CENTRE nearest the query point, which can sit
 * up to half a cell away from that point -- without the pad, a fragment on the
 * outer half of an edge cell would look up a bin that never received the box.
 */
function reachX(s: ResolvedSource, boxPad: number): number {
  return s.half ? s.half.x + s.fadeWidth + boxPad : s.radius + s.fadeWidth;
}
function reachZ(s: ResolvedSource, boxPad: number): number {
  return s.half ? s.half.z + s.fadeWidth + boxPad : s.radius + s.fadeWidth;
}

/**
 * Rebuilds `grid` over the first `count` entries of `shapes`.
 *
 * The grid covers the union of every shape's influence rectangle, clipped to
 * `clamp` when one is given (the renderer passes the resident window, so a far
 * outlier cannot coarsen the bins over what is actually on screen). Bin size is
 * at least `minBinSize` and grows only if the area would need more than
 * `MAX_BINS_PER_AXIS` bins along an axis.
 *
 * Within each bin, boxes are listed before spheres. A box needs no raycast and
 * usually saturates visibility to 1, which lets both the shader's and the CPU's
 * early-out stop before paying for any sphere's line-of-sight rays.
 *
 * Allocation-free once warmed: the typed arrays grow to a high-water mark.
 */
export function buildShapeGrid(
  grid: ShapeGrid,
  shapes: readonly ResolvedSource[],
  count: number,
  minBinSize: number,
  boxPad: number,
  clamp: GridClamp | null,
): void {
  grid.binsX = 0;
  grid.binsZ = 0;
  grid.indexCount = 0;
  grid.offsets[0] = 0;
  if (count <= 0) return;

  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < count; i++) {
    const s = shapes[i];
    const rx = reachX(s, boxPad);
    const rz = reachZ(s, boxPad);
    if (s.pos.x - rx < minX) minX = s.pos.x - rx;
    if (s.pos.x + rx > maxX) maxX = s.pos.x + rx;
    if (s.pos.z - rz < minZ) minZ = s.pos.z - rz;
    if (s.pos.z + rz > maxZ) maxZ = s.pos.z + rz;
  }
  if (clamp) {
    if (clamp.minX > minX) minX = clamp.minX;
    if (clamp.minZ > minZ) minZ = clamp.minZ;
    if (clamp.maxX < maxX) maxX = clamp.maxX;
    if (clamp.maxZ < maxZ) maxZ = clamp.maxZ;
  }
  if (!(maxX > minX) || !(maxZ > minZ)) return;

  const w = maxX - minX;
  const d = maxZ - minZ;
  const binSize = Math.max(
    minBinSize > 0 ? minBinSize : 1,
    Math.max(w, d) / MAX_BINS_PER_AXIS,
  );
  const binsX = Math.max(1, Math.ceil(w / binSize));
  const binsZ = Math.max(1, Math.ceil(d / binSize));
  const numBins = binsX * binsZ;

  grid.originX = minX;
  grid.originZ = minZ;
  grid.binSize = binSize;
  grid.binsX = binsX;
  grid.binsZ = binsZ;
  grid.offsets = grow(grid.offsets, numBins + 1);
  grid.cursor = grow(grid.cursor, numBins);
  const offsets = grid.offsets;
  offsets.fill(0, 0, numBins + 1);

  // Pass 1: count entries per bin (stored one slot right, for the prefix sum).
  for (let i = 0; i < count; i++) {
    const s = shapes[i];
    const rx = reachX(s, boxPad);
    const rz = reachZ(s, boxPad);
    const bx0 = Math.max(0, Math.floor((s.pos.x - rx - minX) / binSize));
    const bx1 = Math.min(
      binsX - 1,
      Math.floor((s.pos.x + rx - minX) / binSize),
    );
    const bz0 = Math.max(0, Math.floor((s.pos.z - rz - minZ) / binSize));
    const bz1 = Math.min(
      binsZ - 1,
      Math.floor((s.pos.z + rz - minZ) / binSize),
    );
    for (let bz = bz0; bz <= bz1; bz++) {
      const row = bz * binsX;
      for (let bx = bx0; bx <= bx1; bx++) offsets[row + bx + 1]++;
    }
  }
  for (let b = 1; b <= numBins; b++) offsets[b] += offsets[b - 1];

  const total = offsets[numBins];
  grid.indices = grow(grid.indices, total);
  const indices = grid.indices;
  const cursor = grid.cursor;
  cursor.set(offsets.subarray(0, numBins));

  // Pass 2: fill, boxes first, then spheres (see the doc comment).
  for (let pass = 0; pass < 2; pass++) {
    const wantBox = pass === 0;
    for (let i = 0; i < count; i++) {
      const s = shapes[i];
      if (isBoxShape(s) !== wantBox) continue;
      const rx = reachX(s, boxPad);
      const rz = reachZ(s, boxPad);
      const bx0 = Math.max(0, Math.floor((s.pos.x - rx - minX) / binSize));
      const bx1 = Math.min(
        binsX - 1,
        Math.floor((s.pos.x + rx - minX) / binSize),
      );
      const bz0 = Math.max(0, Math.floor((s.pos.z - rz - minZ) / binSize));
      const bz1 = Math.min(
        binsZ - 1,
        Math.floor((s.pos.z + rz - minZ) / binSize),
      );
      for (let bz = bz0; bz <= bz1; bz++) {
        const row = bz * binsX;
        for (let bx = bx0; bx <= bx1; bx++) {
          indices[cursor[row + bx]++] = i;
        }
      }
    }
  }
  grid.indexCount = total;
}

/** The bin containing world point (x, z), or -1 outside the grid. */
export function binIndexAt(grid: ShapeGrid, x: number, z: number): number {
  if (grid.binsX === 0) return -1;
  const gx = Math.floor((x - grid.originX) / grid.binSize);
  const gz = Math.floor((z - grid.originZ) / grid.binSize);
  if (gx < 0 || gz < 0 || gx >= grid.binsX || gz >= grid.binsZ) return -1;
  return gz * grid.binsX + gx;
}

/**
 * Fills `out` with the shapes binned under world point (x, z) -- exactly the
 * set the shader walks for a fragment at that point -- and returns it. Empty
 * outside the grid, which is correct: the grid covers every shape's reach.
 */
export function gatherShapesAt(
  grid: ShapeGrid,
  shapes: readonly ResolvedSource[],
  x: number,
  z: number,
  out: ResolvedSource[],
): ResolvedSource[] {
  out.length = 0;
  const b = binIndexAt(grid, x, z);
  if (b < 0) return out;
  const end = grid.offsets[b + 1];
  for (let k = grid.offsets[b]; k < end; k++) {
    out.push(shapes[grid.indices[k]]);
  }
  return out;
}

// Dedupe scratch for gatherShapesInRect: a shape spanning several bins appears
// in each of them. Stamped with an epoch so it never needs clearing.
let rectStamp = new Uint32Array(0);
let rectEpoch = 0;

/**
 * Fills `out` with every shape binned anywhere in the world XZ rectangle,
 * each once, and returns it. Used where one query covers an area rather than a
 * point (a vision source's explored flood-fill).
 */
export function gatherShapesInRect(
  grid: ShapeGrid,
  shapes: readonly ResolvedSource[],
  shapeCount: number,
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
  out: ResolvedSource[],
): ResolvedSource[] {
  out.length = 0;
  if (grid.binsX === 0) return out;
  const bs = grid.binSize;
  const bx0 = Math.max(0, Math.floor((minX - grid.originX) / bs));
  const bx1 = Math.min(grid.binsX - 1, Math.floor((maxX - grid.originX) / bs));
  const bz0 = Math.max(0, Math.floor((minZ - grid.originZ) / bs));
  const bz1 = Math.min(grid.binsZ - 1, Math.floor((maxZ - grid.originZ) / bs));
  if (bx0 > bx1 || bz0 > bz1) return out;

  if (rectStamp.length < shapeCount) {
    rectStamp = new Uint32Array(Math.max(16, shapeCount * 2));
    rectEpoch = 0;
  }
  rectEpoch++;
  if (rectEpoch === 0xffffffff) {
    rectStamp.fill(0);
    rectEpoch = 1;
  }
  for (let bz = bz0; bz <= bz1; bz++) {
    for (let bx = bx0; bx <= bx1; bx++) {
      const b = bz * grid.binsX + bx;
      const end = grid.offsets[b + 1];
      for (let k = grid.offsets[b]; k < end; k++) {
        const i = grid.indices[k];
        if (rectStamp[i] === rectEpoch) continue;
        rectStamp[i] = rectEpoch;
        out.push(shapes[i]);
      }
    }
  }
  return out;
}

/** Rows a data texture of `texels` texels needs at `VIS_TEX_WIDTH`. */
export function texRows(texels: number): number {
  return Math.max(1, Math.ceil(texels / VIS_TEX_WIDTH));
}

/**
 * Packs the first `count` shapes into RGBA32F texel data, two texels each:
 *
 *   texel 0: (pos.x, pos.y, pos.z, radius)     -- radius 0 for a box
 *   texel 1: (fadeWidth, half.x, half.y, half.z) -- half.x = -1 marks a sphere
 *
 * `out` must hold at least `texRows(count * 2) * VIS_TEX_WIDTH * 4` floats.
 */
export function packShapeTexels(
  shapes: readonly ResolvedSource[],
  count: number,
  out: Float32Array,
): void {
  for (let i = 0; i < count; i++) {
    const s = shapes[i];
    const o = i * 8;
    out[o] = s.pos.x;
    out[o + 1] = s.pos.y;
    out[o + 2] = s.pos.z;
    out[o + 4] = s.fadeWidth;
    if (s.half) {
      out[o + 3] = 0;
      out[o + 5] = s.half.x;
      out[o + 6] = s.half.y;
      out[o + 7] = s.half.z;
    } else {
      out[o + 3] = s.radius;
      out[o + 5] = -1;
      out[o + 6] = -1;
      out[o + 7] = -1;
    }
  }
}

/**
 * Packs a built grid into one R32UI word stream: the `binCount + 1` prefix
 * offsets first, then every index. The shader reads bin `b`'s range from words
 * `b` and `b + 1` and its entries from `binCount + 1 + k`. Returns the word
 * count. `out` must hold at least that many words, rounded up to whole rows.
 */
export function packBinWords(grid: ShapeGrid, out: Uint32Array): number {
  const numBins = binCount(grid);
  out.set(grid.offsets.subarray(0, numBins + 1), 0);
  out.set(grid.indices.subarray(0, grid.indexCount), numBins + 1);
  return numBins + 1 + grid.indexCount;
}

/** Word count `packBinWords` will produce for `grid`. */
export function binWordCount(grid: ShapeGrid): number {
  return binCount(grid) + 1 + grid.indexCount;
}
