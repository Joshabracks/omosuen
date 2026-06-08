import { solidity } from './wasm';

/**
 * Computes a per-cell solidity map for GPU-side line-of-sight raycasting,
 * reading the resident canonical cell store (no JS-side decompression).
 *
 * Each cell is marked solid (255) or empty (0). The fragment shader samples this
 * texture during 3D DDA ray marching to determine per-pixel visibility from the
 * reveal target.
 *
 * Single source of truth — runs entirely in WASM (`omosuen-render`), no JS
 * fallback. Returns a reused linear-memory view sized mapX×mapY×mapZ
 * (index order z·mapY·mapX + y·mapX + x); consume it before the next call.
 */
export function computeSolidityMap(): Uint8Array {
  return solidity();
}
