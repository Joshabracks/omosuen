/**
 * Parity test for the render WASM solidity map.
 *
 * Run: npm run test:wasm
 *
 * Compiles the crate (build-tools/wasm.mjs), injects the bytes into the single
 * `computeSolidityMap` (no JS twin), and checks the output against an
 * INDEPENDENT expected map computed from the source cells at generation time —
 * so this validates the real pack → compress → WASM pipeline, not JS-vs-JS.
 */
import { Array3D, Array3Dc, Vector3D } from '../src/math';
import { packCell } from '../src/component/cell-map/types';
import { initRenderWasm } from '../src/wasm/render';
import { computeSolidityMap } from '../src/component/camera/render/visibility-mask';
import { buildRenderWasm } from '../build-tools/wasm.mjs';

// Deterministic RNG (mulberry32) for reproducible cases.
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Builds a random packed cell-map AND the independent expected solidity map
 * (solid = visible && shapeIndex !== 0), straight from the source cell values.
 */
function makeCase(
  size: Vector3D,
  rng: () => number,
  solidProbability: number,
): { packed: Array3Dc<number>; expected: Uint8Array } {
  const arr = new Array3D<number>(size);
  const expected = new Uint8Array(size.x * size.y * size.z);
  arr.forEach((_v, _x, _y, _z, i) => {
    const visible = rng() < 0.75;
    const shapeIndex = rng() < solidProbability ? 1 + Math.floor(rng() * 4) : 0;
    arr.indexSet(
      i,
      packCell({
        materialIndex: Math.floor(rng() * 4096),
        shapeIndex,
        emissionIntensity: Math.floor(rng() * 32),
        visible,
      }),
    );
    expected[i] = visible && shapeIndex !== 0 ? 255 : 0;
  });
  return { packed: new Array3Dc(arr, 0.05), expected };
}

function assertEqual(a: Uint8Array, b: Uint8Array, label: string): void {
  if (a.length !== b.length) {
    throw new Error(`${label}: length mismatch ${a.length} !== ${b.length}`);
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      throw new Error(`${label}: byte ${i} mismatch expected=${b[i]} wasm=${a[i]}`);
    }
  }
}

async function main(): Promise<void> {
  // Compile the crate and inject the bytes (DefinePlugin globals only exist in
  // webpack builds; here we feed initRenderWasm directly).
  await initRenderWasm(buildRenderWasm());

  const cases: { size: Vector3D; solid: number; seed: number }[] = [
    { size: new Vector3D(8, 8, 8), solid: 0.5, seed: 1 },
    { size: new Vector3D(16, 16, 16), solid: 0.5, seed: 2 },
    { size: new Vector3D(32, 8, 24), solid: 0.3, seed: 3 },
    { size: new Vector3D(64, 4, 64), solid: 0.8, seed: 4 },
    { size: new Vector3D(10, 10, 10), solid: 0.0, seed: 5 }, // all air
    { size: new Vector3D(10, 10, 10), solid: 1.0, seed: 6 }, // all solid
    { size: new Vector3D(1, 1, 1), solid: 0.5, seed: 7 }, // minimal
    { size: new Vector3D(48, 48, 12), solid: 0.5, seed: 8 }, // grows buffer
  ];

  let passed = 0;
  for (const c of cases) {
    const { packed, expected } = makeCase(c.size, makeRng(c.seed), c.solid);
    // Copy the reused WASM view immediately (it is overwritten on the next call).
    const wasm = Uint8Array.from(computeSolidityMap(packed, c.size));
    const label = `[${c.size.x}x${c.size.y}x${c.size.z} solid=${c.solid}]`;
    assertEqual(wasm, expected, label);
    const solidCount = wasm.reduce((n, v) => n + (v === 255 ? 1 : 0), 0);
    console.log(`  ✓ ${label} ${wasm.length} cells, ${solidCount} solid`);
    passed++;
  }

  // Re-run a small map after a larger one to exercise view reuse after growth.
  {
    const size = new Vector3D(8, 8, 8);
    const { packed, expected } = makeCase(size, makeRng(99), 0.5);
    const wasm = Uint8Array.from(computeSolidityMap(packed, size));
    assertEqual(wasm, expected, '[reuse-after-grow 8x8x8]');
    console.log('  ✓ [reuse-after-grow 8x8x8]');
    passed++;
  }

  console.log(`\nWASM solidity parity: ${passed} cases PASSED ✓`);
}

main().catch((e) => {
  console.error('\nWASM solidity parity FAILED ✗');
  console.error(e);
  process.exit(1);
});
