import { CellMap, CellMapT } from '../../cell-map';
import { VisionSourceT } from '../../vision-source';
import { NexusT } from '../../nexus';
import { TransformT } from '../../transform';
import { castTo } from '../../types';
import { markExploredCells } from './explored-cells';
import type { ExploredWindow } from './explored-cells';
import type { ResolvedSource } from '../../fog-of-war/sweep';

/**
 * Per-vision-source last-processed WORLD cell coordinate, keyed by component
 * id -- throttles the sweep below to only run when a source actually crosses
 * into a new cell, since re-marking already-explored ground is otherwise
 * wasted work every frame.
 *
 * Was keyed by CHUNK, which is what let a villager walk fifteen cells inside
 * one chunk -- far further than they can see -- without the sweep ever
 * re-running, leaving ground they had plainly walked past unexplored.
 */
const lastCell = new Map<number, { x: number; y: number; z: number }>();

// The DDA itself lives in ./ray-blocked, a leaf module with no imports, so
// fog-of-war's sweep and its tests can load it without this file's cell-map
// barrel (and, through it, camera/init's raw shader imports). Re-exported here
// because existing callers import it from this path.
export { isRayBlockedTS } from './ray-blocked';

/** Reused per-frame, so a warmed sweep allocates nothing. */
const resolvedSources: ResolvedSource[] = [];

/**
 * Resolves each enabled source to its current world position, mirroring
 * `resolveActiveVisionSources` (fog-of-war/methods.ts) and the equivalent block
 * in render-sprites.ts. Returns the count of valid leading entries; the array
 * is grown to a high-water mark and never shrunk.
 */
function resolveSources(
  visionSources: VisionSourceT[],
  originCell: { x: number; y: number; z: number },
  cellSize: { x: number; y: number; z: number },
): number {
  let count = 0;
  for (const source of visionSources) {
    if (!source.enabled || source.id === undefined) continue;
    const parent = source.parent;
    if (!parent || parent.type !== 'nexus') continue;
    const transform = castTo<NexusT>(parent).getComponentByType(
      'transform',
      false,
    ) as TransformT | null;
    if (!transform) continue;
    const pos = transform.worldPosition;
    const outer = source.radius + source.fadeWidth;
    let slot = resolvedSources[count];
    if (!slot) {
      slot = {
        pos: { x: 0, y: 0, z: 0 },
        localCell: { x: 0, y: 0, z: 0 },
        outerSq: 0,
        radius: 0,
        fadeWidth: 0,
      };
      resolvedSources[count] = slot;
    }
    slot.pos.x = pos.x;
    slot.pos.y = pos.y;
    slot.pos.z = pos.z;
    slot.localCell.x = pos.x / cellSize.x - originCell.x;
    slot.localCell.y = pos.y / cellSize.y - originCell.y;
    slot.localCell.z = pos.z / cellSize.z - originCell.z;
    slot.outerSq = outer * outer;
    slot.radius = source.radius;
    slot.fadeWidth = source.fadeWidth;
    count++;
  }
  return count;
}

/**
 * Throttled per-vision-source explored-CELL sweep: resolves each source's
 * position, skips the ones that have not crossed into a new cell, and hands the
 * rest to `markExploredCells` (the leaf module holding the geometry, and the
 * rationale for testing visibility rather than distance).
 *
 * Cells outside the resident window are fully supported and persist in the
 * explored channel's cold storage -- see `CellMap.setCellExplored`. That is
 * load-bearing, not incidental: vision sources routinely range over terrain
 * that is in range but not yet resident, and that ground has to come back
 * remembered rather than black when the window catches up.
 *
 * `mask` is the resident solidity buffer, already computed for that frame's
 * `u_cellSolidity` upload -- no extra WASM call here.
 */
export function sweepExploredCells(
  cellMap: CellMapT,
  visionSources: VisionSourceT[],
  mask: Uint8Array,
  requireLineOfSight = true,
): void {
  const origin = cellMap.window.origin;
  if (!origin) return;

  const cellSize = cellMap.cellSize;
  const chunkSize = cellMap.chunkSize;
  const originCell = {
    x: origin.cx * chunkSize.x,
    y: origin.cy * chunkSize.y,
    z: origin.cz * chunkSize.z,
  };
  const count = resolveSources(visionSources, originCell, cellSize);
  if (count === 0) return;

  // `isVisibleFrom` maximises over every source, so the whole resolved set is
  // passed for each one -- a cell a DIFFERENT source can see is explored too,
  // matching the shader's own union over sources.
  const sources = resolvedSources.slice(0, count);
  const window: ExploredWindow = {
    mask,
    originCell,
    cellDims: cellMap.mapSize,
  };

  const isExplored = (x: number, y: number, z: number): boolean =>
    CellMap.isCellExplored(cellMap, x, y, z);
  const mark = (x: number, y: number, z: number): void =>
    CellMap.setCellExplored(cellMap, x, y, z);

  for (const source of visionSources) {
    if (!source.enabled || source.id === undefined) continue;
    const parent = source.parent;
    if (!parent || parent.type !== 'nexus') continue;
    const transform = castTo<NexusT>(parent).getComponentByType(
      'transform',
      false,
    ) as TransformT | null;
    if (!transform) continue;
    const pos = transform.worldPosition;

    const cell = {
      x: Math.floor(pos.x / cellSize.x),
      y: Math.floor(pos.y / cellSize.y),
      z: Math.floor(pos.z / cellSize.z),
    };
    const last = lastCell.get(source.id);
    if (last && last.x === cell.x && last.y === cell.y && last.z === cell.z) {
      continue;
    }
    lastCell.set(source.id, cell);

    markExploredCells(
      pos,
      sources,
      source.radius + source.fadeWidth,
      cellSize,
      window,
      isExplored,
      mark,
      requireLineOfSight,
    );
  }
}

/** Clears a disposed vision source's throttle-cache entry. */
export function clearExploredSweepCache(sourceId: number): void {
  lastCell.delete(sourceId);
}
