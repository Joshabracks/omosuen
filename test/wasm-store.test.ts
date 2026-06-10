/**
 * Round-trip test for the WASM canonical RLE cell store (step 3).
 *
 * Run: npm run test:wasm-store
 *
 * Validates store_load / get / set / flush / dump against an independent plain-
 * array oracle: bulk-load then verify every cell, mutate enough to cross the
 * flush threshold, then verify reads and the flat dump again.
 */
import { initRenderWasm } from '../src/component/camera/render/wasm';
import {
  loadCellStore,
  cellStoreGet,
  cellStoreSet,
  cellStoreFlush,
  cellStoreDump,
} from '../src/component/camera/render/wasm';
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

interface Dims {
  x: number;
  y: number;
  z: number;
}

function idx(d: Dims, x: number, y: number, z: number): number {
  return z * d.y * d.x + y * d.x + x;
}

function verifyAll(d: Dims, oracle: Uint32Array, label: string): void {
  // Per-coordinate get
  for (let z = 0; z < d.z; z++) {
    for (let y = 0; y < d.y; y++) {
      for (let x = 0; x < d.x; x++) {
        const got = cellStoreGet(x, y, z);
        const exp = oracle[idx(d, x, y, z)];
        if (got !== exp) {
          throw new Error(
            `${label}: get(${x},${y},${z})=${got} expected ${exp}`,
          );
        }
      }
    }
  }
  // Flat dump
  const dump = cellStoreDump();
  if (dump.length !== oracle.length) {
    throw new Error(
      `${label}: dump length ${dump.length} expected ${oracle.length}`,
    );
  }
  for (let i = 0; i < oracle.length; i++) {
    if (dump[i] !== oracle[i]) {
      throw new Error(`${label}: dump[${i}]=${dump[i]} expected ${oracle[i]}`);
    }
  }
}

function runCase(d: Dims, seed: number, distinct: number): void {
  const rng = makeRng(seed);
  const total = d.x * d.y * d.z;
  const oracle = new Uint32Array(total);
  for (let i = 0; i < total; i++) {
    // Limited distinct values → produces real RLE runs.
    oracle[i] = Math.floor(rng() * distinct);
  }

  loadCellStore(oracle, total, d.x, d.y, d.z);
  verifyAll(d, oracle, `seed${seed} after load`);

  // Mutate ~8% of cells (crosses the 5% flush threshold during the loop).
  const edits = Math.max(1, Math.floor(total * 0.08));
  for (let e = 0; e < edits; e++) {
    const x = Math.floor(rng() * d.x);
    const y = Math.floor(rng() * d.y);
    const z = Math.floor(rng() * d.z);
    const v = Math.floor(rng() * distinct) + 100; // distinct from base values
    cellStoreSet(x, y, z, v);
    oracle[idx(d, x, y, z)] = v;
  }
  verifyAll(d, oracle, `seed${seed} after edits`);

  cellStoreFlush();
  verifyAll(d, oracle, `seed${seed} after flush`);
}

async function main(): Promise<void> {
  await initRenderWasm(buildRenderWasm());

  const cases: { d: Dims; seed: number; distinct: number }[] = [
    { d: { x: 8, y: 8, z: 8 }, seed: 1, distinct: 4 },
    { d: { x: 16, y: 16, z: 16 }, seed: 2, distinct: 2 }, // big runs
    { d: { x: 20, y: 7, z: 13 }, seed: 3, distinct: 64 }, // few runs
    { d: { x: 1, y: 1, z: 1 }, seed: 4, distinct: 4 }, // minimal
    { d: { x: 32, y: 4, z: 4 }, seed: 5, distinct: 1 }, // single value
  ];

  for (const c of cases) {
    runCase(c.d, c.seed, c.distinct);
    console.log(
      `  ✓ seed${c.seed} [${c.d.x}x${c.d.y}x${c.d.z}] distinct=${c.distinct} — load/get/set/flush/dump OK`,
    );
  }

  console.log(`\nWASM cell store round-trip: ${cases.length} cases PASSED ✓`);
}

main().catch((e) => {
  console.error('\nWASM cell store round-trip FAILED ✗');
  console.error(e);
  process.exit(1);
});
