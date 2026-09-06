/**
 * Screen picking against a SHIFTED streaming window.
 *
 * Drives `marchCells` directly against a fabricated cell-map -- no WebGL, no
 * WASM, no real CellWindow. Every case here pins the reason cell selection
 * highlighting only lit up one chunk at a time in a downstream game: the pick
 * traversal bounded itself by `[0, mapSize)` in world space, but `mapSize` is
 * the RESIDENT WINDOW's size and the window sits at `window.origin * chunkSize`.
 * Picking therefore only worked in the shrinking overlap between the fixed box
 * and the window's actual position.
 *
 * The invariant under test: a ray and the terrain under it, both translated by
 * the same window shift, must produce the same hits (translated to match).
 *
 * Run: npx tsx test/screen-pick-window.test.ts
 */

import { Vector3D } from '../src/math';
import { marchCells, makeCellMarch } from '../src/component/camera/screen-pick/intersect';
import type { CellMapT } from '../src/component/cell-map/data';
import { packCell } from '../src/component/cell-map/types';

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
// A 3x3x3-chunk window of 4-cell chunks = a 12x12x12-cell resident window.

const CELL_SIZE = { x: 1, y: 1, z: 1 };
const CHUNK_SIZE = { x: 4, y: 4, z: 4 };
const GRID_CHUNKS = 3;
const WINDOW_CELLS = CHUNK_SIZE.x * GRID_CHUNKS; // 12 per axis

/** Solid cells, as world "x,y,z" keys. */
type Terrain = Set<string>;

const key = (x: number, y: number, z: number): string => `${x},${y},${z}`;

/**
 * A cell-map-shaped stub exposing only what `marchCells` touches: `cellSize`,
 * `mapSize`, `chunkSize`, `window.origin`, and `window.queryCell`. Note the
 * stub's `queryCell` takes WORLD cell coordinates and consults world-keyed
 * terrain, exactly as the real `CellWindow` does -- so a test that passes here
 * is asserting the traversal addresses cells in world space.
 */
function makeCellMap(
  originChunk: { cx: number; cy: number; cz: number },
  terrain: Terrain,
): CellMapT {
  // Packed through the engine's own `packCell`, so the stub can't drift from
  // the layout `cellSolid` unpacks with.
  const SOLID = packCell({
    materialIndex: 1,
    shapeIndex: 1,
    emissionIntensity: 0,
    visible: true,
    cullsNeighborFaces: true,
  });
  const EMPTY = 0;
  return {
    cellSize: new Vector3D(CELL_SIZE.x, CELL_SIZE.y, CELL_SIZE.z),
    mapSize: new Vector3D(WINDOW_CELLS, WINDOW_CELLS, WINDOW_CELLS),
    chunkSize: new Vector3D(CHUNK_SIZE.x, CHUNK_SIZE.y, CHUNK_SIZE.z),
    window: {
      origin: originChunk,
      queryCell: (x: number, y: number, z: number): number =>
        terrain.has(key(x, y, z)) ? SOLID : EMPTY,
    },
  } as unknown as CellMapT;
}

const march = makeCellMarch();

/** Hits as world "x,y,z" keys, in near→far order. */
function marchKeys(cellMap: CellMapT, origin: Vector3D, dir: Vector3D): string[] {
  marchCells(origin, dir, cellMap, march, false);
  const out: string[] = [];
  for (let i = 0; i < march.count; i++) {
    out.push(key(march.x[i], march.y[i], march.z[i]));
  }
  return out;
}

// ── Cases ──────────────────────────────────────────────────────────────────

console.log('\nscreen-pick / shifted window\n');

// A flat floor at cell y=2 spanning the window's full x/z, plus one pillar cell
// sitting on it, all expressed relative to the window's own corner.
function buildTerrain(offX: number, offY: number, offZ: number): Terrain {
  const t: Terrain = new Set();
  for (let lx = 0; lx < WINDOW_CELLS; lx++) {
    for (let lz = 0; lz < WINDOW_CELLS; lz++) {
      t.add(key(offX + lx, offY + 2, offZ + lz));
    }
  }
  t.add(key(offX + 6, offY + 3, offZ + 6)); // pillar on the floor
  return t;
}

// The unshifted reference: window origin at chunk (0,0,0), so world == local
// and the old code path happened to be correct.
const baseTerrain = buildTerrain(0, 0, 0);
const baseMap = makeCellMap({ cx: 0, cy: 0, cz: 0 }, baseTerrain);

// A straight-down ray through the pillar column.
const downDir = new Vector3D(0, -1, 0);
const baseDown = marchKeys(
  baseMap,
  new Vector3D(6.5, WINDOW_CELLS + 5, 6.5),
  downDir,
);
check(
  'unshifted window: vertical ray hits pillar then floor, near→far',
  baseDown.join(' ') === '6,3,6 6,2,6',
  `got [${baseDown.join(' ')}]`,
);

// A diagonal ray, the shape a real axonometric camera actually casts -- it
// crosses several chunk boundaries on the way down.
const diagDir = new Vector3D(0.6, -1, 0.35);
const baseDiag = marchKeys(baseMap, new Vector3D(1.2, 11.5, 2.4), diagDir);
check(
  'unshifted window: diagonal ray hits the floor',
  baseDiag.length > 0,
  `got [${baseDiag.join(' ')}]`,
);

// ── The regression: shift the window and translate everything with it ──────
//
// Window origin at chunk (4,1,4) → world cell offset (16,4,16). Under the old
// `[0, mapSize)` bound this window overlapped the fixed box on only 8 of its 12
// cells per axis in x/z and 8 in y -- and pushing the origin past chunk 3 on
// any axis dropped that overlap to nothing.
const SHIFT_CHUNK = { cx: 4, cy: 1, cz: 4 };
const offX = SHIFT_CHUNK.cx * CHUNK_SIZE.x; // 16
const offY = SHIFT_CHUNK.cy * CHUNK_SIZE.y; // 4
const offZ = SHIFT_CHUNK.cz * CHUNK_SIZE.z; // 16

const shiftedMap = makeCellMap(SHIFT_CHUNK, buildTerrain(offX, offY, offZ));

function shiftKeys(keys: string[]): string[] {
  return keys.map((k) => {
    const [x, y, z] = k.split(',').map(Number);
    return key(x + offX, y + offY, z + offZ);
  });
}

const shiftedDown = marchKeys(
  shiftedMap,
  new Vector3D(6.5 + offX, WINDOW_CELLS + 5 + offY, 6.5 + offZ),
  downDir,
);
check(
  'shifted window: vertical ray returns the same hits, in world coordinates',
  shiftedDown.join(' ') === shiftKeys(baseDown).join(' '),
  `got [${shiftedDown.join(' ')}], want [${shiftKeys(baseDown).join(' ')}]`,
);

const shiftedDiag = marchKeys(
  shiftedMap,
  new Vector3D(1.2 + offX, 11.5 + offY, 2.4 + offZ),
  diagDir,
);
check(
  'shifted window: diagonal ray returns the same hits, in world coordinates',
  shiftedDiag.join(' ') === shiftKeys(baseDiag).join(' '),
  `got [${shiftedDiag.join(' ')}], want [${shiftKeys(baseDiag).join(' ')}]`,
);

// The reported symptom directly: sweep the whole window's footprint and count
// how many distinct chunks report a hit. Pre-fix this collapsed toward one.
function chunksHit(cellMap: CellMapT, ox: number, oy: number, oz: number): number {
  const seen = new Set<string>();
  for (let lx = 0; lx < WINDOW_CELLS; lx++) {
    for (let lz = 0; lz < WINDOW_CELLS; lz++) {
      const hits = marchKeys(
        cellMap,
        new Vector3D(ox + lx + 0.5, oy + WINDOW_CELLS + 5, oz + lz + 0.5),
        downDir,
      );
      if (hits.length === 0) continue;
      const [hx, hy, hz] = hits[0].split(',').map(Number);
      seen.add(
        key(
          Math.floor(hx / CHUNK_SIZE.x),
          Math.floor(hy / CHUNK_SIZE.y),
          Math.floor(hz / CHUNK_SIZE.z),
        ),
      );
    }
  }
  return seen.size;
}

const baseChunks = chunksHit(baseMap, 0, 0, 0);
const shiftedChunks = chunksHit(shiftedMap, offX, offY, offZ);
check(
  'shifted window: every chunk the unshifted window picked in is still picked in',
  shiftedChunks === baseChunks && baseChunks > 1,
  `shifted ${shiftedChunks} chunk(s), unshifted ${baseChunks}`,
);

// A window shifted far enough that it shares no cell at all with `[0, mapSize)`
// -- the case that used to return nothing whatsoever.
const FAR_CHUNK = { cx: 25, cy: 0, cz: 25 };
const farOffX = FAR_CHUNK.cx * CHUNK_SIZE.x;
const farOffZ = FAR_CHUNK.cz * CHUNK_SIZE.z;
const farMap = makeCellMap(FAR_CHUNK, buildTerrain(farOffX, 0, farOffZ));
const farDown = marchKeys(
  farMap,
  new Vector3D(6.5 + farOffX, WINDOW_CELLS + 5, 6.5 + farOffZ),
  downDir,
);
check(
  'window with zero overlap with the world origin still picks',
  farDown.join(' ') ===
    `${farOffX + 6},3,${farOffZ + 6} ${farOffX + 6},2,${farOffZ + 6}`,
  `got [${farDown.join(' ')}]`,
);

// A ray aimed where the window ISN'T must still miss -- the fix widens the
// addressable range to the window's real position, it does not remove the bound.
const outside = marchKeys(
  shiftedMap,
  new Vector3D(3.5, WINDOW_CELLS + 5 + offY, 3.5),
  downDir,
);
check(
  'shifted window: a ray outside the window misses',
  outside.length === 0,
  `got [${outside.join(' ')}]`,
);

// `stopAtFirst` must still return exactly the nearest hit.
marchCells(
  new Vector3D(6.5 + offX, WINDOW_CELLS + 5 + offY, 6.5 + offZ),
  downDir,
  shiftedMap,
  march,
  true,
);
check(
  'shifted window: stopAtFirst returns only the nearest hit',
  march.count === 1 && key(march.x[0], march.y[0], march.z[0]) === `${offX + 6},${offY + 3},${offZ + 6}`,
  `count ${march.count}`,
);

// ── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
