import { CellMap, CellMapT } from '../../cell-map';
import { VisionSourceT } from '../../vision-source';
import { NexusT } from '../../nexus';
import { TransformT } from '../../transform';
import { castTo } from '../../types';
import { Vector3D } from '../../../math';

/**
 * Per-vision-source last-processed WORLD chunk coordinate, keyed by
 * component id -- throttles the sweep below to only run when a source
 * actually crosses into a new chunk (movement within a chunk is a no-op),
 * since re-marking already-explored chunks is otherwise wasted work every
 * frame.
 */
const _lastChunk = new Map<number, { cx: number; cy: number; cz: number }>();

function isSolidLocal(
  mask: Uint8Array,
  dims: { x: number; y: number; z: number },
  lx: number,
  ly: number,
  lz: number,
): boolean {
  if (
    lx < 0 ||
    lx >= dims.x ||
    ly < 0 ||
    ly >= dims.y ||
    lz < 0 ||
    lz >= dims.z
  ) {
    return false;
  }
  return mask[lz * dims.y * dims.x + ly * dims.x + lx] > 127;
}

/**
 * TS port of unified.frag's `isRayBlocked` (3D DDA, Amanatides & Woo),
 * operating on window-LOCAL continuous cell-space positions against the same
 * solidity buffer the live per-pixel raycast reads. Kept a direct line-by-
 * line mirror of the shader version (not "improved") so explored-marking
 * agrees with what the live view actually considers visible -- an explored
 * chunk should be one you could actually have seen, not one merely within
 * radius through a wall.
 */
export function isRayBlockedTS(
  mask: Uint8Array,
  dims: { x: number; y: number; z: number },
  originX: number,
  originY: number,
  originZ: number,
  destX: number,
  destY: number,
  destZ: number,
): boolean {
  let px = Math.floor(originX);
  let py = Math.floor(originY);
  let pz = Math.floor(originZ);
  const ex = Math.floor(destX);
  const ey = Math.floor(destY);
  const ez = Math.floor(destZ);
  if (px === ex && py === ey && pz === ez) return false;

  const dx = destX - originX;
  const dy = destY - originY;
  const dz = destZ - originZ;
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  const sz = Math.sign(dz);

  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : 1e10;
  const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : 1e10;
  const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : 1e10;

  let tMaxX =
    dx > 0
      ? (px + 1 - originX) * tDeltaX
      : dx < 0
        ? (originX - px) * tDeltaX
        : 1e10;
  let tMaxY =
    dy > 0
      ? (py + 1 - originY) * tDeltaY
      : dy < 0
        ? (originY - py) * tDeltaY
        : 1e10;
  let tMaxZ =
    dz > 0
      ? (pz + 1 - originZ) * tDeltaZ
      : dz < 0
        ? (originZ - pz) * tDeltaZ
        : 1e10;

  // Generous but bounded -- chunk-center sweep targets are bounded by a
  // source's own radius+fadeWidth, unlike the shader's per-pixel casts which
  // can span the whole resident window.
  const MAX_STEPS = 256;
  for (let i = 0; i < MAX_STEPS; i++) {
    if (tMaxX <= tMaxY && tMaxX <= tMaxZ) {
      px += sx;
      tMaxX += tDeltaX;
    } else if (tMaxY <= tMaxZ) {
      py += sy;
      tMaxY += tDeltaY;
    } else {
      pz += sz;
      tMaxZ += tDeltaZ;
    }

    if (px === ex && py === ey && pz === ez) return false;
    if (
      px < 0 ||
      px >= dims.x ||
      py < 0 ||
      py >= dims.y ||
      pz < 0 ||
      pz >= dims.z
    ) {
      return false;
    }
    if (isSolidLocal(mask, dims, px, py, pz)) return true;
  }
  return false;
}

/**
 * Fine (per-cell) terrain-memory capture for one chunk already confirmed
 * "near" a vision source. Bounds the cell loop to the intersection of the
 * source's live-vision sphere (radius+fadeWidth) with this chunk's cell
 * range (not the whole chunk -- a chunk can be far larger than the vision
 * radius), then per-cell-distance-rejects and per-cell-raycasts before
 * capturing, so only cells actually within live LOS get a snapshot -- being
 * in a "near" chunk doesn't mean every cell in that (possibly huge) chunk
 * was actually seen.
 */
function captureNearCellsInChunk(
  cellMap: CellMapT,
  mask: Uint8Array,
  cellDims: { x: number; y: number; z: number },
  originLocalCell: { x: number; y: number; z: number },
  chunkSize: { x: number; y: number; z: number },
  cellSize: { x: number; y: number; z: number },
  cx: number,
  cy: number,
  cz: number,
  pos: { x: number; y: number; z: number },
  outerWorld: number,
  localSourceCell: { x: number; y: number; z: number },
): void {
  const chunkBaseCellX = cx * chunkSize.x;
  const chunkBaseCellY = cy * chunkSize.y;
  const chunkBaseCellZ = cz * chunkSize.z;

  const minCellX = Math.max(
    chunkBaseCellX,
    Math.floor((pos.x - outerWorld) / cellSize.x),
  );
  const maxCellX = Math.min(
    chunkBaseCellX + chunkSize.x - 1,
    Math.floor((pos.x + outerWorld) / cellSize.x),
  );
  const minCellY = Math.max(
    chunkBaseCellY,
    Math.floor((pos.y - outerWorld) / cellSize.y),
  );
  const maxCellY = Math.min(
    chunkBaseCellY + chunkSize.y - 1,
    Math.floor((pos.y + outerWorld) / cellSize.y),
  );
  const minCellZ = Math.max(
    chunkBaseCellZ,
    Math.floor((pos.z - outerWorld) / cellSize.z),
  );
  const maxCellZ = Math.min(
    chunkBaseCellZ + chunkSize.z - 1,
    Math.floor((pos.z + outerWorld) / cellSize.z),
  );

  const coord = new Vector3D(0, 0, 0);
  for (let wz = minCellZ; wz <= maxCellZ; wz++) {
    const centerZ = (wz + 0.5) * cellSize.z;
    for (let wy = minCellY; wy <= maxCellY; wy++) {
      const centerY = (wy + 0.5) * cellSize.y;
      for (let wx = minCellX; wx <= maxCellX; wx++) {
        const centerX = (wx + 0.5) * cellSize.x;
        const dx = centerX - pos.x;
        const dy = centerY - pos.y;
        const dz = centerZ - pos.z;
        if (Math.sqrt(dx * dx + dy * dy + dz * dz) >= outerWorld) continue;

        const localCellX = wx - originLocalCell.x;
        const localCellY = wy - originLocalCell.y;
        const localCellZ = wz - originLocalCell.z;
        if (
          localCellX < 0 ||
          localCellX >= cellDims.x ||
          localCellY < 0 ||
          localCellY >= cellDims.y ||
          localCellZ < 0 ||
          localCellZ >= cellDims.z
        ) {
          continue;
        }

        if (
          isRayBlockedTS(
            mask,
            cellDims,
            localSourceCell.x,
            localSourceCell.y,
            localSourceCell.z,
            localCellX + 0.5,
            localCellY + 0.5,
            localCellZ + 0.5,
          )
        ) {
          continue;
        }

        coord.x = wx;
        coord.y = wy;
        coord.z = wz;
        const materialIndex = CellMap.getCellData(cellMap, coord).materialIndex;
        CellMap.setCellMemoryMaterial(cellMap, wx, wy, wz, materialIndex);
      }
    }
  }
}

/**
 * Throttled per-vision-source explored-chunk sweep. Only re-evaluates a
 * source's contribution when it has moved into a new WORLD chunk since last
 * checked; when it does, walks every chunk within radius+fadeWidth and marks
 * each one actually in line of sight (via `isRayBlockedTS` against the
 * resident solidity buffer, from the source to that chunk's nearest point)
 * as explored via `CellMap.setChunkExplored` -- so "explored" never leaks
 * through walls, matching the live view's own occlusion behavior. Chunks
 * within roughly one chunk-width (+ `nearBufferCells`) of the source ALSO
 * get fine per-cell terrain-memory capture (`captureNearCellsInChunk`) for
 * the near-tier LOD; farther explored chunks only get the coarse per-chunk
 * representative material `setChunkExplored` already carries. Call once
 * per cell-map per frame, passing the SAME solidity buffer already computed
 * for that frame's `u_cellSolidity` upload (no extra WASM call here).
 */
export function sweepExploredChunks(
  cellMap: CellMapT,
  visionSources: VisionSourceT[],
  mask: Uint8Array,
  nearBufferCells: number,
): void {
  const origin = cellMap.window.origin;
  if (!origin) return;

  const cellDims = cellMap.mapSize; // resident window size, in cells
  const chunkSize = cellMap.chunkSize;
  const cellSize = cellMap.cellSize;
  const gridDims = cellMap.chunkGridSize; // resident window size, in chunks

  const chunkWorldX = chunkSize.x * cellSize.x;
  const chunkWorldY = chunkSize.y * cellSize.y;
  const chunkWorldZ = chunkSize.z * cellSize.z;

  const originLocalCellX = origin.cx * chunkSize.x;
  const originLocalCellY = origin.cy * chunkSize.y;
  const originLocalCellZ = origin.cz * chunkSize.z;
  const originLocalCell = {
    x: originLocalCellX,
    y: originLocalCellY,
    z: originLocalCellZ,
  };

  // "Near" = roughly one chunk-width (the largest axis, as a representative
  // isotropic scalar) plus an optional cell buffer, measured from the
  // vision source's OWN position -- independent of its radius/fadeWidth.
  // This is deliberately NOT "near the edge of live vision": a vision
  // source with a large radius still only gets fine per-cell memory
  // immediately around itself, coarse per-chunk memory for the rest of
  // what it can see.
  const nearThresholdWorld =
    Math.max(chunkWorldX, chunkWorldY, chunkWorldZ) +
    nearBufferCells * Math.max(cellSize.x, cellSize.y, cellSize.z);

  for (const source of visionSources) {
    if (!source.enabled || source.id === undefined) continue;
    const parent = source.parent;
    if (!parent || parent.type !== 'nexus') continue;
    const nexus = castTo<NexusT>(parent);
    const transform = nexus.getComponentByType(
      'transform',
      false,
    ) as TransformT | null;
    if (!transform) continue;
    const pos = transform.worldPosition;

    const sourceCellX = pos.x / cellSize.x;
    const sourceCellY = pos.y / cellSize.y;
    const sourceCellZ = pos.z / cellSize.z;
    const sourceChunk = {
      cx: Math.floor(sourceCellX / chunkSize.x),
      cy: Math.floor(sourceCellY / chunkSize.y),
      cz: Math.floor(sourceCellZ / chunkSize.z),
    };

    const last = _lastChunk.get(source.id);
    if (
      last &&
      last.cx === sourceChunk.cx &&
      last.cy === sourceChunk.cy &&
      last.cz === sourceChunk.cz
    ) {
      continue;
    }
    _lastChunk.set(source.id, sourceChunk);

    const outerWorld = source.radius + source.fadeWidth;
    const radiusChunksX = Math.ceil(outerWorld / chunkWorldX) + 1;
    const radiusChunksY = Math.ceil(outerWorld / chunkWorldY) + 1;
    const radiusChunksZ = Math.ceil(outerWorld / chunkWorldZ) + 1;

    const localSourceCellX = sourceCellX - originLocalCellX;
    const localSourceCellY = sourceCellY - originLocalCellY;
    const localSourceCellZ = sourceCellZ - originLocalCellZ;

    for (
      let cz = sourceChunk.cz - radiusChunksZ;
      cz <= sourceChunk.cz + radiusChunksZ;
      cz++
    ) {
      const localCz = cz - origin.cz;
      if (localCz < 0 || localCz >= gridDims.z) continue;
      for (
        let cy = sourceChunk.cy - radiusChunksY;
        cy <= sourceChunk.cy + radiusChunksY;
        cy++
      ) {
        const localCy = cy - origin.cy;
        if (localCy < 0 || localCy >= gridDims.y) continue;
        for (
          let cx = sourceChunk.cx - radiusChunksX;
          cx <= sourceChunk.cx + radiusChunksX;
          cx++
        ) {
          const localCx = cx - origin.cx;
          if (localCx < 0 || localCx >= gridDims.x) continue;

          // Test against the NEAREST point in the chunk's world-space AABB
          // to the source, not its geometric center: a chunk can be far
          // larger than the vision radius (e.g. a 1024-unit chunk against a
          // 384-unit radius), in which case the center is routinely outside
          // both the radius and line of sight even while the source is
          // standing right at the chunk's edge. Clamping to the box gives
          // both a correct "is any part of this chunk in range" distance
          // test and a correct "can the source see into this chunk at all"
          // raycast target.
          const nearestX = Math.max(
            cx * chunkWorldX,
            Math.min(pos.x, (cx + 1) * chunkWorldX),
          );
          const nearestY = Math.max(
            cy * chunkWorldY,
            Math.min(pos.y, (cy + 1) * chunkWorldY),
          );
          const nearestZ = Math.max(
            cz * chunkWorldZ,
            Math.min(pos.z, (cz + 1) * chunkWorldZ),
          );
          const dx = nearestX - pos.x;
          const dy = nearestY - pos.y;
          const dz = nearestZ - pos.z;
          const nearestDist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (nearestDist >= outerWorld) continue;

          const destLocalCellX = nearestX / cellSize.x - originLocalCellX;
          const destLocalCellY = nearestY / cellSize.y - originLocalCellY;
          const destLocalCellZ = nearestZ / cellSize.z - originLocalCellZ;

          if (
            isRayBlockedTS(
              mask,
              cellDims,
              localSourceCellX,
              localSourceCellY,
              localSourceCellZ,
              destLocalCellX,
              destLocalCellY,
              destLocalCellZ,
            )
          ) {
            continue;
          }

          // Explored flag (unchanged binary channel -- LINEAR-filtered for a
          // smooth never-viewed/memory-tier blend, so it must stay a plain
          // scalar, not carry packed material data).
          CellMap.setChunkExplored(cellMap, cx, cy, cz);

          // Coarse per-chunk capture: always, for every explored chunk --
          // the representative material comes from the nearest visible cell
          // (the one the raycast above just confirmed is actually in LOS).
          // This is the far-tier fallback even for near chunks (a near
          // chunk's own individual cells may not all be captured yet).
          // Stored in a SEPARATE channel from the explored flag (see above).
          const nearestCellCoord = new Vector3D(
            Math.floor(nearestX / cellSize.x),
            Math.floor(nearestY / cellSize.y),
            Math.floor(nearestZ / cellSize.z),
          );
          const representativeMaterial = CellMap.getCellData(
            cellMap,
            nearestCellCoord,
          ).materialIndex;
          CellMap.setChunkFarMaterial(
            cellMap,
            cx,
            cy,
            cz,
            representativeMaterial,
          );

          if (nearestDist < nearThresholdWorld) {
            captureNearCellsInChunk(
              cellMap,
              mask,
              cellDims,
              originLocalCell,
              chunkSize,
              cellSize,
              cx,
              cy,
              cz,
              pos,
              outerWorld,
              {
                x: localSourceCellX,
                y: localSourceCellY,
                z: localSourceCellZ,
              },
            );
          }
        }
      }
    }
  }
}

/** Clears a disposed vision source's throttle-cache entry. */
export function clearExploredSweepCache(sourceId: number): void {
  _lastChunk.delete(sourceId);
}
