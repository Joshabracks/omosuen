import { Array3Dc } from '../../../math';
import { solidity } from '../../../wasm/render';

/**
 * Computes a per-cell solidity map for GPU-side line-of-sight raycasting.
 *
 * Each cell is marked as solid (255) or empty (0). The fragment shader samples
 * this texture during 3D DDA ray marching to determine per-pixel visibility from
 * the reveal target.
 *
 * Runs entirely in WASM (`omosuen-render`) — single source of truth, no JS
 * fallback. The render WASM is loaded in the camera's init() and render() skips
 * uninitialized cameras, so the module is always ready when this is called.
 *
 * @returns Uint8Array sized mapX×mapY×mapZ. 0 = empty, 255 = solid.
 *          Index order: z * mapY * mapX + y * mapX + x (matches Array3Dc).
 *          This is a reused linear-memory view — consume it before the next call.
 */
export function computeSolidityMap(
  packedData: Array3Dc<number>,
  mapSize: { x: number; y: number; z: number },
): Uint8Array {
  const total = mapSize.x * mapSize.y * mapSize.z;
  // expand() is still JS-side for now; it moves into WASM when the canonical
  // cell store does (render crate step 3).
  const expanded = packedData.expand();
  return solidity(expanded.value, total);
}
