/**
 * Fog-of-war explored-map export / import.
 *
 * Exercises the codec (explored-state.ts) and the AuxiliaryChannel walk / merge
 * it rides on, with no WebGL, WASM or component registry. The cell-map methods
 * on top are a thin loop over exactly these calls, mirrored here as
 * `exportChannel` / `importChannel`.
 *
 * Run: npx tsx test/explored-state.test.ts
 */

import { AuxiliaryChannel } from '../src/component/cell-map/auxiliary-channel';
import {
  decodeExploredChunk,
  encodeExploredChunk,
  isExploredChunkEntry,
  isExploredState,
  type ExploredState,
} from '../src/component/cell-map/explored-state';

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

/** Deterministic PRNG so a failure reproduces. */
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Codec ──────────────────────────────────────────────────────────────────

console.log('codec');

const COUNT = 4 * 4 * 4;

function roundTrips(cells: Uint32Array): boolean {
  const data = JSON.parse(
    JSON.stringify(encodeExploredChunk(cells, cells.length)),
  ) as unknown;
  const out = new Uint32Array(cells.length).fill(7);
  if (!decodeExploredChunk(data, out)) return false;
  for (let i = 0; i < cells.length; i++) {
    if (out[i] !== (cells[i] !== 0 ? 1 : 0)) return false;
  }
  return true;
}

{
  const empty = new Uint32Array(COUNT);
  const full = new Uint32Array(COUNT).fill(1);
  const single = new Uint32Array(COUNT);
  single[37] = 1;
  const first = new Uint32Array(COUNT);
  first[0] = 1;
  const last = new Uint32Array(COUNT);
  last[COUNT - 1] = 1;
  const checker = new Uint32Array(COUNT);
  for (let i = 0; i < COUNT; i += 2) checker[i] = 1;

  check('empty round-trips', roundTrips(empty));
  check('full round-trips', roundTrips(full));
  check('single cell round-trips', roundTrips(single));
  check('first cell round-trips', roundTrips(first));
  check('last cell round-trips', roundTrips(last));
  check('checkerboard round-trips', roundTrips(checker));

  const fullData = encodeExploredChunk(full, COUNT);
  check(
    'full chunk is the run list [0, N]',
    Array.isArray(fullData) &&
      fullData.length === 2 &&
      fullData[0] === 0 &&
      fullData[1] === COUNT,
    JSON.stringify(fullData),
  );
  check(
    'ragged chunk falls back to a bit mask',
    typeof encodeExploredChunk(checker, COUNT) === 'string',
  );
  check(
    'the chosen form is never longer than the bit mask',
    JSON.stringify(encodeExploredChunk(single, COUNT)).length <=
      Math.ceil(COUNT / 8 / 3) * 4 + 2,
  );

  const random = mulberry(11);
  let allRandom = true;
  for (let round = 0; round < 200; round++) {
    // Odd sizes too, so the last mask byte is partial.
    const n = 1 + Math.floor(random() * 300);
    const density = random();
    const cells = new Uint32Array(n);
    for (let i = 0; i < n; i++) cells[i] = random() < density ? 1 : 0;
    if (!roundTrips(cells)) allRandom = false;
  }
  check('200 random chunks of assorted sizes round-trip', allRandom);

  const out = new Uint32Array(COUNT);
  check('runs summing short are rejected', !decodeExploredChunk([3, 5], out));
  check(
    'runs summing long are rejected',
    !decodeExploredChunk([0, COUNT + 1], out),
  );
  check(
    'a negative run is rejected',
    !decodeExploredChunk([-1, COUNT + 1], out),
  );
  check('a wrong-length mask is rejected', !decodeExploredChunk('AAAA', out));
  check('non-base64 text is rejected', !decodeExploredChunk('***', out));
  check('a non-array is rejected', !decodeExploredChunk({ a: 1 }, out));

  check(
    'isExploredState accepts a snapshot',
    isExploredState({ version: 1, chunkSize: { x: 4, y: 4, z: 4 }, chunks: [] }),
  );
  check('isExploredState rejects null', !isExploredState(null));
  check(
    'isExploredState rejects another version',
    !isExploredState({ version: 2, chunkSize: { x: 4, y: 4, z: 4 }, chunks: [] }),
  );
  check(
    'isExploredState rejects a zero chunk size',
    !isExploredState({ version: 1, chunkSize: { x: 0, y: 4, z: 4 }, chunks: [] }),
  );
  check(
    'isExploredChunkEntry rejects a short entry',
    !isExploredChunkEntry([1, 2, [0, 64]]),
  );
}

// ── Channel fixture ────────────────────────────────────────────────────────

const CHUNK = { x: 4, y: 4, z: 4 };
const GRID = { x: 3, y: 2, z: 3 };
const CELLS = {
  x: GRID.x * CHUNK.x,
  y: GRID.y * CHUNK.y,
  z: GRID.z * CHUNK.z,
};

interface Rig {
  channel: AuxiliaryChannel;
  origin: { cx: number; cy: number; cz: number } | null;
}

function makeRig(chunkSize = CHUNK, cellDims = CELLS): Rig {
  return {
    channel: new AuxiliaryChannel({
      chunkSize,
      baselineValue: 0,
      trackDivergence: true,
      toroidal: true,
      initialCellDims: cellDims,
    }),
    origin: null,
  };
}

function moveTo(
  rig: Rig,
  cx: number,
  cy: number,
  cz: number,
  grid = GRID,
  chunkSize = CHUNK,
): void {
  const dims = {
    x: grid.x * chunkSize.x,
    y: grid.y * chunkSize.y,
    z: grid.z * chunkSize.z,
  };
  const next = { cx, cy, cz };
  rig.channel.onWindowChange(
    { origin: rig.origin, gridDims: grid, cellDims: dims },
    { origin: next, gridDims: grid, cellDims: dims },
  );
  rig.origin = next;
}

/** `CellWindow.worldToLocal` for the rig's window. */
function localOf(
  rig: Rig,
  wx: number,
  wy: number,
  wz: number,
  grid = GRID,
  chunkSize = CHUNK,
): { x: number; y: number; z: number } | null {
  if (!rig.origin) return null;
  const lx = wx - rig.origin.cx * chunkSize.x;
  const ly = wy - rig.origin.cy * chunkSize.y;
  const lz = wz - rig.origin.cz * chunkSize.z;
  if (
    lx < 0 ||
    ly < 0 ||
    lz < 0 ||
    lx >= grid.x * chunkSize.x ||
    ly >= grid.y * chunkSize.y ||
    lz >= grid.z * chunkSize.z
  ) {
    return null;
  }
  return { x: lx, y: ly, z: lz };
}

function mark(rig: Rig, wx: number, wy: number, wz: number): void {
  rig.channel.set(wx, wy, wz, localOf(rig, wx, wy, wz), 1);
}

function read(
  rig: Rig,
  wx: number,
  wy: number,
  wz: number,
  grid = GRID,
  chunkSize = CHUNK,
): number {
  return rig.channel.get(wx, wy, wz, localOf(rig, wx, wy, wz, grid, chunkSize));
}

function exportChannel(rig: Rig, chunkSize = CHUNK): ExploredState {
  const count = chunkSize.x * chunkSize.y * chunkSize.z;
  const chunks: ExploredState['chunks'] = [];
  rig.channel.forEachDivergedChunk((cx, cy, cz, cells) => {
    chunks.push([cx, cy, cz, encodeExploredChunk(cells, count)]);
  });
  return { version: 1, chunkSize: { ...chunkSize }, chunks };
}

const orExplored = (a: number, b: number): number =>
  a !== 0 || b !== 0 ? 1 : 0;

function importChannel(rig: Rig, state: ExploredState): boolean {
  const { x, y, z } = state.chunkSize;
  const cells = new Uint32Array(x * y * z);
  let residentChanged = false;
  for (const [cx, cy, cz, data] of state.chunks) {
    if (!decodeExploredChunk(data, cells)) throw new Error('bad chunk');
    if (rig.channel.mergeChunk(cx, cy, cz, cells, orExplored)) {
      residentChanged = true;
    }
  }
  return residentChanged;
}

// World-cell region every comparison sweeps: comfortably wider than every
// window used below, negative coordinates included.
const LO = { x: -24, y: -4, z: -24 };
const HI = { x: 40, y: 12, z: 40 };

function sameEverywhere(
  a: Rig,
  b: Rig,
  expected?: Set<string>,
): { same: boolean; marked: number } {
  let same = true;
  let marked = 0;
  for (let z = LO.z; z < HI.z; z++) {
    for (let y = LO.y; y < HI.y; y++) {
      for (let x = LO.x; x < HI.x; x++) {
        const va = read(a, x, y, z);
        if (va !== read(b, x, y, z)) same = false;
        if (expected && (va === 1) !== expected.has(`${x},${y},${z}`)) {
          same = false;
        }
        if (va === 1) marked++;
      }
    }
  }
  return { same, marked };
}

/**
 * A source rig with explored cells in three places at once: the resident
 * window, cold storage via eviction, and cold storage via an off-window write.
 */
function exploredSource(): { rig: Rig; expected: Set<string> } {
  const rig = makeRig();
  const expected = new Set<string>();
  const random = mulberry(5);
  const put = (x: number, y: number, z: number): void => {
    mark(rig, x, y, z);
    expected.add(`${x},${y},${z}`);
  };
  moveTo(rig, 0, 0, 0);
  // A solid block and some scatter inside the first window.
  for (let z = 0; z < 6; z++) {
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 7; x++) put(x, y, z);
    }
  }
  for (let i = 0; i < 120; i++) {
    put(
      Math.floor(random() * CELLS.x),
      Math.floor(random() * CELLS.y),
      Math.floor(random() * CELLS.z),
    );
  }
  // Off-window writes, straight into cold storage -- negative chunks too.
  for (let i = 0; i < 60; i++) {
    put(
      -20 + Math.floor(random() * 8),
      Math.floor(random() * 8),
      -20 + Math.floor(random() * 8),
    );
  }
  // Shift so the first window's far side evicts, then explore the new ground.
  moveTo(rig, 2, 0, 1);
  for (let i = 0; i < 80; i++) {
    put(
      8 + Math.floor(random() * CELLS.x),
      Math.floor(random() * CELLS.y),
      4 + Math.floor(random() * CELLS.z),
    );
  }
  return { rig, expected };
}

// ── Export / import ────────────────────────────────────────────────────────

console.log('export / import');

{
  const { rig: source, expected } = exploredSource();
  const selfCheck = sameEverywhere(source, source, expected);
  check(
    'fixture holds exactly the cells it marked',
    selfCheck.same && selfCheck.marked === expected.size,
    `${selfCheck.marked} read vs ${expected.size} marked`,
  );
  check(
    'fixture spans resident and cold storage',
    source.channel.coldStorage.size > 0 && read(source, 9, 0, 5) === 1,
  );

  const state = JSON.parse(
    JSON.stringify(exportChannel(source)),
  ) as ExploredState;
  check('export passes isExploredState', isExploredState(state));

  let exportedCells = 0;
  const scratch = new Uint32Array(CHUNK.x * CHUNK.y * CHUNK.z);
  const seenChunks = new Set<string>();
  let duplicateChunk = false;
  for (const [cx, cy, cz, data] of state.chunks) {
    const key = `${cx},${cy},${cz}`;
    if (seenChunks.has(key)) duplicateChunk = true;
    seenChunks.add(key);
    decodeExploredChunk(data, scratch);
    for (const v of scratch) exportedCells += v;
  }
  check('each chunk is exported once', !duplicateChunk);
  check(
    'export carries exactly the explored cells',
    exportedCells === expected.size,
    `${exportedCells} vs ${expected.size}`,
  );

  // 1. A fresh map whose window sits somewhere else entirely.
  const elsewhere = makeRig();
  moveTo(elsewhere, -5, 0, -5);
  importChannel(elsewhere, state);
  check(
    'import into a window elsewhere reproduces every cell',
    sameEverywhere(source, elsewhere, expected).same,
  );
  moveTo(elsewhere, 0, 0, 0);
  check(
    '... and still does once the window moves onto the imported ground',
    sameEverywhere(source, elsewhere, expected).same,
  );

  // 2. A fresh map at the same window: chunks land in the resident buffer.
  const inPlace = makeRig();
  moveTo(inPlace, 2, 0, 1);
  check(
    'import over the resident window reports a resident change',
    importChannel(inPlace, state),
  );
  check(
    'import over the resident window reproduces every cell',
    sameEverywhere(source, inPlace, expected).same,
  );
  check(
    'importing the same snapshot again changes nothing',
    !importChannel(inPlace, state) &&
      sameEverywhere(source, inPlace, expected).same,
  );
  moveTo(inPlace, 9, 0, 9);
  moveTo(inPlace, 0, 0, 0);
  check(
    'imported resident chunks survive eviction and return',
    sameEverywhere(source, inPlace, expected).same,
  );

  // 3. Before the window has committed at all.
  const early = makeRig();
  importChannel(early, state);
  check(
    'import before the first window commit is readable immediately',
    sameEverywhere(source, early, expected).same,
  );
  moveTo(early, 1, 0, 0);
  check(
    '... and survives the first commit',
    sameEverywhere(source, early, expected).same,
  );

  // 4. Re-exporting the restored map gives the same cells back.
  const again = makeRig();
  moveTo(again, 4, 0, 4);
  importChannel(again, exportChannel(early));
  check(
    'export -> import -> export -> import is stable',
    sameEverywhere(source, again, expected).same,
  );
}

console.log('merge / reset');

{
  const { rig: source, expected } = exploredSource();
  const state = exportChannel(source);

  const target = makeRig();
  moveTo(target, 0, 0, 0);
  const own = new Set<string>(expected);
  // Ground the target already explored, in-window and off-window, none of it
  // in the snapshot's own cells necessarily.
  for (const [x, y, z] of [
    [11, 7, 11],
    [0, 0, 0],
    [30, 2, 30],
    [-9, 1, -9],
  ]) {
    mark(target, x, y, z);
    own.add(`${x},${y},${z}`);
  }
  importChannel(target, state);
  check(
    'import keeps ground that was already explored',
    sameEverywhere(target, target, own).same,
  );

  target.channel.reset();
  check(
    'reset forgets everything, resident and cold',
    sameEverywhere(target, target, new Set()).same &&
      target.channel.coldStorage.size === 0 &&
      target.channel.isEntirelyBaseline,
  );
  importChannel(target, state);
  check(
    'reset then import restores exactly the snapshot',
    sameEverywhere(source, target, expected).same,
  );

  const blank = makeRig();
  moveTo(blank, 0, 0, 0);
  check(
    'an untouched map exports no chunks',
    exportChannel(blank).chunks.length === 0,
  );
}

console.log('different chunk size');

{
  // The cell-map's fallback when a save's chunk size differs: decode with the
  // SAVED chunk size and place each explored cell by world coordinate.
  const { rig: source, expected } = exploredSource();
  const state = exportChannel(source);

  const bigChunk = { x: 8, y: 8, z: 8 };
  const bigGrid = { x: 2, y: 1, z: 2 };
  const bigDims = { x: 16, y: 8, z: 16 };
  const target = makeRig(bigChunk, bigDims);
  moveTo(target, 0, 0, 0, bigGrid, bigChunk);

  const from = state.chunkSize;
  const cells = new Uint32Array(from.x * from.y * from.z);
  for (const [cx, cy, cz, data] of state.chunks) {
    decodeExploredChunk(data, cells);
    let i = 0;
    for (let lz = 0; lz < from.z; lz++) {
      for (let ly = 0; ly < from.y; ly++) {
        for (let lx = 0; lx < from.x; lx++, i++) {
          if (cells[i] === 0) continue;
          const wx = cx * from.x + lx;
          const wy = cy * from.y + ly;
          const wz = cz * from.z + lz;
          target.channel.set(
            wx,
            wy,
            wz,
            localOf(target, wx, wy, wz, bigGrid, bigChunk),
            1,
          );
        }
      }
    }
  }

  let same = true;
  for (let z = LO.z; z < HI.z; z++) {
    for (let y = LO.y; y < HI.y; y++) {
      for (let x = LO.x; x < HI.x; x++) {
        const got = read(target, x, y, z, bigGrid, bigChunk);
        if ((got === 1) !== expected.has(`${x},${y},${z}`)) same = false;
      }
    }
  }
  check('a snapshot loads into a map with a different chunk size', same);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
