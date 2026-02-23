import { Array3Dc } from '../../../math';
import { unpackCell } from '../../cell-map/types';

/**
 * Computes a per-cell visibility mask for line-of-sight reveal clipping.
 *
 * Three phases:
 * 1. Column scan — ceilings above target are clipped (+ everything above);
 *    floors below target are clipped (everything below the floor).
 * 2. Wall sweep toward camera (-X, -Z) — camera-facing walls keep visible,
 *    cells behind them are clipped.
 * 3. Wall sweep away from camera (+X, +Z) — away-facing walls AND cells
 *    behind them are clipped (reveals interior to camera).
 *
 * @returns Uint8Array sized mapX×mapY×mapZ. 0 = visible, 255 = clipped.
 *          Index order: z * mapY * mapX + y * mapX + x (matches Array3Dc).
 */
export function computeVisibilityMask(
  packedData: Array3Dc<number>,
  mapSize: { x: number; y: number; z: number },
  targetCell: { x: number; y: number; z: number },
): Uint8Array {
  const mx = mapSize.x;
  const my = mapSize.y;
  const mz = mapSize.z;
  const total = mx * my * mz;

  // Expand compressed data for O(1) random access
  const expanded = packedData.expand();
  const data = expanded.value;

  // Mask: 0 = visible, 255 = clipped
  const mask = new Uint8Array(total);

  // Index helper (matches Array3D layout: z * my * mx + y * mx + x)
  const idx = (x: number, y: number, z: number): number =>
    z * my * mx + y * mx + x;

  // Solid check: visible AND non-air shape
  const isSolid = (x: number, y: number, z: number): boolean => {
    if (x < 0 || x >= mx || y < 0 || y >= my || z < 0 || z >= mz)
      return false;
    const cell = unpackCell(data[idx(x, y, z)]);
    return cell.visible && cell.shapeIndex !== 0;
  };

  const tx = targetCell.x;
  const ty = targetCell.y;
  const tz = targetCell.z;

  // ── Phase 1: Column scan (ceiling + floor) ──────────────────────────

  for (let x = 0; x < mx; x++) {
    for (let z = 0; z < mz; z++) {
      // Ceiling: scan upward from target, find first solid cell
      let ceilingY = -1;
      for (let y = ty + 1; y < my; y++) {
        if (isSolid(x, y, z)) {
          ceilingY = y;
          break;
        }
      }
      // Clip ceiling cell and everything above
      if (ceilingY >= 0) {
        for (let y = ceilingY; y < my; y++) {
          mask[idx(x, y, z)] = 255;
        }
      }

      // Floor: scan downward from target, find first solid cell
      // (the floor the target stands on or the surface below)
      let floorY = -1;
      for (let y = ty - 1; y >= 0; y--) {
        if (isSolid(x, y, z)) {
          floorY = y;
          break;
        }
      }
      // Clip everything below the floor (keep the floor visible)
      if (floorY >= 0) {
        for (let y = 0; y < floorY; y++) {
          mask[idx(x, y, z)] = 255;
        }
      }
    }
  }

  // ── Phase 2: Wall sweeps (4 cardinal directions) ────────────────────
  //
  // For each row at the target's height range, sweep outward from the
  // target cell. When hitting a wall, clip cells behind it.
  //
  // Isometric camera: higher X+Z = closer to camera.
  //   -X sweep → toward lower X (further from camera) → hits +X face (camera-facing)
  //   +X sweep → toward higher X (toward camera)      → hits -X face (away from camera)
  //   -Z sweep → toward lower Z (further from camera) → hits +Z face (camera-facing)
  //   +Z sweep → toward higher Z (toward camera)      → hits -Z face (away from camera)

  for (let y = 0; y < my; y++) {
    // X-axis sweeps for each Z row
    for (let z = 0; z < mz; z++) {
      // -X sweep: camera-facing wall (+X face) → clip behind, keep wall
      for (let x = tx - 1; x >= 0; x--) {
        if (isSolid(x, y, z)) {
          // Clip all cells behind this wall (even further from camera)
          for (let bx = x - 1; bx >= 0; bx--) {
            mask[idx(bx, y, z)] = 255;
          }
          break; // wall blocks further sight
        }
      }

      // +X sweep: away-from-camera wall (-X face) → clip wall AND behind
      for (let x = tx + 1; x < mx; x++) {
        if (isSolid(x, y, z)) {
          // Clip the wall itself AND all cells behind it
          for (let bx = x; bx < mx; bx++) {
            mask[idx(bx, y, z)] = 255;
          }
          break;
        }
      }
    }

    // Z-axis sweeps for each X row
    for (let x = 0; x < mx; x++) {
      // -Z sweep: camera-facing wall (+Z face) → clip behind, keep wall
      for (let z = tz - 1; z >= 0; z--) {
        if (isSolid(x, y, z)) {
          for (let bz = z - 1; bz >= 0; bz--) {
            mask[idx(x, y, bz)] = 255;
          }
          break;
        }
      }

      // +Z sweep: away-from-camera wall (-Z face) → clip wall AND behind
      for (let z = tz + 1; z < mz; z++) {
        if (isSolid(x, y, z)) {
          for (let bz = z; bz < mz; bz++) {
            mask[idx(x, y, bz)] = 255;
          }
          break;
        }
      }
    }
  }

  return mask;
}
