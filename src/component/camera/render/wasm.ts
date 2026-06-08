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
