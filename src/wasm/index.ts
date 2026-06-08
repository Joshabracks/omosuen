/**
 * Reusable, module-agnostic WASM tooling.
 *
 * This directory holds only generic helpers shared across WASM modules. The
 * domain-specific glue — which `.wasm` to load and which exports to call — lives
 * with the component that uses it (e.g. the render compute glue is in
 * `src/component/camera/render/wasm.ts`).
 */

/**
 * Decodes a base64 string to bytes. Works in browsers and Node
 * (`globalThis.atob`).
 */
export function base64ToBytes(b64: string): Uint8Array {
  const binary = globalThis.atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Compiles and instantiates a WASM module from raw bytes and returns its
 * exports, typed as `T`. `imports` defaults to none (the engine's hand-rolled
 * modules import nothing).
 */
export async function initWasm<T = WebAssembly.Exports>(
  bytes: Uint8Array,
  imports: WebAssembly.Imports = {},
): Promise<T> {
  const module = await WebAssembly.compile(bytes as BufferSource);
  const instance = await WebAssembly.instantiate(module, imports);
  return instance.exports as unknown as T;
}
