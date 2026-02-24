import { Array3Dc } from '../../../math';
import { unpackCell } from '../../cell-map/types';

/**
 * Computes a per-cell solidity map for GPU-side line-of-sight raycasting.
 *
 * Each cell is marked as solid (255) or empty (0). The fragment shader
 * samples this texture during 3D DDA ray marching to determine per-pixel
 * visibility from the reveal target.
 *
 * @returns Uint8Array sized mapX×mapY×mapZ. 0 = empty, 255 = solid.
 *          Index order: z * mapY * mapX + y * mapX + x (matches Array3Dc).
 */
export function computeSolidityMap(
  packedData: Array3Dc<number>,
  mapSize: { x: number; y: number; z: number },
): Uint8Array {
  const mx = mapSize.x;
  const my = mapSize.y;
  const mz = mapSize.z;
  const total = mx * my * mz;

  // Expand compressed data for O(1) random access
  const expanded = packedData.expand();
  const data = expanded.value;

  const map = new Uint8Array(total);

  for (let i = 0; i < total; i++) {
    const cell = unpackCell(data[i]);
    if (cell.visible && cell.shapeIndex !== 0) {
      map[i] = 255;
    }
  }

  return map;
}
