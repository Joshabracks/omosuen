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
  loadCellStore,
  setMeshCellSize,
  setMeshSmoothing,
  setMeshMaterialWeights,
  setCustomShape,
  clearCustomShapes,
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
  // Updated for the min-weight seam rule: shared vertices take the lowest
  // (hardest) contributing cell weight instead of the average, so random-weight
  // cases shift. Uniform-weight cases (s1/s2) are unaffected.
  's3-smooth-lerp-randw': 3190637875,
  's4-smooth-multichunk': 758565337,
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
  loadCellStore(packed.value, total, c.size.x, c.size.y, c.size.z);
  setMeshCellSize(c.cellSize.x, c.cellSize.y, c.cellSize.z);
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

/**
 * Explicit (non-golden) check of the min-weight seam rule and the per-material
 * smoothing override. Two solid cells sit side by side along X with different
 * materials: cell 0 (material 0) is made HARD via a material override (weight 0)
 * while cell 1 (material 1) falls back to the soft map weight (15).
 *
 * The min rule means a vertex shared by a hard and a soft cell takes the hard
 * (0) weight, so the seam stays pinned to the grid while the soft cell's
 * far corners are free to move. Asserts:
 *   - every vertex on the x=1 seam plane stays exactly at its original position
 *   - at least one soft far-corner vertex (orig x=2) moves inward (x < 2)
 * Returns the number of failed assertions.
 */
function seamRuleCheck(): number {
  const size = new Vector3D(2, 1, 1);
  const total = size.x * size.y * size.z;
  const packed = new Array3D<number>(size);
  // cell 0 → material 0 (hard), cell 1 → material 1 (soft); both solid + visible
  packed.indexSet(
    0,
    packCell({ materialIndex: 0, shapeIndex: 1, emissionIntensity: 0, visible: true }),
  );
  packed.indexSet(
    1,
    packCell({ materialIndex: 1, shapeIndex: 1, emissionIntensity: 0, visible: true }),
  );
  loadCellStore(packed.value, total, size.x, size.y, size.z);
  setMeshCellSize(1, 1, 1);

  // Soft everywhere via the map weight; material 0 overrides to hard (0).
  const mapWeights = new Array3D<number>(size);
  mapWeights.forEach((_v, _x, _y, _z, i) => mapWeights.indexSet(i, 15));
  setMeshSmoothing(mapWeights.value, total, 8, 0);
  setMeshMaterialWeights(new Int32Array([0, -1])); // mat 0 → 0, mat 1 → use map (15)

  const r = buildChunkMeshSmoothedWasm(0, 0, 0);
  let fails = 0;
  if (!r.vertices) {
    console.error('  ✗ seam-rule: no vertices produced');
    return 1;
  }

  const eps = 1e-4;
  const v = r.vertices;
  let seamCount = 0;
  let movedFarCorner = false;
  for (let i = 0; i < v.length; i += 9) {
    const px = v[i],
      py = v[i + 1],
      pz = v[i + 2];
    const ox = v[i + 6],
      oy = v[i + 7],
      oz = v[i + 8];
    if (Math.abs(ox - 1) < eps) {
      // Seam vertex (shared with the hard cell) must stay pinned to original.
      seamCount++;
      if (
        Math.abs(px - ox) > eps ||
        Math.abs(py - oy) > eps ||
        Math.abs(pz - oz) > eps
      ) {
        console.error(
          `  ✗ seam-rule: seam vertex moved (${px},${py},${pz}) from (${ox},${oy},${oz})`,
        );
        fails++;
      }
    }
    if (Math.abs(ox - 2) < eps && px < 2 - eps) movedFarCorner = true;
  }
  if (seamCount === 0) {
    console.error('  ✗ seam-rule: no seam-plane vertices found');
    fails++;
  }
  if (!movedFarCorner) {
    console.error('  ✗ seam-rule: soft far corner did not move (override/smoothing inactive)');
    fails++;
  }
  if (fails === 0) {
    console.log(`  ✓ seam-rule (min weight + material override): ${seamCount} seam verts pinned`);
  }
  return fails;
}

/**
 * Custom shapes (shapeIndex >= 2) must emit NO cube faces from the WASM mesher
 * while still occluding neighbors. Three cells in a row (cube, X, cube): when the
 * middle is a custom shape the two end cubes lose their inner faces (10 faces);
 * when the middle is air those inner faces are exposed (12 faces). Returns fails.
 */
function shapeGatingCheck(): number {
  clearCustomShapes();
  setMeshCellSize(1, 1, 1);
  const build = (middleShape: number): number => {
    const packed = new Array3D<number>(new Vector3D(3, 1, 1));
    const cube = packCell({ materialIndex: 0, shapeIndex: 1, emissionIntensity: 0, visible: true });
    packed.indexSet(0, cube);
    packed.indexSet(1, packCell({ materialIndex: 0, shapeIndex: middleShape, emissionIntensity: 0, visible: true }));
    packed.indexSet(2, cube);
    loadCellStore(packed.value, 3, 3, 1, 1);
    const r = buildChunkMeshWasm(0, 0, 0);
    return r.indices ? r.indices.length / 6 : 0;
  };
  let fails = 0;
  const facesCustom = build(2);
  const facesAir = build(0);
  if (facesCustom !== 10) {
    console.error(`  ✗ shape-gating: custom middle should yield 10 faces (no cube, neighbors culled), got ${facesCustom}`);
    fails++;
  }
  if (facesAir !== 12) {
    console.error(`  ✗ shape-gating: air middle should yield 12 faces (inner faces exposed), got ${facesAir}`);
    fails++;
  }
  if (fails === 0) {
    console.log('  ✓ shape-gating: custom shape emits no cube but still occludes (10 vs air 12)');
  }
  return fails;
}

/**
 * Custom shapes (shapeIndex >= 2) must be emitted by the SMOOTHED mesher and
 * share vertices with neighboring cubes (deduped into the smoothing pool → no
 * seam). A row of cubes (material 0) with a wedge cell (shape 2, material 1)
 * between them: registering the wedge adds geometry, and at least one wedge
 * vertex coincides exactly with a cube vertex (same smoothed position). Returns fails.
 */
function customSmoothingCheck(): number {
  // One triangle on shared cell corners (local -0.5..0.5).
  const wedgeVerts = new Float32Array([
    -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5,
  ]);
  const wedgeIdx = new Uint16Array([0, 1, 2]);
  const size = new Vector3D(3, 1, 1);
  const total = 3;

  const build = (): ChunkMeshResult => {
    const packed = new Array3D<number>(size);
    packed.indexSet(0, packCell({ materialIndex: 0, shapeIndex: 1, emissionIntensity: 0, visible: true }));
    packed.indexSet(1, packCell({ materialIndex: 1, shapeIndex: 2, emissionIntensity: 0, visible: true }));
    packed.indexSet(2, packCell({ materialIndex: 0, shapeIndex: 1, emissionIntensity: 0, visible: true }));
    loadCellStore(packed.value, total, 3, 1, 1);
    setMeshCellSize(1, 1, 1);
    const weights = new Array3D<number>(size, 8);
    setMeshSmoothing(weights.value, total, 4, 0);
    setMeshMaterialWeights(new Int32Array([-1, -1]));
    return buildChunkMeshSmoothedWasm(0, 0, 0);
  };

  let fails = 0;

  clearCustomShapes();
  const i0 = build().indices?.length ?? 0;

  clearCustomShapes();
  setCustomShape(2, wedgeVerts, wedgeIdx);
  const withShape = build();
  const i1 = withShape.indices?.length ?? 0;

  if (i1 <= i0) {
    console.error(`  ✗ custom-smoothing: smoothed mesher emitted no wedge geometry (i0=${i0}, i1=${i1})`);
    fails++;
  }

  // Coupling: a wedge (material 1) vertex must exactly equal a cube (material 0)
  // vertex — proving they deduped into a single smoothed vertex (no seam).
  const v = withShape.vertices;
  const idx = withShape.indices;
  if (v && idx) {
    const matPositions = (mat: number): Set<string> => {
      const s = new Set<string>();
      for (const r of withShape.ranges) {
        if (r.materialIndex !== mat) continue;
        for (let k = 0; k < r.indexCount; k++) {
          const vi = idx[r.indexOffset + k] * 9;
          s.add(`${v[vi]},${v[vi + 1]},${v[vi + 2]}`);
        }
      }
      return s;
    };
    const cubePos = matPositions(0);
    let shared = 0;
    for (const p of matPositions(1)) if (cubePos.has(p)) shared++;
    if (shared === 0) {
      console.error('  ✗ custom-smoothing: no wedge vertex coincides with a cube vertex (not coupled)');
      fails++;
    } else if (fails === 0) {
      console.log(`  ✓ custom-smoothing: wedge smoothed with cubes, ${shared} shared vertices (seamless)`);
    }
  }

  clearCustomShapes();
  return fails;
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

  // Explicit seam-rule + material-override assertions (not golden-hashed).
  failed += seamRuleCheck();

  // Custom-shape rendering: WASM gating (cube suppressed, occlusion preserved)
  // and smoothed-pipeline coupling (wedge dedups/smooths with cubes).
  failed += shapeGatingCheck();
  failed += customSmoothingCheck();

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
