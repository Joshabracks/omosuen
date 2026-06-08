/**
 * Golden-snapshot regression test for the render WASM chunk mesher (greedy +
 * smoothed). Run: npm run test:wasm-mesh
 *
 * Parity vs the JS reference was proven during the port (step 2a/2b); the JS
 * mesher has since been deleted (single source of truth). This test pins the
 * WASM output for fixed seeds/configs via a content hash so future regressions
 * are caught. To re-baseline after an intentional mesh change, set GOLDENS = {}
 * and re-run — the test prints the captured hashes — then paste them back.
 */
import { Vector3D, Array3D } from '../src/math';
import { packCell, CHUNK_SIZE } from '../src/component/cell-map/types';
import {
  initRenderWasm,
  setMeshMap,
  setMeshSmoothing,
  buildChunkMeshWasm,
  buildChunkMeshSmoothedWasm,
  type ChunkMeshResult,
} from '../src/component/camera/render/wasm';
import { buildRenderWasm } from '../build-tools/wasm.mjs';

// Captured from the parity-proven WASM output. Keyed by case name.
const GOLDENS: Record<string, number> = {
  'g1-greedy': 4187842706,
  'g2-greedy-1mat': 2270217368,
  'g3-greedy-allsolid': 3524738704,
  'g4-greedy-allair': 520366341,
  's1-smooth-flat': 752222795,
  's2-smooth-fullnorm': 844660720,
  's3-smooth-lerp-randw': 2092834447,
  's4-smooth-multichunk': 22181084,
};

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fnv1a(h: number, bytes: Uint8Array): number {
  let hash = h;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function asBytes(
  view: Float32Array | Uint32Array,
): Uint8Array {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

function hashChunk(h: number, r: ChunkMeshResult): number {
  let hash = h;
  // Distinguish null vs empty and capture shape.
  const meta = new Uint32Array([
    r.vertices ? r.vertices.length : 0xffffffff,
    r.indices ? r.indices.length : 0xffffffff,
    r.ranges.length,
  ]);
  hash = fnv1a(hash, asBytes(meta));
  if (r.vertices) hash = fnv1a(hash, asBytes(r.vertices));
  if (r.indices) hash = fnv1a(hash, asBytes(r.indices));
  if (r.ranges.length > 0) {
    const rb = new Uint32Array(r.ranges.length * 3);
    for (let i = 0; i < r.ranges.length; i++) {
      rb[i * 3] = r.ranges[i].materialIndex;
      rb[i * 3 + 1] = r.ranges[i].indexOffset;
      rb[i * 3 + 2] = r.ranges[i].indexCount;
    }
    hash = fnv1a(hash, asBytes(rb));
  }
  return hash;
}

interface Case {
  name: string;
  size: Vector3D;
  cellSize: Vector3D;
  mats: number;
  solid: number;
  smoothing: number; // 0 = greedy
  normalSmoothing: number;
  randomWeights: boolean;
  seed: number;
}

function buildPacked(c: Case): Array3D<number> {
  const rng = makeRng(c.seed);
  const packed = new Array3D<number>(c.size);
  packed.forEach((_v, _x, _y, _z, i) => {
    const shapeIndex = rng() < c.solid ? 1 : 0;
    const materialIndex = Math.floor(rng() * c.mats);
    packed.indexSet(
      i,
      packCell({ materialIndex, shapeIndex, emissionIntensity: 0, visible: true }),
    );
  });
  return packed;
}

function buildWeights(c: Case): Array3D<number> {
  const rng = makeRng(c.seed ^ 0x9e3779b9);
  const weights = new Array3D<number>(c.size);
  weights.forEach((_v, _x, _y, _z, i) => {
    weights.indexSet(i, c.randomWeights ? Math.floor(rng() * 16) : 8);
  });
  return weights;
}

function chunkCoords(size: Vector3D): { cx: number; cy: number; cz: number }[] {
  const gx = Math.ceil(size.x / CHUNK_SIZE);
  const gy = Math.ceil(size.y / CHUNK_SIZE);
  const gz = Math.ceil(size.z / CHUNK_SIZE);
  const out: { cx: number; cy: number; cz: number }[] = [];
  for (let cz = 0; cz < gz; cz++) {
    for (let cy = 0; cy < gy; cy++) {
      for (let cx = 0; cx < gx; cx++) out.push({ cx, cy, cz });
    }
  }
  return out;
}

function caseHash(c: Case): number {
  const packed = buildPacked(c);
  const total = c.size.x * c.size.y * c.size.z;
  setMeshMap(
    packed.value,
    total,
    c.size.x,
    c.size.y,
    c.size.z,
    c.cellSize.x,
    c.cellSize.y,
    c.cellSize.z,
  );
  const smoothed = c.smoothing > 0;
  if (smoothed) {
    const weights = buildWeights(c);
    setMeshSmoothing(weights.value, total, c.smoothing, c.normalSmoothing);
  }

  let h = 0x811c9dc5;
  for (const { cx, cy, cz } of chunkCoords(c.size)) {
    const r = smoothed
      ? buildChunkMeshSmoothedWasm(cx, cy, cz)
      : buildChunkMeshWasm(cx, cy, cz);
    h = hashChunk(h, r);
  }
  return h;
}

async function main(): Promise<void> {
  await initRenderWasm(buildRenderWasm());

  const cases: Case[] = [
    { name: 'g1-greedy', size: new Vector3D(20, 18, 20), cellSize: new Vector3D(1, 0.5, 2), mats: 4, solid: 0.5, smoothing: 0, normalSmoothing: 0, randomWeights: false, seed: 1 },
    { name: 'g2-greedy-1mat', size: new Vector3D(16, 16, 16), cellSize: new Vector3D(1, 1, 1), mats: 1, solid: 0.5, smoothing: 0, normalSmoothing: 0, randomWeights: false, seed: 2 },
    { name: 'g3-greedy-allsolid', size: new Vector3D(18, 18, 18), cellSize: new Vector3D(1, 1, 1), mats: 3, solid: 1.0, smoothing: 0, normalSmoothing: 0, randomWeights: false, seed: 4 },
    { name: 'g4-greedy-allair', size: new Vector3D(18, 18, 18), cellSize: new Vector3D(1, 1, 1), mats: 3, solid: 0.0, smoothing: 0, normalSmoothing: 0, randomWeights: false, seed: 5 },
    { name: 's1-smooth-flat', size: new Vector3D(20, 18, 20), cellSize: new Vector3D(1, 0.5, 2), mats: 3, solid: 0.5, smoothing: 1, normalSmoothing: 0, randomWeights: false, seed: 1 },
    { name: 's2-smooth-fullnorm', size: new Vector3D(20, 18, 20), cellSize: new Vector3D(1, 1, 1), mats: 3, solid: 0.5, smoothing: 2, normalSmoothing: 1, randomWeights: false, seed: 2 },
    { name: 's3-smooth-lerp-randw', size: new Vector3D(24, 24, 8), cellSize: new Vector3D(1, 1, 1), mats: 4, solid: 0.6, smoothing: 4, normalSmoothing: 0.5, randomWeights: true, seed: 3 },
    { name: 's4-smooth-multichunk', size: new Vector3D(34, 10, 10), cellSize: new Vector3D(1, 1, 1), mats: 3, solid: 0.4, smoothing: 5, normalSmoothing: 0, randomWeights: true, seed: 6 },
  ];

  let failed = 0;
  let missing = 0;
  for (const c of cases) {
    const h = caseHash(c);
    const golden = GOLDENS[c.name];
    if (golden === undefined) {
      console.log(`  CAPTURE  '${c.name}': ${h},`);
      missing++;
    } else if (golden !== h) {
      console.error(`  ✗ ${c.name}: golden ${golden} !== ${h}`);
      failed++;
    } else {
      console.log(`  ✓ ${c.name} (${h})`);
    }
  }

  // Determinism: a second pass must produce identical hashes.
  for (const c of cases) {
    if (caseHash(c) !== caseHash(c)) {
      console.error(`  ✗ ${c.name}: non-deterministic output`);
      failed++;
    }
  }

  if (missing > 0) {
    console.log(
      `\n${missing} golden(s) missing — paste the CAPTURE lines into GOLDENS and re-run.`,
    );
    process.exit(1);
  }
  if (failed > 0) {
    console.error(`\nWASM mesh golden: ${failed} FAILED ✗`);
    process.exit(1);
  }
  console.log(`\nWASM mesh golden: ${cases.length} cases PASSED ✓`);
}

main().catch((e) => {
  console.error('\nWASM mesh golden FAILED ✗');
  console.error(e);
  process.exit(1);
});
