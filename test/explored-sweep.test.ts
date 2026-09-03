/**
 * Fog-of-war explored-cell sweep.
 *
 * Drives `markExploredCells` directly against fabricated callbacks and a
 * hand-built solidity mask -- no WebGL, no WASM, no cell-map. Every case here
 * pins one of the reasons terrain a villager had plainly walked past used to
 * render as never-viewed black.
 *
 * Run: npx tsx test/explored-sweep.test.ts
 */

import {
  markExploredCells,
  type ExploredWindow,
} from '../src/component/camera/render/explored-cells';
import {
  computeFogVisibility,
  isVisibleFrom,
  type ResolvedSource,
} from '../src/component/fog-of-war/sweep';

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.error(`  FAIL  ${label}${detail ? ` -- ${detail}` : ''}`);
  }
}

// ── Fixture ────────────────────────────────────────────────────────────────
//
// cellSize 1 so world coordinates and cell coordinates are the same number and
// the geometry below reads at a glance. Cell N spans [N, N+1), centre N+0.5.

const CELL_SIZE = { x: 1, y: 1, z: 1 };
const CELL_DIMS = { x: 12, y: 4, z: 12 };
const ORIGIN_CELL = { x: 0, y: 0, z: 0 };

function emptyMask(): Uint8Array {
  return new Uint8Array(CELL_DIMS.x * CELL_DIMS.y * CELL_DIMS.z);
}

function solidAt(mask: Uint8Array, x: number, y: number, z: number): void {
  mask[z * CELL_DIMS.y * CELL_DIMS.x + y * CELL_DIMS.x + x] = 255;
}

function windowOf(mask: Uint8Array): ExploredWindow {
  return { mask, originCell: ORIGIN_CELL, cellDims: CELL_DIMS };
}

/** A source at (x,y,z), matching `resolveActiveVisionSources`. */
function source(
  x: number,
  y: number,
  z: number,
  radius: number,
  fadeWidth = 0,
): ResolvedSource {
  const outer = radius + fadeWidth;
  return {
    pos: { x, y, z },
    localCell: {
      x: x - ORIGIN_CELL.x,
      y: y - ORIGIN_CELL.y,
      z: z - ORIGIN_CELL.z,
    },
    outerSq: outer * outer,
    radius,
    fadeWidth,
  };
}

/** A recording sink: nothing starts explored, everything marked is collected. */
function sink() {
  const marked = new Set<string>();
  let reads = 0;
  return {
    marked,
    get reads() {
      return reads;
    },
    isExplored: (x: number, y: number, z: number): boolean => {
      reads++;
      return marked.has(`${x},${y},${z}`);
    },
    mark: (x: number, y: number, z: number): void => {
      marked.add(`${x},${y},${z}`);
    },
    has: (x: number, y: number, z: number): boolean =>
      marked.has(`${x},${y},${z}`),
  };
}

// ── The shared predicate ───────────────────────────────────────────────────
//
// `isVisibleFrom` exists to be exactly `computeFogVisibility(...) > 0` while
// stopping at the first ray that gets through. If those two ever drift, memory
// and the live view start disagreeing about what counts as seen -- which is the
// whole class of bug this consolidation removes.

console.log('\nvisibility predicate equivalence');

{
  const mask = emptyMask();
  // A short wall with a gap, so plenty of sample points sit on both sides of
  // the "some rays get through" boundary rather than trivially in or out.
  for (let z = 0; z < 12; z++) if (z !== 5) solidAt(mask, 5, 0, z);
  const sources = [source(2.5, 0.5, 5.5, 6, 3)];

  let compared = 0;
  let disagreements = 0;
  let sawVisible = false;
  let sawHidden = false;
  for (let z = 0; z < 12; z++) {
    for (let x = 0; x < 12; x++) {
      const p = { x: x + 0.5, y: 0.5, z: z + 0.5 };
      const smooth = computeFogVisibility(
        p,
        sources,
        mask,
        CELL_DIMS,
        ORIGIN_CELL,
        CELL_SIZE,
      );
      const boolean = isVisibleFrom(
        p,
        sources,
        mask,
        CELL_DIMS,
        ORIGIN_CELL,
        CELL_SIZE,
      );
      compared++;
      if (smooth > 0) sawVisible = true;
      else sawHidden = true;
      if (smooth > 0 !== boolean) disagreements++;
    }
  }
  check(
    'the fixture actually exercises both outcomes',
    sawVisible && sawHidden,
  );
  check(
    'isVisibleFrom agrees with computeFogVisibility > 0 at every point',
    disagreements === 0,
    `${disagreements} of ${compared} disagreed`,
  );
}

// ── Range ──────────────────────────────────────────────────────────────────

console.log('\nrange');

{
  const s = sink();
  const mask = emptyMask();
  const src = source(4.5, 0.5, 4.5, 2.5);
  markExploredCells(
    src.pos,
    [src],
    2.5,
    CELL_SIZE,
    windowOf(mask),
    s.isExplored,
    s.mark,
  );

  check('the source cell itself is explored', s.has(4, 0, 4));
  check('a cell two out along +x is explored', s.has(6, 0, 4));
  check('and two out along +z is explored', s.has(4, 0, 6));
  check(
    // x and z are the same horizontal ground axes and must behave identically.
    // The old chunk texture filtered one and not the other, which is what drew
    // a hard line across z.
    'x and z reach exactly as far as each other',
    s.has(6, 0, 4) === s.has(4, 0, 6) && s.has(2, 0, 4) === s.has(4, 0, 2),
  );
  check('a cell beyond the radius is not explored', !s.has(8, 0, 4));
  check(
    'the boundary is a sphere, not the bounding box',
    !s.has(6, 0, 6),
    'a corner at ~2.83 cells should fall outside radius 2.5',
  );
}

// ── Line of sight ──────────────────────────────────────────────────────────
//
// Explored must mean "a source could see it", matching the live view. Marking
// by range alone put memory on ground that was near but out of sight.

console.log('\nline of sight');

{
  const mask = emptyMask();
  // A full-height wall column at x=5, so nothing behind it is reachable.
  for (let y = 0; y < 4; y++) solidAt(mask, 5, y, 4);
  const src = source(2.5, 0.5, 4.5, 6);

  const s = sink();
  markExploredCells(
    src.pos,
    [src],
    6,
    CELL_SIZE,
    windowOf(mask),
    s.isExplored,
    s.mark,
  );
  check(
    'a cell directly behind a wall is not remembered',
    !s.has(7, 0, 4),
    'the column at x=5 blocks it',
  );
  check('but a cell with a clear line is', s.has(2, 0, 7));
  check(
    'and the wall cell itself is, since the ray reaches it',
    s.has(5, 0, 4),
  );

  const ranged = sink();
  markExploredCells(
    src.pos,
    [src],
    6,
    CELL_SIZE,
    windowOf(mask),
    ranged.isExplored,
    ranged.mark,
    false,
  );
  check(
    'with the range-only escape hatch, the blocked cell IS remembered',
    ranged.has(7, 0, 4),
  );
}

{
  // A cell only a SECOND source can see must still be explored -- the shader
  // unions over sources, so marking must too.
  const mask = emptyMask();
  for (let y = 0; y < 4; y++) solidAt(mask, 5, y, 4);
  const near = source(2.5, 0.5, 4.5, 6);
  const behind = source(8.5, 0.5, 4.5, 6);
  const s = sink();
  markExploredCells(
    near.pos,
    [near, behind],
    6,
    CELL_SIZE,
    windowOf(mask),
    s.isExplored,
    s.mark,
  );
  check(
    'a cell hidden from one source but seen by another is remembered',
    s.has(7, 0, 4),
  );
}

// ── Off-window marking ─────────────────────────────────────────────────────
//
// Both DDAs fail OPEN once a ray leaves the solidity volume, so terrain in
// range but not yet resident is treated as visible rather than hidden. Hiding
// it on an unanswerable question is what left ground permanently black.

console.log('\noff-window marking');

{
  const s = sink();
  const src = source(-100.5, 0.5, -100.5, 1.5);
  markExploredCells(
    src.pos,
    [src],
    1.5,
    CELL_SIZE,
    windowOf(emptyMask()),
    s.isExplored,
    s.mark,
  );
  check(
    'cells far outside the resident window are still explored',
    s.has(-101, 0, -101),
  );
  check('negative coordinates floor correctly', s.has(-102, 0, -101));
}

// ── Idempotence ────────────────────────────────────────────────────────────

console.log('\nidempotence');

{
  const mask = emptyMask();
  const src = source(4.5, 0.5, 4.5, 2.5);
  const s = sink();
  const sweep = (): void =>
    markExploredCells(
      src.pos,
      [src],
      2.5,
      CELL_SIZE,
      windowOf(mask),
      s.isExplored,
      s.mark,
    );

  sweep();
  const firstPass = s.marked.size;
  const readsAfterFirst = s.reads;
  sweep();

  check(
    're-sweeping the same spot marks nothing new',
    s.marked.size === firstPass,
    `${firstPass} -> ${s.marked.size}`,
  );
  check(
    // Exactly one read per cell in range and no rays at all -- this is what
    // makes a per-cell raycast sweep affordable at a per-cell throttle.
    'and costs exactly one explored read per cell in range',
    s.reads - readsAfterFirst === firstPass,
    `${s.reads - readsAfterFirst} reads for ${firstPass} cells`,
  );
}

// ── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
