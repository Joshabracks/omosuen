/**
 * Parity test for the render WASM solidity map (step 1, now reading the
 * canonical store). Run: npm run test:wasm
 *
 * Loads random packed maps into the canonical store and checks computeSolidityMap
 * (WASM) against an independent expected map computed from the source cells.
 */
import { Vector3D, Array3D } from '../src/math';
import { packCell } from '../src/component/cell-map/types';
import {
  initRenderWasm,
  loadCellStore,
  cellStoreSet,
  cellStoreFlush,
} from '../src/component/camera/render/wasm';
import { computeSolidityMap } from '../src/component/camera/render/visibility-mask';
import { buildRenderWasm } from '../build-tools/wasm.mjs';

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCase(
  size: Vector3D,
  rng: () => number,
  solidProbability: number,
): { flat: Array3D<number>; expected: Uint8Array } {
  const flat = new Array3D<number>(size);
  const expected = new Uint8Array(size.x * size.y * size.z);
  flat.forEach((_v, _x, _y, _z, i) => {
    const visible = rng() < 0.75;
    const shapeIndex = rng() < solidProbability ? 1 + Math.floor(rng() * 4) : 0;
    flat.indexSet(
      i,
      packCell({
        materialIndex: Math.floor(rng() * 4096),
        shapeIndex,
        emissionIntensity: Math.floor(rng() * 32),
        visible,
        // Randomised, and deliberately ABSENT from `expected` below: this flag
        // culls neighbouring faces at mesh time and must have no effect on
        // solidity whatsoever. If it ever leaked in, line of sight, pathing and
        // the fog raycasts would all shift at once -- so the oracle ignoring it
        // is the assertion.
        cullsNeighborFaces: rng() < 0.5,
      }),
    );
    expected[i] = visible && shapeIndex !== 0 ? 255 : 0;
  });
  return { flat, expected };
}

function assertEqual(a: Uint8Array, b: Uint8Array, label: string): void {
  if (a.length !== b.length) {
    throw new Error(`${label}: length ${a.length} (wasm) vs ${b.length}`);
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      throw new Error(`${label}: byte ${i} wasm=${a[i]} expected=${b[i]}`);
    }
  }
}

async function main(): Promise<void> {
  await initRenderWasm(buildRenderWasm());

  const cases: { size: Vector3D; solid: number; seed: number }[] = [
    { size: new Vector3D(8, 8, 8), solid: 0.5, seed: 1 },
    { size: new Vector3D(16, 16, 16), solid: 0.5, seed: 2 },
    { size: new Vector3D(32, 8, 24), solid: 0.3, seed: 3 },
    { size: new Vector3D(64, 4, 64), solid: 0.8, seed: 4 },
    { size: new Vector3D(10, 10, 10), solid: 0.0, seed: 5 },
    { size: new Vector3D(10, 10, 10), solid: 1.0, seed: 6 },
    { size: new Vector3D(1, 1, 1), solid: 0.5, seed: 7 },
    { size: new Vector3D(48, 48, 12), solid: 0.5, seed: 8 },
  ];

  let passed = 0;
  for (const c of cases) {
    const { flat, expected } = makeCase(c.size, makeRng(c.seed), c.solid);
    const total = c.size.x * c.size.y * c.size.z;
    loadCellStore(flat.value, total, c.size.x, c.size.y, c.size.z);
    const wasm = Uint8Array.from(computeSolidityMap());
    const label = `[${c.size.x}x${c.size.y}x${c.size.z} solid=${c.solid}]`;
    assertEqual(wasm, expected, label);
    const solidCount = wasm.reduce((n, v) => n + (v === 255 ? 1 : 0), 0);
    console.log(`  ✓ ${label} ${wasm.length} cells, ${solidCount} solid`);
    passed++;
  }

  // Reuse-after-grow: smaller map after a larger one.
  {
    const size = new Vector3D(8, 8, 8);
    const { flat, expected } = makeCase(size, makeRng(99), 0.5);
    loadCellStore(flat.value, size.x * size.y * size.z, size.x, size.y, size.z);
    const wasm = Uint8Array.from(computeSolidityMap());
    assertEqual(wasm, expected, '[reuse-after-grow 8x8x8]');
    console.log('  ✓ [reuse-after-grow 8x8x8]');
    passed++;
  }

  // Cache invalidation: the solidity map is cached and only recomputed when a
  // cell changes, and it is read more than once per frame (render pass +
  // fog-of-war). A stale-cache bug is invisible to every case above -- they all
  // load a fresh map and read it once -- so drive the mutate-then-reread path
  // explicitly: flip cells with cellStoreSet BETWEEN two computeSolidityMap()
  // calls and require the second result to reflect the writes. Covers both the
  // in-place patch path and the post-flush rebuild path.
  {
    const size = new Vector3D(16, 12, 16);
    const total = size.x * size.y * size.z;
    const { flat, expected } = makeCase(size, makeRng(1234), 0.5);
    loadCellStore(flat.value, total, size.x, size.y, size.z);

    const first = Uint8Array.from(computeSolidityMap());
    assertEqual(first, expected, '[mutate-reread: initial]');

    // Toggle a deterministic scattered subset, tracking the expectation.
    const rng = makeRng(4321);
    const solidPacked = packCell({
      materialIndex: 7,
      shapeIndex: 3,
      emissionIntensity: 0,
      visible: true,
    });
    const airPacked = packCell({
      materialIndex: 0,
      shapeIndex: 0,
      emissionIntensity: 0,
      visible: true,
    });
    let writes = 0;
    for (let i = 0; i < total; i++) {
      if (rng() >= 0.02) continue;
      const x = i % size.x;
      const y = Math.floor(i / size.x) % size.y;
      const z = Math.floor(i / (size.x * size.y));
      // Index order must match the store's: z*my*mx + y*mx + x.
      const idx = z * size.y * size.x + y * size.x + x;
      const makeSolid = rng() < 0.5;
      cellStoreSet(x, y, z, makeSolid ? solidPacked : airPacked);
      expected[idx] = makeSolid ? 255 : 0;
      writes++;
    }

    const second = Uint8Array.from(computeSolidityMap());
    assertEqual(second, expected, '[mutate-reread: after sets]');

    // Same again across an explicit flush (recompresses the RLE store without
    // changing cell contents -- the cache must survive it, still correct).
    cellStoreFlush();
    const third = Uint8Array.from(computeSolidityMap());
    assertEqual(third, expected, '[mutate-reread: after flush]');

    // And a repeat read with no writes in between must be identical (the
    // cache-hit path itself returning the right buffer).
    const fourth = Uint8Array.from(computeSolidityMap());
    assertEqual(fourth, expected, '[mutate-reread: cached reread]');

    console.log(
      `  ✓ [mutate-reread 16x12x16] ${writes} cell writes reflected across set/flush/cached rereads`,
    );
    passed++;
  }

  console.log(`\nWASM solidity parity: ${passed} cases PASSED ✓`);
}

main().catch((e) => {
  console.error('\nWASM solidity parity FAILED ✗');
  console.error(e);
  process.exit(1);
});
