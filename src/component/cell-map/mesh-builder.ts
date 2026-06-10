import type { CellMapT } from './data';
import { CHUNK_SIZE } from './types';
import {
  setMeshCellSize,
  setMeshSmoothing,
  buildChunkMeshWasm,
  buildChunkMeshSmoothedWasm,
} from '../camera/render/wasm';

/**
 * Rebuilds all dirty chunks in a cell map via the render WASM module
 * (`omosuen-render`). Both greedy meshing (smoothing == 0) and smoothed /
 * Laplacian meshing (smoothing > 0) run in WASM — single source of truth, no JS
 * fallback. Call before rendering when any chunks are dirty.
 */
export function rebuildDirtyChunks(cellMap: CellMapT): void {
  const hasDirty = cellMap.chunks.some((c) => c.dirty);
  if (!hasDirty) return;

  // The packed cells are resident in the canonical WASM store (mutated via
  // setCellData), so there is no upload/expand here — just set the cell size,
  // and the smoothing inputs when smoothing is enabled.
  setMeshCellSize(cellMap.cellSize.x, cellMap.cellSize.y, cellMap.cellSize.z);

  const smoothed = cellMap.smoothing > 0;
  if (smoothed) {
    const weights = cellMap.smoothingWeights.expand();
    const total = cellMap.mapSize.x * cellMap.mapSize.y * cellMap.mapSize.z;
    setMeshSmoothing(
      weights.value,
      total,
      cellMap.smoothing,
      cellMap.normalSmoothing,
    );
  }

  for (const chunk of cellMap.chunks) {
    if (!chunk.dirty) continue;
    const result = smoothed
      ? buildChunkMeshSmoothedWasm(chunk.cx, chunk.cy, chunk.cz)
      : buildChunkMeshWasm(chunk.cx, chunk.cy, chunk.cz);
    chunk.vertices = result.vertices;
    chunk.indices = result.indices;
    chunk.drawRanges = result.ranges;
    chunk.faceCount = result.indices ? result.indices.length / 6 : 0;
    chunk.dirty = false;
  }
}

/**
 * Marks chunks as dirty that contain or border the given cell coordinate.
 * Call when a cell is modified so its chunk mesh gets rebuilt.
 */
export function markChunksDirty(
  cellMap: CellMapT,
  x: number,
  y: number,
  z: number,
): void {
  const { chunkGridSize } = cellMap;
  const chunkX = Math.floor(x / CHUNK_SIZE);
  const chunkY = Math.floor(y / CHUNK_SIZE);
  const chunkZ = Math.floor(z / CHUNK_SIZE);

  markSingleChunkDirty(cellMap, chunkX, chunkY, chunkZ);

  // Mark adjacent chunks if cell is on a chunk boundary
  // (face culling depends on cross-chunk neighbors)
  const localX = x - chunkX * CHUNK_SIZE;
  const localY = y - chunkY * CHUNK_SIZE;
  const localZ = z - chunkZ * CHUNK_SIZE;

  if (localX === 0 && chunkX > 0)
    markSingleChunkDirty(cellMap, chunkX - 1, chunkY, chunkZ);
  if (localX === CHUNK_SIZE - 1 && chunkX < chunkGridSize.x - 1)
    markSingleChunkDirty(cellMap, chunkX + 1, chunkY, chunkZ);
  if (localY === 0 && chunkY > 0)
    markSingleChunkDirty(cellMap, chunkX, chunkY - 1, chunkZ);
  if (localY === CHUNK_SIZE - 1 && chunkY < chunkGridSize.y - 1)
    markSingleChunkDirty(cellMap, chunkX, chunkY + 1, chunkZ);
  if (localZ === 0 && chunkZ > 0)
    markSingleChunkDirty(cellMap, chunkX, chunkY, chunkZ - 1);
  if (localZ === CHUNK_SIZE - 1 && chunkZ < chunkGridSize.z - 1)
    markSingleChunkDirty(cellMap, chunkX, chunkY, chunkZ + 1);
}

function markSingleChunkDirty(
  cellMap: CellMapT,
  cx: number,
  cy: number,
  cz: number,
): void {
  const { chunkGridSize } = cellMap;
  const index =
    cz * chunkGridSize.y * chunkGridSize.x + cy * chunkGridSize.x + cx;
  if (index >= 0 && index < cellMap.chunks.length) {
    cellMap.chunks[index].dirty = true;
  }
}
