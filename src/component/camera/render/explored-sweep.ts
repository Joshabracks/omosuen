import { CellMap, CellMapT } from '../../cell-map';
import { VisionSourceT } from '../../vision-source';
import { VisibilityVolumeT } from '../../visibility-volume';
import { NexusT } from '../../nexus';
import { TransformT } from '../../transform';
import { castTo } from '../../types';
import { markExploredCells, markVolumeExploredCells } from './explored-cells';
import type { ExploredWindow } from './explored-cells';
import type { ResolvedSource } from '../../fog-of-war/sweep';
import {
  buildShapeGrid,
  createShapeGrid,
  gatherShapesInRect,
} from './visibility-shapes';

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

/**
 * Per-visibility-volume last-stamped extent, keyed by component id. A volume
 * re-stamps only when it moves, resizes or changes its fade -- a static
 * building's box is marked once, not every frame.
 */
const lastVolume = new Map<
  number,
  {
    x: number;
    y: number;
    z: number;
    hx: number;
    hy: number;
    hz: number;
    f: number;
  }
>();

// The DDA itself lives in ./ray-blocked, a leaf module with no imports, so
// fog-of-war's sweep and its tests can load it without this file's cell-map
// barrel (and, through it, camera/init's raw shader imports). Re-exported here
// because existing callers import it from this path.
export { isRayBlockedTS } from './ray-blocked';

/** Reused per-frame, so a warmed sweep allocates nothing. */
const resolvedSources: ResolvedSource[] = [];
/** Volume entries in `resolvedSources`, parallel to their components. */
const resolvedVolumes: VisibilityVolumeT[] = [];
/** Bins over `resolvedSources`, so each flood-fill tests only nearby shapes. */
const exploreGrid = createShapeGrid();
/** Per-source gather scratch. */
const nearScratch: ResolvedSource[] = [];

function transformOf(component: { parent: unknown }): TransformT | null {
  const parent = component.parent as { type?: string } | null;
  if (!parent || parent.type !== 'nexus') return null;
  return castTo<NexusT>(parent as NexusT).getComponentByType(
    'transform',
    false,
  ) as TransformT | null;
}

function slotAt(i: number): ResolvedSource {
  let slot = resolvedSources[i];
  if (!slot) {
    slot = {
      pos: { x: 0, y: 0, z: 0 },
      localCell: { x: 0, y: 0, z: 0 },
      outerSq: 0,
      radius: 0,
      fadeWidth: 0,
      half: null,
    };
    resolvedSources[i] = slot;
  }
  return slot;
}

/**
 * Resolves every shape that EXPLORES -- each enabled vision source, and each
 * enabled visibility-volume with `marksExplored` -- to its current world
 * position, mirroring `resolveActiveVisionSources` (fog-of-war/methods.ts).
 * A `marksExplored: false` volume is left out entirely, so it cannot make a
 * nearby source's flood-fill remember ground either.
 *
 * Volumes come first (indices `0..volumeCount`), recorded in
 * `resolvedVolumes`. Returns the total count; the array is grown to a
 * high-water mark and never shrunk.
 */
function resolveSources(
  visionSources: readonly VisionSourceT[],
  volumes: readonly VisibilityVolumeT[],
  originCell: { x: number; y: number; z: number },
  cellSize: { x: number; y: number; z: number },
): number {
  let count = 0;
  resolvedVolumes.length = 0;
  for (const volume of volumes) {
    if (volume._disposed === true || !volume.enabled || !volume.marksExplored)
      continue;
    if (volume.id === undefined) continue;
    const transform = transformOf(volume);
    if (!transform) continue;
    const pos = transform.worldPosition;
    const slot = slotAt(count);
    slot.pos.x = pos.x;
    slot.pos.y = pos.y;
    slot.pos.z = pos.z;
    let half = slot.half;
    if (!half) half = { x: 0, y: 0, z: 0 };
    half.x = Math.max(0, volume.size.x) / 2;
    half.y = Math.max(0, volume.size.y) / 2;
    half.z = Math.max(0, volume.size.z) / 2;
    slot.half = half;
    slot.radius = 0;
    slot.outerSq = 0;
    slot.fadeWidth = Math.max(0, volume.fadeWidth);
    resolvedVolumes.push(volume);
    count++;
  }
  for (const source of visionSources) {
    if (!source.enabled || source.id === undefined) continue;
    const transform = transformOf(source);
    if (!transform) continue;
    const pos = transform.worldPosition;
    const outer = source.radius + source.fadeWidth;
    const slot = slotAt(count);
    slot.pos.x = pos.x;
    slot.pos.y = pos.y;
    slot.pos.z = pos.z;
    slot.localCell.x = pos.x / cellSize.x - originCell.x;
    slot.localCell.y = pos.y / cellSize.y - originCell.y;
    slot.localCell.z = pos.z / cellSize.z - originCell.z;
    slot.outerSq = outer * outer;
    slot.radius = source.radius;
    slot.fadeWidth = source.fadeWidth;
    slot.half = null;
    count++;
  }
  return count;
}

/**
 * Throttled explored-CELL sweep over every exploring shape:
 *
 *   - each vision source that has crossed into a new cell hands its reach to
 *     `markExploredCells` (the leaf module holding the geometry, and the
 *     rationale for testing visibility rather than distance), testing only the
 *     shapes binned near it rather than every source in the scene;
 *   - each `marksExplored` visibility-volume that has moved or resized stamps
 *     its cells through `markVolumeExploredCells`.
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
  volumes: VisibilityVolumeT[],
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
  const count = resolveSources(visionSources, volumes, originCell, cellSize);
  if (count === 0) return;

  const isExplored = (x: number, y: number, z: number): boolean =>
    CellMap.isCellExplored(cellMap, x, y, z);
  const mark = (x: number, y: number, z: number): void =>
    CellMap.setCellExplored(cellMap, x, y, z);

  // ── Volumes ──────────────────────────────────────────────────────────────
  for (let i = 0; i < resolvedVolumes.length; i++) {
    const volume = resolvedVolumes[i];
    const box = resolvedSources[i];
    const half = box.half!;
    const last = lastVolume.get(volume.id!);
    if (
      last &&
      last.x === box.pos.x &&
      last.y === box.pos.y &&
      last.z === box.pos.z &&
      last.hx === half.x &&
      last.hy === half.y &&
      last.hz === half.z &&
      last.f === box.fadeWidth
    ) {
      continue;
    }
    lastVolume.set(volume.id!, {
      x: box.pos.x,
      y: box.pos.y,
      z: box.pos.z,
      hx: half.x,
      hy: half.y,
      hz: half.z,
      f: box.fadeWidth,
    });
    markVolumeExploredCells(box, cellSize, isExplored, mark);
  }

  // ── Vision sources ───────────────────────────────────────────────────────
  // Binned once, then each moving source gathers just the shapes whose reach
  // overlaps its own. `isVisibleFrom` maximises over what it is given, so a
  // cell a DIFFERENT nearby source (or box) can see is explored too, matching
  // the shader's own union over shapes.
  buildShapeGrid(
    exploreGrid,
    resolvedSources,
    count,
    8 * Math.max(cellSize.x, cellSize.z),
    Math.max(cellSize.x, cellSize.z),
    null,
  );
  const window: ExploredWindow = {
    mask,
    originCell,
    cellDims: cellMap.mapSize,
  };

  for (const source of visionSources) {
    if (!source.enabled || source.id === undefined) continue;
    const transform = transformOf(source);
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

    const outer = source.radius + source.fadeWidth;
    const near = gatherShapesInRect(
      exploreGrid,
      resolvedSources,
      count,
      pos.x - outer,
      pos.z - outer,
      pos.x + outer,
      pos.z + outer,
      nearScratch,
    );
    markExploredCells(
      pos,
      near,
      outer,
      cellSize,
      window,
      isExplored,
      mark,
      requireLineOfSight,
    );
  }
}

/** Clears a disposed vision source's or volume's throttle-cache entry. */
export function clearExploredSweepCache(componentId: number): void {
  lastCell.delete(componentId);
  lastVolume.delete(componentId);
}
