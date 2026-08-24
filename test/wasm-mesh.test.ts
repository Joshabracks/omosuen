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
import { packCell } from '../src/component/cell-map/types';

// This test drives the WASM mesher directly (bypassing cell-map's per-instance
// `chunkSize`, which is now runtime-configurable), so it pins its own chunk
// size matching CHUNK_SIZE's Rust-side default ([16,16,16], unset unless
// mesh_set_chunk_size is called), keeping these golden hashes stable.
const CHUNK_SIZE = 16;

/**
 * Local copy of generateDefaultCubeMesh (a 24-vertex cube with per-face 0..1 UVs,
 * local -0.5..0.5). Inlined to avoid importing the cell-map barrel, which pulls in
 * .vert/.frag shader modules that tsx can't load.
 */
function uvCubeMesh(): {
  vertices: Float32Array;
  uvs: Float32Array;
  indices: Uint16Array;
} {
  const vertices = new Float32Array([
    -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5, // Front (+Z)
    0.5, -0.5, -0.5, -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, // Back (-Z)
    -0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5, // Top (+Y)
    -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5, -0.5, 0.5, // Bottom (-Y)
    0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, // Right (+X)
    -0.5, -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5, // Left (-X)
  ]);
  const faceUv = [0, 1, 1, 1, 1, 0, 0, 0]; // V flipped to atlas convention (v=0 at top)
  const uvs = new Float32Array([...faceUv, ...faceUv, ...faceUv, ...faceUv, ...faceUv, ...faceUv]);
  const indices = new Uint16Array(
    [0, 4, 8, 12, 16, 20].flatMap((b) => [b, b + 1, b + 2, b, b + 2, b + 3]),
  );
  return { vertices, uvs, indices };
}
import {
  initRenderWasm,
  loadCellStore,
  setMeshCellSize,
  setMeshEdgeOccludes,
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
  // Re-baselined for the new trueFaceDir3 vertex field (stride 10/12 -> 13/15,
  // see .omosuen_requests/009-cell-highlight-cost.md's follow-up fix for
  // setEmissionColor's per-face highlight bug) -- content-only shift, no
  // change to position/topology, hashes just move with the added floats.
  'g1-greedy': 1672683969,
  'g2-greedy-1mat': 3713878264,
  'g3-greedy-allsolid': 1173199007,
  'g4-greedy-allair': 520366341,
  's1-smooth-flat': 2594956124,
  's2-smooth-fullnorm': 3864754023,
  // Updated for the min-weight seam rule: shared vertices take the lowest
  // (hardest) contributing cell weight instead of the average, so random-weight
  // cases shift. Uniform-weight cases (s1/s2) are unaffected.
  's3-smooth-lerp-randw': 287827551,
  's4-smooth-multichunk': 2964681758,
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
  const stride = r.stride;
  let seamCount = 0;
  let movedFarCorner = false;
  for (let i = 0; i < v.length; i += stride) {
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

/**
 * A custom shape with per-vertex UVs widens the emitted vertex to 11 floats and
 * flags its draw range for UV sampling; without UVs it stays 9 floats / triplanar.
 */
function customUvCheck(): number {
  const verts = new Float32Array([-0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5]);
  const idx = new Uint16Array([0, 1, 2]);
  const uvs = new Float32Array([0, 0, 1, 0, 1, 1]);
  const size = new Vector3D(1, 1, 1);

  const buildWith = (withUv: boolean): ChunkMeshResult => {
    const packed = new Array3D<number>(size);
    packed.indexSet(0, packCell({ materialIndex: 0, shapeIndex: 2, emissionIntensity: 0, visible: true }));
    loadCellStore(packed.value, 1, 1, 1, 1);
    setMeshCellSize(1, 1, 1);
    clearCustomShapes();
    setCustomShape(2, verts, idx, withUv ? uvs : undefined);
    return buildChunkMeshWasm(0, 0, 0);
  };

  let fails = 0;
  const withUv = buildWith(true);
  if (withUv.stride !== 15) {
    console.error(`  ✗ custom-uv: expected stride 15 with UVs, got ${withUv.stride}`);
    fails++;
  }
  if (!withUv.ranges.some((r) => r.useMeshUV)) {
    console.error('  ✗ custom-uv: no UV-mode range was flagged');
    fails++;
  }
  const noUv = buildWith(false);
  if (noUv.stride !== 13) {
    console.error(`  ✗ custom-uv: expected stride 13 without UVs, got ${noUv.stride}`);
    fails++;
  }
  if (noUv.ranges.some((r) => r.useMeshUV)) {
    console.error('  ✗ custom-uv: UV bit set without UVs');
    fails++;
  }
  clearCustomShapes();
  if (fails === 0) {
    console.log('  ✓ custom-uv: UVs widen stride to 15 + flag the range; none → stride 13');
  }
  return fails;
}

/**
 * Per-side coverage: a cube next to a custom cell culls the shared face only when
 * the custom shape covers its facing side. Uncovering it (negX bit clear) makes
 * the cube emit that face — +6 indices vs the covered (default) case.
 */
function coverageCheck(): number {
  const verts = new Float32Array([-0.5, -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5]);
  const idx = new Uint16Array([0, 1, 2]);
  const size = new Vector3D(2, 1, 1);

  const build = (coverMask: number): number => {
    const packed = new Array3D<number>(size);
    packed.indexSet(0, packCell({ materialIndex: 0, shapeIndex: 1, emissionIntensity: 0, visible: true }));
    packed.indexSet(1, packCell({ materialIndex: 0, shapeIndex: 2, emissionIntensity: 0, visible: true }));
    loadCellStore(packed.value, 2, 2, 1, 1);
    setMeshCellSize(1, 1, 1);
    clearCustomShapes();
    setCustomShape(2, verts, idx, undefined, coverMask);
    const r = buildChunkMeshWasm(0, 0, 0);
    return r.indices ? r.indices.length : 0;
  };

  let fails = 0;
  const covered = build(0x3f); // negX (bit 5) covered → cube +X face culled
  const uncovered = build(0x3f & ~(1 << 5)); // negX uncovered → cube +X face emitted
  if (uncovered !== covered + 6) {
    console.error(`  ✗ coverage: uncovering the custom side should add the neighbor face (${covered} vs ${uncovered})`);
    fails++;
  }
  clearCustomShapes();
  if (fails === 0) {
    console.log('  ✓ coverage: uncovering a custom side lets the neighbor render its face (+6 indices)');
  }
  return fails;
}

/**
 * A per-vertex-UV custom CUBE is SMOOTHED under smoothing > 0 (geometry rounds) while
 * keeping per-face UVs intact and the UV-mode range flagged. (We deliberately smooth UV
 * cubes so they blend with surrounding terrain; the per-face UVs must survive the
 * position-dedup smoothing — the original bug collapsed them into a gradient.)
 */
function customUvSmoothedCheck(): number {
  const cube = uvCubeMesh();
  const size = new Vector3D(1, 1, 1);
  const packed = new Array3D<number>(size);
  packed.indexSet(0, packCell({ materialIndex: 0, shapeIndex: 2, emissionIntensity: 0, visible: true }));
  loadCellStore(packed.value, 1, 1, 1, 1);
  setMeshCellSize(1, 1, 1);
  const weights = new Array3D<number>(size, 8);
  setMeshSmoothing(weights.value, 1, 4, 0.75);
  setMeshMaterialWeights(new Int32Array([-1]));
  clearCustomShapes();
  setCustomShape(2, cube.vertices, cube.indices, cube.uvs);
  const r = buildChunkMeshSmoothedWasm(0, 0, 0);

  let fails = 0;
  if (r.stride !== 15) {
    console.error(`  ✗ custom-uv-smoothed: expected stride 15, got ${r.stride}`);
    fails++;
  }
  const uvRanges = r.ranges.filter((rr) => rr.useMeshUV);
  if (uvRanges.length === 0) {
    console.error('  ✗ custom-uv-smoothed: no UV-mode range under smoothing');
    fails++;
  }
  const v = r.vertices;
  const idx = r.indices;
  let tris = 0;
  const uvSet = new Set<string>();
  if (v && idx) {
    for (const rr of uvRanges) {
      tris += rr.indexCount / 3;
      for (let k = 0; k < rr.indexCount; k++) {
        const vi = idx[rr.indexOffset + k] * 11;
        // Per-face UVs must survive the smoothing pass (4 distinct corner UVs), even
        // though the geometry positions are now intentionally rounded.
        uvSet.add(`${v[vi + 9].toFixed(3)},${v[vi + 10].toFixed(3)}`);
      }
    }
  }
  if (uvSet.size < 4) {
    console.error(`  ✗ custom-uv-smoothed: per-face UVs collapsed (distinct UVs ${uvSet.size} < 4)`);
    fails++;
  }
  if (tris !== 12) {
    console.error(`  ✗ custom-uv-smoothed: lone uvCube should emit 12 tris (6 faces), got ${tris}`);
    fails++;
  }
  clearCustomShapes();
  if (fails === 0) {
    console.log('  ✓ custom-uv-smoothed: uvCube smooths while keeping per-face UVs under smoothing:4');
  }
  return fails;
}

/**
 * A per-vertex-UV custom cube must cull the faces hidden by solid neighbors. A lone
 * uvCube emits all 6 faces (12 tris); one wedged between two solid cubes loses its
 * ±X faces (8 tris). Counts only UV-mode (useMeshUV) triangles, in the greedy path.
 */
function customUvCullingCheck(): number {
  const cube = uvCubeMesh();
  const uvTris = (r: ChunkMeshResult): number => {
    let n = 0;
    for (const rr of r.ranges) if (rr.useMeshUV) n += rr.indexCount / 3;
    return n;
  };

  const lonePacked = new Array3D<number>(new Vector3D(1, 1, 1));
  lonePacked.indexSet(0, packCell({ materialIndex: 0, shapeIndex: 2, emissionIntensity: 0, visible: true }));
  loadCellStore(lonePacked.value, 1, 1, 1, 1);
  setMeshCellSize(1, 1, 1);
  clearCustomShapes();
  setCustomShape(2, cube.vertices, cube.indices, cube.uvs);
  const lone = uvTris(buildChunkMeshWasm(0, 0, 0));

  const rowPacked = new Array3D<number>(new Vector3D(3, 1, 1));
  rowPacked.indexSet(0, packCell({ materialIndex: 0, shapeIndex: 1, emissionIntensity: 0, visible: true }));
  rowPacked.indexSet(1, packCell({ materialIndex: 0, shapeIndex: 2, emissionIntensity: 0, visible: true }));
  rowPacked.indexSet(2, packCell({ materialIndex: 0, shapeIndex: 1, emissionIntensity: 0, visible: true }));
  loadCellStore(rowPacked.value, 3, 3, 1, 1);
  setMeshCellSize(1, 1, 1);
  clearCustomShapes();
  setCustomShape(2, cube.vertices, cube.indices, cube.uvs);
  const wedged = uvTris(buildChunkMeshWasm(0, 0, 0));

  let fails = 0;
  if (lone !== 12) {
    console.error(`  ✗ custom-uv-culling: lone uvCube should be 12 tris, got ${lone}`);
    fails++;
  }
  if (wedged !== 8) {
    console.error(`  ✗ custom-uv-culling: uvCube between two cubes should cull ±X → 8 tris, got ${wedged}`);
    fails++;
  }
  clearCustomShapes();
  if (fails === 0) {
    console.log('  ✓ custom-uv-culling: uvCube culls faces hidden by solid neighbors (12 → 8 tris)');
  }
  return fails;
}

/**
 * `setMeshEdgeOccludes` gates whether a face-culling neighbor lookup that
 * falls entirely outside the resident store defaults to occluding (true) or
 * empty (false, the WASM default). A single solid cell alone in a 1x1x1
 * store has every neighbor out-of-bounds by construction: with the flag off
 * (default, matches every other case in this file) all 6 faces render, same
 * as always; with it on, all 6 are culled (a `CellWindow`-backed caller's
 * real scenario — an edge chunk whose true neighbor just hasn't loaded yet
 * shouldn't expose an interior cross-section). Checks both the default-cube
 * path (`buildChunkMeshWasm`) and the custom-shape UV-cube path (reusing
 * `customUvCullingCheck`'s "lone" setup). Always resets the flag to false
 * before returning, since every other check in this file assumes it's off.
 */
function edgeOccludesCheck(): number {
  let fails = 0;

  clearCustomShapes();
  setMeshCellSize(1, 1, 1);
  const lonePacked = new Array3D<number>(new Vector3D(1, 1, 1));
  lonePacked.indexSet(0, packCell({ materialIndex: 0, shapeIndex: 1, emissionIntensity: 0, visible: true }));
  loadCellStore(lonePacked.value, 1, 1, 1, 1);

  setMeshEdgeOccludes(false);
  const facesOff = buildChunkMeshWasm(0, 0, 0).indices?.length ?? 0;
  if (facesOff / 6 !== 6) {
    console.error(`  ✗ edge-occludes: lone cube with flag off should render all 6 faces, got ${facesOff / 6}`);
    fails++;
  }

  setMeshEdgeOccludes(true);
  const facesOn = buildChunkMeshWasm(0, 0, 0).indices?.length ?? 0;
  if (facesOn !== 0) {
    console.error(`  ✗ edge-occludes: lone cube with flag on should render 0 faces (unknown neighbor occludes), got ${facesOn / 6}`);
    fails++;
  }

  const cube = uvCubeMesh();
  const uvTris = (r: ChunkMeshResult): number => {
    let n = 0;
    for (const rr of r.ranges) if (rr.useMeshUV) n += rr.indexCount / 3;
    return n;
  };
  const loneShapePacked = new Array3D<number>(new Vector3D(1, 1, 1));
  loneShapePacked.indexSet(0, packCell({ materialIndex: 0, shapeIndex: 2, emissionIntensity: 0, visible: true }));
  loadCellStore(loneShapePacked.value, 1, 1, 1, 1);
  clearCustomShapes();
  setCustomShape(2, cube.vertices, cube.indices, cube.uvs);
  const trisOn = uvTris(buildChunkMeshWasm(0, 0, 0));
  if (trisOn !== 0) {
    console.error(`  ✗ edge-occludes: lone UV-cube with flag on should cull all 12 tris, got ${trisOn}`);
    fails++;
  }

  clearCustomShapes();
  setMeshEdgeOccludes(false);
  if (fails === 0) {
    console.log('  ✓ edge-occludes: out-of-store neighbor renders when off, occludes when on (default-cube + UV-cube)');
  }
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

  // Custom-shape rendering: WASM gating (cube suppressed, occlusion preserved),
  // smoothed-pipeline coupling, optional UVs, and per-side coverage.
  failed += shapeGatingCheck();
  failed += customSmoothingCheck();
  failed += customUvCheck();
  failed += customUvSmoothedCheck();
  failed += customUvCullingCheck();
  failed += coverageCheck();
  failed += edgeOccludesCheck();

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
