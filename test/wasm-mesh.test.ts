/**
 * Parity test for the render WASM greedy chunk mesher (step 2a).
 *
 * Run: npm run test:wasm-mesh
 *
 * Builds random packed cell-maps (smoothing = 0) and asserts the WASM greedy
 * mesh is byte-identical to the JS reference (`buildChunkMesh`) for every chunk:
 * interleaved vertex floats, index buffer, and per-material draw ranges.
 *
 * The cell-map is constructed directly (no component builder) so the test graph
 * stays free of the component registry / shader imports that don't load in tsx.
 */
import { Vector3D, Array3D } from '../src/math';
import { packCell, CHUNK_SIZE } from '../src/component/cell-map/types';
import type { ChunkMesh } from '../src/component/cell-map/types';
import type { CellMapT } from '../src/component/cell-map/data';
import { buildChunkMesh } from '../src/component/cell-map/mesh-builder';
import {
  initRenderWasm,
  setMeshMap,
  buildChunkMeshWasm,
  type ChunkMeshResult,
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

function freshChunk(cx: number, cy: number, cz: number): ChunkMesh {
  return {
    cx,
    cy,
    cz,
    dirty: true,
    vertices: null,
    indices: null,
    drawRanges: [],
    faceCount: 0,
    glVertexBuffer: null,
    glIndexBuffer: null,
  };
}

function cmpFloat(
  a: Float32Array | null,
  b: Float32Array | null,
  label: string,
): void {
  if (a === null && b === null) return;
  if (!a || !b) {
    throw new Error(`${label}: vertices null mismatch js=${!!a} wasm=${!!b}`);
  }
  if (a.length !== b.length) {
    throw new Error(`${label}: vertex length ${a.length} (js) vs ${b.length}`);
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      throw new Error(`${label}: vertex float[${i}] js=${a[i]} wasm=${b[i]}`);
    }
  }
}

function cmpInt(
  a: Uint32Array | null,
  b: Uint32Array | null,
  label: string,
): void {
  if (a === null && b === null) return;
  if (!a || !b) {
    throw new Error(`${label}: indices null mismatch js=${!!a} wasm=${!!b}`);
  }
  if (a.length !== b.length) {
    throw new Error(`${label}: index length ${a.length} (js) vs ${b.length}`);
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      throw new Error(`${label}: index[${i}] js=${a[i]} wasm=${b[i]}`);
    }
  }
}

function cmpRanges(
  js: ChunkMesh['drawRanges'],
  wasm: ChunkMeshResult['ranges'],
  label: string,
): void {
  if (js.length !== wasm.length) {
    throw new Error(`${label}: range count ${js.length} (js) vs ${wasm.length}`);
  }
  for (let i = 0; i < js.length; i++) {
    if (
      js[i].materialIndex !== wasm[i].materialIndex ||
      js[i].indexOffset !== wasm[i].indexOffset ||
      js[i].indexCount !== wasm[i].indexCount
    ) {
      throw new Error(
        `${label}: range[${i}] js=${JSON.stringify(js[i])} wasm=${JSON.stringify(wasm[i])}`,
      );
    }
  }
}

interface Case {
  size: Vector3D;
  cellSize: Vector3D;
  mats: number;
  solid: number;
  seed: number;
}

function buildPacked(c: Case): Array3D<number> {
  const rng = makeRng(c.seed);
  const packed = new Array3D<number>(c.size);
  packed.forEach((_v, _x, _y, _z, i) => {
    const shapeIndex = rng() < c.solid ? 1 : 0; // 0 = air
    const materialIndex = Math.floor(rng() * c.mats);
    packed.indexSet(
      i,
      packCell({ materialIndex, shapeIndex, emissionIntensity: 0, visible: true }),
    );
  });
  return packed;
}

function chunkCoords(size: Vector3D): { cx: number; cy: number; cz: number }[] {
  const gx = Math.ceil(size.x / CHUNK_SIZE);
  const gy = Math.ceil(size.y / CHUNK_SIZE);
  const gz = Math.ceil(size.z / CHUNK_SIZE);
  const out: { cx: number; cy: number; cz: number }[] = [];
  for (let cz = 0; cz < gz; cz++) {
    for (let cy = 0; cy < gy; cy++) {
      for (let cx = 0; cx < gx; cx++) {
        out.push({ cx, cy, cz });
      }
    }
  }
  return out;
}

function runCase(c: Case): { chunks: number; withGeom: number } {
  const packed = buildPacked(c);
  // Minimal CellMapT for the greedy path (reads smoothing/mapSize/cellSize only).
  const cellMap = {
    mapSize: c.size,
    cellSize: c.cellSize,
    smoothing: 0,
  } as unknown as CellMapT;

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

  let withGeom = 0;
  const coords = chunkCoords(c.size);
  for (const { cx, cy, cz } of coords) {
    const jsChunk = freshChunk(cx, cy, cz);
    buildChunkMesh(cellMap, jsChunk, packed, null);
    const wasm = buildChunkMeshWasm(cx, cy, cz);

    const label = `seed${c.seed} chunk(${cx},${cy},${cz})`;
    cmpFloat(jsChunk.vertices, wasm.vertices, label);
    cmpInt(jsChunk.indices, wasm.indices, label);
    cmpRanges(jsChunk.drawRanges, wasm.ranges, label);
    if (wasm.indices) withGeom++;
  }
  return { chunks: coords.length, withGeom };
}

async function main(): Promise<void> {
  await initRenderWasm(buildRenderWasm());

  const cases: Case[] = [
    { size: new Vector3D(20, 18, 20), cellSize: new Vector3D(1, 0.5, 2), mats: 4, solid: 0.5, seed: 1 },
    { size: new Vector3D(16, 16, 16), cellSize: new Vector3D(1, 1, 1), mats: 1, solid: 0.5, seed: 2 },
    { size: new Vector3D(33, 9, 17), cellSize: new Vector3D(0.25, 3, 1), mats: 6, solid: 0.3, seed: 3 },
    { size: new Vector3D(18, 18, 18), cellSize: new Vector3D(1, 1, 1), mats: 3, solid: 1.0, seed: 4 }, // all solid
    { size: new Vector3D(18, 18, 18), cellSize: new Vector3D(1, 1, 1), mats: 3, solid: 0.0, seed: 5 }, // all air
    { size: new Vector3D(1, 40, 1), cellSize: new Vector3D(2, 0.5, 2), mats: 2, solid: 0.6, seed: 6 }, // thin column
  ];

  let passed = 0;
  for (const c of cases) {
    const { chunks, withGeom } = runCase(c);
    console.log(
      `  ✓ seed${c.seed} [${c.size.x}x${c.size.y}x${c.size.z}] ${chunks} chunks (${withGeom} with geometry) — byte-equal`,
    );
    passed++;
  }

  console.log(`\nWASM greedy mesh parity: ${passed} cases PASSED ✓`);
}

main().catch((e) => {
  console.error('\nWASM greedy mesh parity FAILED ✗');
  console.error(e);
  process.exit(1);
});
