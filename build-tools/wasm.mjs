// Build helper invoked by webpack (and the wasm parity test) to compile the
// hand-rolled Rust render crate to wasm. No wasm-pack / wasm-bindgen — just a
// `cargo build` of a cdylib with an extern "C" ABI. This module is NOT imported
// by the engine runtime; webpack injects the result via DefinePlugin
// (__RENDER_WASM_BASE64__), so the base64 only ever lives in build output.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wasmDir = path.join(root, 'wasm');
const TARGET = 'wasm32-unknown-unknown';
const ARTIFACT = path.join(
  wasmDir,
  'target',
  TARGET,
  'release',
  'omosuen_render.wasm',
);

/** Compiles the render crate to wasm and returns the raw bytes (Buffer). */
export function buildRenderWasm() {
  execFileSync('cargo', ['build', '--release', '--target', TARGET], {
    cwd: wasmDir,
    stdio: 'inherit',
  });
  return readFileSync(ARTIFACT);
}

/** Compiles the render crate and returns the wasm as a base64 string. */
export function buildRenderWasmBase64() {
  return buildRenderWasm().toString('base64');
}
