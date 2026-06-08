/**
 * Render-domain WASM glue (`omosuen-render`).
 *
 * Lives with the camera because rendering is the camera's domain. It owns the
 * render-specific concerns: which module to load (`__RENDER_WASM_BASE64__`,
 * injected by webpack DefinePlugin — same mechanism as `__ENGINE_VERSION__`) and
 * the typed boundary to the module's exports. The generic compile/instantiate
 * step lives in `src/wasm` (reusable across WASM modules).
 *
 * The render WASM is a hard requirement (no JS fallback). It is instantiated in
 * the camera's async init(), which processInitQueue awaits before the camera is
 * marked _initialized — and render() skips uninitialized cameras — so the module
 * is always ready before any solidity() call.
 *
 * The boundary is allocation-free in steady state: input/output live in the
 * module's linear memory, and the typed-array views over them are cached and
 * recreated only when a pointer, the backing buffer, or the element count
 * changes (i.e. after the map grows).
 */
import { base64ToBytes, initWasm } from '../../../wasm';

// Injected by webpack DefinePlugin. Only defined in webpack builds; the Node
// parity test passes bytes to initRenderWasm() instead, so this is never read
// there (the `??` short-circuits).
// eslint-disable-next-line @typescript-eslint/naming-convention
declare const __RENDER_WASM_BASE64__: string;

interface RenderExports {
  memory: WebAssembly.Memory;
  solidity_reserve: (count: number) => number;
  solidity_run: (count: number) => number;
  mesh_reserve_map: (cellCount: number) => number;
  mesh_set_dims: (
    mx: number,
    my: number,
    mz: number,
    cx: number,
    cy: number,
    cz: number,
  ) => void;
  mesh_build_chunk: (cx: number, cy: number, cz: number) => void;
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
  indexOffset: number;
  indexCount: number;
}

/** Result of building one chunk's greedy mesh in WASM. */
export interface ChunkMeshResult {
  vertices: Float32Array | null;
  indices: Uint32Array | null;
  ranges: MeshDrawRange[];
}

let wasmExports: RenderExports | null = null;

/**
 * Instantiates the render WASM module. Idempotent. Awaited from the camera's
 * init(). `wasmBytes` is an injection point for non-webpack environments (the
 * Node parity test); production decodes the DefinePlugin base64.
 */
export async function initRenderWasm(wasmBytes?: Uint8Array): Promise<void> {
  if (wasmExports) return;
  const bytes = wasmBytes ?? base64ToBytes(__RENDER_WASM_BASE64__);
  wasmExports = await initWasm<RenderExports>(bytes);
}

// Cached linear-memory views — recreated only when the pointer, backing buffer,
// or element count changes (memory growth on a larger map).
let inputView: Uint32Array | null = null;
let outputView: Uint8Array | null = null;
let inputPtr = -1;
let outputPtr = -1;
let viewBuffer: ArrayBufferLike | null = null;
let viewCount = -1;

/**
 * Runs the solidity compute over `count` packed cells, copying them into linear
 * memory and returning a (reused) Uint8Array view of the 0/255 result. The
 * caller must consume the result before the next call (it is reused).
 *
 * Throws if the module has not been initialized — there is no JS fallback.
 */
export function solidity(
  packedFlat: ArrayLike<number>,
  count: number,
): Uint8Array {
  if (!wasmExports) {
    throw new Error(
      '[omosuen] render WASM not initialized — initRenderWasm() must run ' +
        '(it is awaited in the camera init) before solidity() is called.',
    );
  }
  const ex = wasmExports;

  const reservedPtr = ex.solidity_reserve(count);
  const buffer = ex.memory.buffer;
  if (
    buffer !== viewBuffer ||
    reservedPtr !== inputPtr ||
    viewCount !== count
  ) {
    inputView = new Uint32Array(buffer, reservedPtr, count);
    inputPtr = reservedPtr;
    viewBuffer = buffer;
    viewCount = count;
    outputView = null; // output view must be rebuilt against the new buffer
  }

  const iv = inputView!;
  for (let i = 0; i < count; i++) {
    iv[i] = packedFlat[i];
  }

  const resultPtr = ex.solidity_run(count);
  if (!outputView || resultPtr !== outputPtr || outputView.buffer !== buffer) {
    outputView = new Uint8Array(buffer, resultPtr, count);
    outputPtr = resultPtr;
  }

  return outputView;
}

/**
 * Uploads the expanded packed map + dimensions into the module's linear memory.
 * Call once per rebuild pass before any buildChunkMeshWasm() calls.
 */
export function setMeshMap(
  packedFlat: ArrayLike<number>,
  cellCount: number,
  mapX: number,
  mapY: number,
  mapZ: number,
  cellX: number,
  cellY: number,
  cellZ: number,
): void {
  if (!wasmExports) {
    throw new Error('[omosuen] render WASM not initialized (setMeshMap).');
  }
  const ex = wasmExports;
  const ptr = ex.mesh_reserve_map(cellCount);
  const view = new Uint32Array(ex.memory.buffer, ptr, cellCount);
  for (let i = 0; i < cellCount; i++) {
    view[i] = packedFlat[i];
  }
  ex.mesh_set_dims(mapX, mapY, mapZ, cellX, cellY, cellZ);
}

/**
 * Builds one chunk's greedy mesh in WASM and copies the result out into
 * standalone arrays (the chunk retains them for GPU upload). Requires a prior
 * setMeshMap() in the same rebuild pass. Throws if not initialized.
 */
export function buildChunkMeshWasm(
  cx: number,
  cy: number,
  cz: number,
): ChunkMeshResult {
  if (!wasmExports) {
    throw new Error(
      '[omosuen] render WASM not initialized (buildChunkMeshWasm).',
    );
  }
  const ex = wasmExports;
  ex.mesh_build_chunk(cx, cy, cz);

  const buffer = ex.memory.buffer;
  const vlen = ex.mesh_vertices_len();
  const ilen = ex.mesh_indices_len();
  const rlen = ex.mesh_ranges_len();

  const vertices =
    vlen > 0
      ? new Float32Array(buffer, ex.mesh_vertices_ptr(), vlen).slice()
      : null;
  const indices =
    ilen > 0
      ? new Uint32Array(buffer, ex.mesh_indices_ptr(), ilen).slice()
      : null;

  const ranges: MeshDrawRange[] = [];
  if (rlen > 0) {
    const rview = new Uint32Array(buffer, ex.mesh_ranges_ptr(), rlen);
    for (let i = 0; i < rlen; i += 3) {
      ranges.push({
        materialIndex: rview[i],
        indexOffset: rview[i + 1],
        indexCount: rview[i + 2],
      });
    }
  }

  return { vertices, indices, ranges };
}
