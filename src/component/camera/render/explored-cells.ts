/**
 * The explored-cell sweep proper: which cells one vision source reveals.
 *
 * A leaf module -- its only runtime import is fog-of-war's own visibility
 * predicate, itself a leaf. That is deliberate: it keeps this loadable
 * standalone (see test/explored-sweep.test.ts) without the cell-map barrel,
 * which transitively pulls in the component registry and camera/init's raw
 * .vert/.frag shader imports. Same split, and same reason, as
 * fog-of-war/sweep.ts and ./ray-blocked.
 *
 * Consequently this DECIDES but never ACTS: it reads explored state and marks
 * it through the callbacks its caller supplies (`explored-sweep.ts` backs them
 * with `CellMap.isCellExplored`/`setCellExplored`).
 */

import { isVisibleFrom } from '../../fog-of-war/sweep';
import type { ResolvedSource } from '../../fog-of-war/sweep';
import { boxVisibility } from './visibility-shapes';

/**
 * Marks every cell a visibility-volume reaches as explored: each cell whose
 * CENTRE has non-zero box visibility (inside the box, or inside its fade band).
 *
 * The same rule the shader and `computeFogVisibility` apply, through the same
 * `boxVisibility`, so "remembered" is exactly "was live because of this box".
 * No raycast -- a volume is a declaration, not an observer. Off-window cells
 * are fine: the caller's `mark` persists them to cold storage.
 *
 * `isExplored` is consulted first, so re-marking an already-stamped box costs
 * one read per cell -- though the caller also throttles to box changes only.
 */
export function markVolumeExploredCells(
  box: ResolvedSource,
  cellSize: { x: number; y: number; z: number },
  isExplored: (x: number, y: number, z: number) => boolean,
  mark: (x: number, y: number, z: number) => void,
): void {
  const half = box.half;
  if (!half) return;
  const fade = box.fadeWidth > 0 ? box.fadeWidth : 0;
  const x0 = Math.floor((box.pos.x - half.x - fade) / cellSize.x);
  const x1 = Math.floor((box.pos.x + half.x + fade) / cellSize.x);
  const y0 = Math.floor((box.pos.y - half.y - fade) / cellSize.y);
  const y1 = Math.floor((box.pos.y + half.y + fade) / cellSize.y);
  const z0 = Math.floor((box.pos.z - half.z - fade) / cellSize.z);
  const z1 = Math.floor((box.pos.z + half.z + fade) / cellSize.z);
  for (let z = z0; z <= z1; z++) {
    const cz = (z + 0.5) * cellSize.z;
    for (let y = y0; y <= y1; y++) {
      const cy = (y + 0.5) * cellSize.y;
      for (let x = x0; x <= x1; x++) {
        const cx = (x + 0.5) * cellSize.x;
        if (boxVisibility(cx, cy, cz, box.pos, half, fade) <= 0) continue;
        if (isExplored(x, y, z)) continue;
        mark(x, y, z);
      }
    }
  }
}

/** The resident window, for the line-of-sight test's raycast. */
export interface ExploredWindow {
  /** Resident-window solidity, as uploaded for `u_cellSolidity` that frame. */
  mask: Uint8Array;
  /** Window origin in CELLS (chunk origin * chunkSize). */
  originCell: { x: number; y: number; z: number };
  /** Resident window size in cells. */
  cellDims: { x: number; y: number; z: number };
}

/**
 * Marks every cell a source can actually SEE as explored.
 *
 * "Explored" is a binary per-cell flag driving the never-viewed -> memory STYLE
 * blend. It asks the same question the live view asks, through the same
 * predicate: `isVisibleFrom`, which is exactly `computeFogVisibility(...) > 0`
 * and mirrors unified.frag's `visionSourceVisibility` ray for ray. So a cell is
 * remembered precisely when the player has at some point been able to see it,
 * and terrain memory, sprite memory and the live view can no longer disagree
 * about what counts as seen.
 *
 * Marking was briefly distance-only, which decoupled it from the live test and
 * left memory appearing on ground that was in range but out of sight.
 *
 * Cells whose ray leaves the resident window are treated as visible, because
 * `isRayBlockedTS` fails OPEN out of bounds -- and so does the shader's own
 * `isRayBlocked`. The raycast runs against the VOXEL volume (the solidity mask,
 * which covers every resident cell whether or not its mesh has been built), not
 * against geometry, so an unmeshed chunk is tested normally and a non-resident
 * one resolves the same way on both sides.
 *
 * `isExplored` is consulted BEFORE anything else, so a source standing still on
 * already-explored ground costs one array read per cell in range and no rays.
 */
export function markExploredCells(
  pos: { x: number; y: number; z: number },
  sources: ResolvedSource[],
  outerWorld: number,
  cellSize: { x: number; y: number; z: number },
  window: ExploredWindow,
  isExplored: (x: number, y: number, z: number) => boolean,
  mark: (x: number, y: number, z: number) => void,
  /**
   * `false` marks purely by range, skipping the visibility test. Off the
   * default path (`FogOfWar.exploreRequiresLineOfSight`); it makes memory
   * disagree with the live view on purpose, and exists as a perf lever for a
   * scene where the per-cell raycast is too expensive.
   */
  requireLineOfSight = true,
): void {
  if (!(outerWorld > 0)) return;
  const outerSq = outerWorld * outerWorld;
  const centerX = Math.floor(pos.x / cellSize.x);
  const centerY = Math.floor(pos.y / cellSize.y);
  const centerZ = Math.floor(pos.z / cellSize.z);
  const radiusCellsX = Math.ceil(outerWorld / cellSize.x);
  const radiusCellsY = Math.ceil(outerWorld / cellSize.y);
  const radiusCellsZ = Math.ceil(outerWorld / cellSize.z);

  // Reused so the per-cell loop allocates nothing.
  const probe = { x: 0, y: 0, z: 0 };

  for (let z = centerZ - radiusCellsZ; z <= centerZ + radiusCellsZ; z++) {
    const cz = (z + 0.5) * cellSize.z;
    const dz = cz - pos.z;
    const dzSq = dz * dz;
    if (dzSq >= outerSq) continue;
    for (let y = centerY - radiusCellsY; y <= centerY + radiusCellsY; y++) {
      const cy = (y + 0.5) * cellSize.y;
      const dy = cy - pos.y;
      const dzySq = dzSq + dy * dy;
      if (dzySq >= outerSq) continue;
      for (let x = centerX - radiusCellsX; x <= centerX + radiusCellsX; x++) {
        const cx = (x + 0.5) * cellSize.x;
        const dx = cx - pos.x;
        // A cheap bound on THIS source before paying for the shared predicate,
        // which re-tests distance across every source anyway.
        if (dzySq + dx * dx >= outerSq) continue;

        // Cheapest reject first. In steady state a moving source only newly
        // explores a thin crescent, so nearly every cell exits here without a
        // single ray.
        if (isExplored(x, y, z)) continue;

        if (requireLineOfSight) {
          probe.x = cx;
          probe.y = cy;
          probe.z = cz;
          if (
            !isVisibleFrom(
              probe,
              sources,
              window.mask,
              window.cellDims,
              window.originCell,
              cellSize,
            )
          ) {
            continue;
          }
        }

        mark(x, y, z);
      }
    }
  }
}
