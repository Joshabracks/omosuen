import type { CellMapT } from './data';
import type { Mesh } from './types';
import {
  setMeshCellSize,
  setMeshSmoothing,
  setMeshMaterialWeights,
  setCustomShape,
  clearCustomShapes,
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

    // Per-material smoothing overrides: a material's `smoothness` (0-15) wins
    // over the per-cell/map weight; -1 means "no override". Cells of a harder
    // (lower-weight) type pin shared vertices so softer neighbors snap to them.
    const materialWeights = new Int32Array(cellMap.materials.length);
    for (let i = 0; i < cellMap.materials.length; i++) {
      const s = cellMap.materials[i].smoothness;
      materialWeights[i] =
        s === undefined ? -1 : Math.max(0, Math.min(15, Math.round(s)));
    }
    setMeshMaterialWeights(materialWeights);
  }

  // Upload custom cell meshes (shapeIndex >= 2) so the WASM mesher emits them
  // into the same vertex pool as cubes (smoothed/deduped together — no seams).
  // Indices 0 (air) and 1 (default cube) are built in; only 2+ are custom.
  // A non-empty mesh.uvs (one uv per vertex) enables UV texturing for that shape;
  // mesh.faceCover lets a side opt out of occluding its neighbor.
  clearCustomShapes();
  for (let i = 2; i < cellMap.meshes.length; i++) {
    const mesh = cellMap.meshes[i];
    if (mesh && mesh.indices.length > 0) {
      setCustomShape(
        i,
        mesh.vertices,
        mesh.indices,
        mesh.uvs,
        packFaceCover(mesh),
      );
    }
  }

  for (const chunk of cellMap.chunks) {
    if (!chunk.dirty) continue;
    const result = smoothed
      ? buildChunkMeshSmoothedWasm(chunk.cx, chunk.cy, chunk.cz)
      : buildChunkMeshWasm(chunk.cx, chunk.cy, chunk.cz);
    chunk.vertices = result.vertices;
    chunk.stride = result.stride;
    chunk.indices = result.indices;
    chunk.drawRanges = result.ranges;
    chunk.faceCount = result.indices ? result.indices.length / 6 : 0;
    chunk.dirty = false;
    chunk.gpuDirty = true;
  }
}

/**
 * Packs a mesh's optional `faceCover` into the 6-bit mask the WASM mesher expects,
 * in FACE_DIRS order [+Z, -Z, +Y, -Y, +X, -X]. Each side defaults to covered (1).
 */
function packFaceCover(mesh: Mesh): number {
  const fc = mesh.faceCover;
  if (!fc) return 0x3f;
  const bit = (v: boolean | undefined, shift: number): number =>
    (v === false ? 0 : 1) << shift;
  return (
    bit(fc.posZ, 0) |
    bit(fc.negZ, 1) |
    bit(fc.posY, 2) |
    bit(fc.negY, 3) |
    bit(fc.posX, 4) |
    bit(fc.negX, 5)
  );
}

/**
 * Marks chunks as dirty that contain or border the given WORLD cell
 * coordinate. Call when a cell is modified so its chunk mesh gets rebuilt.
 * No-ops if the coordinate is currently outside the window — that edit
 * already went through `CellWindow.setCell`'s cold-storage path instead of
 * the live store, so there's no resident chunk mesh to dirty. See
 * `.design/cell-map-overhaul/09-chunk-grid-and-dirty-marking.md`.
 */
export function markChunksDirty(
  cellMap: CellMapT,
  x: number,
  y: number,
  z: number,
): void {
  const { chunkGridSize, chunkSize, window } = cellMap;
  const origin = window.origin;
  if (!origin) return; // no window loaded yet

  const worldChunkX = Math.floor(x / chunkSize.x);
  const worldChunkY = Math.floor(y / chunkSize.y);
  const worldChunkZ = Math.floor(z / chunkSize.z);

  // Position within its chunk -- origin-independent, so compute this from
  // the world chunk coordinate before translating to window-local below.
  const localX = x - worldChunkX * chunkSize.x;
  const localY = y - worldChunkY * chunkSize.y;
  const localZ = z - worldChunkZ * chunkSize.z;

  // Window-local chunk-grid position (cmChunks is indexed by this, not by
  // world chunk coordinate -- see doc 09).
  const chunkX = worldChunkX - origin.cx;
  const chunkY = worldChunkY - origin.cy;
  const chunkZ = worldChunkZ - origin.cz;

  if (
    chunkX < 0 ||
    chunkX >= chunkGridSize.x ||
    chunkY < 0 ||
    chunkY >= chunkGridSize.y ||
    chunkZ < 0 ||
    chunkZ >= chunkGridSize.z
  ) {
    return; // outside the current window
  }

  markSingleChunkDirty(cellMap, chunkX, chunkY, chunkZ);

  // Mark adjacent chunks if cell is on a chunk boundary
  // (face culling depends on cross-chunk neighbors)
  if (localX === 0 && chunkX > 0)
    markSingleChunkDirty(cellMap, chunkX - 1, chunkY, chunkZ);
  if (localX === chunkSize.x - 1 && chunkX < chunkGridSize.x - 1)
    markSingleChunkDirty(cellMap, chunkX + 1, chunkY, chunkZ);
  if (localY === 0 && chunkY > 0)
    markSingleChunkDirty(cellMap, chunkX, chunkY - 1, chunkZ);
  if (localY === chunkSize.y - 1 && chunkY < chunkGridSize.y - 1)
    markSingleChunkDirty(cellMap, chunkX, chunkY + 1, chunkZ);
  if (localZ === 0 && chunkZ > 0)
    markSingleChunkDirty(cellMap, chunkX, chunkY, chunkZ - 1);
  if (localZ === chunkSize.z - 1 && chunkZ < chunkGridSize.z - 1)
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
