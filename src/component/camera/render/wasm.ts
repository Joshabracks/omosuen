/**
 * Loader + boundary glue for the render-domain WASM module (`omosuen-render`).
 *
 * Hand-rolled extern "C" ABI — no wasm-bindgen. The `.wasm` is compiled by
 * webpack (build-tools/wasm.mjs) and injected as a base64 string via DefinePlugin
 * (`__RENDER_WASM_BASE64__`), so the UMD bundle stays self-contained.
 *
 * Cell data is held canonically in this module as an RLE store (see lib.rs).
 * cell-map loads it via loadCellStore() and mutates it via cellStoreGet/Set; the
 * visibility and meshing passes read the store's internally-cached expanded
 * buffer, so there is no per-frame JS decompression or copy-in.
 *
 * The render WASM is a hard requirement (no JS fallback); it is instantiated in
 * the cell-map builder/deserializer (which awaits initRenderWasm) and the camera
 * init, all of which run before any read.
 */
import { base64ToBytes, initWasm } from '../../../wasm';

// Injected by webpack DefinePlugin. Only defined in webpack builds; the Node
// tests pass bytes to initRenderWasm() instead (the `??` short-circuits).
// eslint-disable-next-line @typescript-eslint/naming-convention
declare const __RENDER_WASM_BASE64__: string;

interface RenderExports {
  memory: WebAssembly.Memory;
  // Canonical cell store
  store_reserve: (count: number) => number;
  store_load: (mx: number, my: number, mz: number) => void;
  store_get: (x: number, y: number, z: number) => number;
  store_set: (x: number, y: number, z: number, packed: number) => void;
  store_flush: () => void;
  store_expanded_ptr: () => number;
  store_expanded_len: () => number;
  // Visibility
  solidity_run: () => number;
  // Meshing
  mesh_set_cell_size: (cx: number, cy: number, cz: number) => void;
  mesh_set_chunk_size: (x: number, y: number, z: number) => void;
  mesh_reserve_weights: (count: number) => number;
  mesh_reserve_material_weights: (count: number) => number;
  mesh_custom_clear: () => void;
  mesh_custom_stage_verts: (count: number) => number;
  mesh_custom_stage_indices: (count: number) => number;
  mesh_custom_stage_uvs: (count: number) => number;
  mesh_custom_commit: (shapeIndex: number, coverMask: number) => void;
  mesh_vertex_stride: () => number;
  mesh_set_smoothing: (smoothing: number, normalSmoothing: number) => void;
  mesh_build_chunk: (cx: number, cy: number, cz: number) => void;
  mesh_build_chunk_smoothed: (cx: number, cy: number, cz: number) => void;
  mesh_vertices_ptr: () => number;
  mesh_vertices_len: () => number;
  mesh_indices_ptr: () => number;
  mesh_indices_len: () => number;
  mesh_ranges_ptr: () => number;
  mesh_ranges_len: () => number;
}

/** A draw range within a chunk's index buffer for one material. */
export interface MeshDrawRange {
  materialIndex: number;
  /** True when this range's vertices carry mesh UVs (sample by UV, not triplanar). */
  useMeshUV: boolean;
  indexOffset: number;
  indexCount: number;
}

/** Result of building one chunk's mesh in WASM. */
export interface ChunkMeshResult {
  vertices: Float32Array | null;
  indices: Uint32Array | null;
  ranges: MeshDrawRange[];
  /** Floats per vertex: 10 (pos3+normal3+origPos3+emission1) or 12 (+uv2 when UV shapes present). */
  stride: number;
}

let wasmExports: RenderExports | null = null;

function ex(): RenderExports {
  if (!wasmExports) {
    throw new Error(
      '[omosuen] render WASM not initialized — initRenderWasm() must run ' +
        '(awaited in the cell-map builder/deserializer and camera init) first.',
    );
  }
  return wasmExports;
}

/**
 * Instantiates the render WASM module. Idempotent. Awaited from the cell-map
 * builder/deserializer and camera init. `wasmBytes` is an injection point for
 * non-webpack environments (the Node tests); production decodes the base64.
 */
export async function initRenderWasm(wasmBytes?: Uint8Array): Promise<void> {
  if (wasmExports) return;
  const bytes = wasmBytes ?? base64ToBytes(__RENDER_WASM_BASE64__);
  wasmExports = await initWasm<RenderExports>(bytes);
}

export function isRenderWasmReady(): boolean {
  return wasmExports !== null;
}

// ── Canonical cell store ───────────────────────────────────────────────────

/** Bulk-loads the canonical store from a flat packed array (RLE-compressed in
 *  WASM). Called by the cell-map builder/deserializer. */
export function loadCellStore(
  packedFlat: ArrayLike<number>,
  total: number,
  mapX: number,
  mapY: number,
  mapZ: number,
): void {
  const e = ex();
  const ptr = e.store_reserve(total);
  const view = new Uint32Array(e.memory.buffer, ptr, total);
  // Native bulk copy -- was a manual element-by-element for-loop, which at
  // full-window scale (millions of cells) is measurably slower than letting
  // the engine's typed-array set() do it.
  view.set(packedFlat, 0);
  e.store_load(mapX, mapY, mapZ);
}

/** Returns the packed cell value at (x,y,z). */
export function cellStoreGet(x: number, y: number, z: number): number {
  return ex().store_get(x, y, z) >>> 0;
}

/** Sets the packed cell value at (x,y,z). */
export function cellStoreSet(
  x: number,
  y: number,
  z: number,
  packed: number,
): void {
  ex().store_set(x, y, z, packed);
}

/** Flushes pending writes (recompresses the RLE store). */
export function cellStoreFlush(): void {
  ex().store_flush();
}

/** Returns a copy of the store as a flat packed array (for serialization). */
export function cellStoreDump(): Uint32Array {
  const e = ex();
  const len = e.store_expanded_len();
  if (len === 0) return new Uint32Array(0);
  // store_expanded_ptr() can lazily rebuild the Rust-side expanded buffer
  // (Vec::resize), which may grow WASM memory and detach any ArrayBuffer
  // reference captured before it runs — so the pointer must be captured
  // first, and `.buffer` read fresh afterward (same pattern as solidity()
  // and loadCellStore() below).
  const ptr = e.store_expanded_ptr();
  return new Uint32Array(e.memory.buffer, ptr, len).slice();
}

// ── Visibility ─────────────────────────────────────────────────────────────

let solidityView: Uint8Array | null = null;
let solidityPtr = -1;
let solidityBuffer: ArrayBufferLike | null = null;
let solidityLen = -1;

/**
 * Computes the solidity map (0/255 per cell) from the resident store and returns
 * a reused Uint8Array view of the result. Consume before the next call.
 */
export function solidity(): Uint8Array {
  const e = ex();
  const ptr = e.solidity_run();
  const len = e.store_expanded_len();
  const buffer = e.memory.buffer;
  if (
    !solidityView ||
    ptr !== solidityPtr ||
    solidityBuffer !== buffer ||
    solidityLen !== len
  ) {
    solidityView = new Uint8Array(buffer, ptr, len);
    solidityPtr = ptr;
    solidityBuffer = buffer;
    solidityLen = len;
  }
  return solidityView;
}

// ── Meshing ────────────────────────────────────────────────────────────────

/** Sets the cell size (world units per cell) used for vertex positions. */
export function setMeshCellSize(cx: number, cy: number, cz: number): void {
  ex().mesh_set_cell_size(cx, cy, cz);
}

/**
 * Sets the chunk size (cells per axis) used by `buildChunkMeshWasm` /
 * `buildChunkMeshSmoothedWasm`. Intended to be called once per store, during
 * cell-map construction/deserialization, before any chunk is built — the
 * store's dims are fixed at load time and chunk boundaries need to agree with
 * the caller's own chunk grid math for the lifetime of that store.
 */
export function setChunkSize(x: number, y: number, z: number): void {
  ex().mesh_set_chunk_size(x, y, z);
}

/**
 * Uploads per-cell smoothing weights (0–15) and sets the smoothing iteration
 * count + normal-smoothing factor. Call once per rebuild pass (before any
 * buildChunkMeshSmoothedWasm).
 */
export function setMeshSmoothing(
  weightsFlat: ArrayLike<number>,
  cellCount: number,
  smoothing: number,
  normalSmoothing: number,
): void {
  const e = ex();
  const ptr = e.mesh_reserve_weights(cellCount);
  const view = new Uint32Array(e.memory.buffer, ptr, cellCount);
  for (let i = 0; i < cellCount; i++) {
    view[i] = weightsFlat[i];
  }
  e.mesh_set_smoothing(smoothing, normalSmoothing);
}

/**
 * Uploads per-material smoothing overrides (0–15, or -1 for "no override → use
 * the per-cell/map weight"). Indexed by material index. Call once per rebuild
 * pass (after setMeshSmoothing, before any buildChunkMeshSmoothedWasm).
 */
export function setMeshMaterialWeights(weights: ArrayLike<number>): void {
  const e = ex();
  const count = weights.length;
  const ptr = e.mesh_reserve_material_weights(count);
  const view = new Int32Array(e.memory.buffer, ptr, count);
  for (let i = 0; i < count; i++) {
    view[i] = weights[i];
  }
}

/** Clears the WASM custom-shape registry. Call before re-uploading shapes. */
export function clearCustomShapes(): void {
  ex().mesh_custom_clear();
}

/**
 * Uploads a custom cell mesh (shapeIndex >= 2) to the WASM registry. Vertices are
 * local -0.5..0.5; the mesher shifts them by +0.5 to fill the cell footprint and
 * emits the triangles into the same vertex pool as cubes (so they smooth/dedup
 * together — no seams). Must run after clearCustomShapes(), before building chunks.
 */
export function setCustomShape(
  shapeIndex: number,
  vertices: ArrayLike<number>,
  indices: ArrayLike<number>,
  uvs?: ArrayLike<number>,
  coverMask = 0x3f,
): void {
  const e = ex();
  const vptr = e.mesh_custom_stage_verts(vertices.length);
  const vview = new Float32Array(e.memory.buffer, vptr, vertices.length);
  for (let i = 0; i < vertices.length; i++) vview[i] = vertices[i];
  const iptr = e.mesh_custom_stage_indices(indices.length);
  const iview = new Uint32Array(e.memory.buffer, iptr, indices.length);
  for (let i = 0; i < indices.length; i++) iview[i] = indices[i];
  const uvLen = uvs ? uvs.length : 0;
  const uptr = e.mesh_custom_stage_uvs(uvLen);
  if (uvs && uvLen > 0) {
    const uview = new Float32Array(e.memory.buffer, uptr, uvLen);
    for (let i = 0; i < uvLen; i++) uview[i] = uvs[i];
  }
  e.mesh_custom_commit(shapeIndex, coverMask & 0x3f);
}

/** Copies the current MESH_* output buffers out into standalone arrays. */
function readMeshOutput(e: RenderExports): ChunkMeshResult {
  const buffer = e.memory.buffer;
  const vlen = e.mesh_vertices_len();
  const ilen = e.mesh_indices_len();
  const rlen = e.mesh_ranges_len();

  const vertices =
    vlen > 0
      ? new Float32Array(buffer, e.mesh_vertices_ptr(), vlen).slice()
      : null;
  const indices =
    ilen > 0
      ? new Uint32Array(buffer, e.mesh_indices_ptr(), ilen).slice()
      : null;

  const ranges: MeshDrawRange[] = [];
  if (rlen > 0) {
    const rview = new Uint32Array(buffer, e.mesh_ranges_ptr(), rlen);
    for (let i = 0; i < rlen; i += 3) {
      // High bit of the material field flags a UV-mode (mesh-UV) range.
      const rawMat = rview[i];
      ranges.push({
        materialIndex: rawMat & 0x7fffffff,
        useMeshUV: (rawMat & 0x80000000) !== 0,
        indexOffset: rview[i + 1],
        indexCount: rview[i + 2],
      });
    }
  }

  return { vertices, indices, ranges, stride: e.mesh_vertex_stride() };
}

/** Builds one chunk's greedy mesh from the resident store. */
export function buildChunkMeshWasm(
  cx: number,
  cy: number,
  cz: number,
): ChunkMeshResult {
  const e = ex();
  e.mesh_build_chunk(cx, cy, cz);
  return readMeshOutput(e);
}

/** Builds one chunk's smoothed mesh. Requires a prior setMeshSmoothing(). */
export function buildChunkMeshSmoothedWasm(
  cx: number,
  cy: number,
  cz: number,
): ChunkMeshResult {
  const e = ex();
  e.mesh_build_chunk_smoothed(cx, cy, cz);
  return readMeshOutput(e);
}
