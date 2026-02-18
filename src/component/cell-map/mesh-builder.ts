import { Array3D } from '../../math';
import { CellMapT } from './data';
import { ChunkMesh, DrawRange, CHUNK_SIZE, unpackCell } from './types';

/**
 * Face directions with their normal vectors and neighbor offsets.
 * Order: front(+Z), back(-Z), top(+Y), bottom(-Y), right(+X), left(-X)
 */
const FACE_DIRS = [
  { nx: 0, ny: 0, nz: 1, dx: 0, dy: 0, dz: 1 }, // Front  (+Z)
  { nx: 0, ny: 0, nz: -1, dx: 0, dy: 0, dz: -1 }, // Back   (-Z)
  { nx: 0, ny: 1, nz: 0, dx: 0, dy: 1, dz: 0 }, // Top    (+Y)
  { nx: 0, ny: -1, nz: 0, dx: 0, dy: -1, dz: 0 }, // Bottom (-Y)
  { nx: 1, ny: 0, nz: 0, dx: 1, dy: 0, dz: 0 }, // Right  (+X)
  { nx: -1, ny: 0, nz: 0, dx: -1, dy: 0, dz: 0 }, // Left   (-X)
] as const;

/**
 * Per-face configuration for greedy meshing sweep axes and quad vertex offsets.
 * uAxis/vAxis = axes in the sweep plane, nAxis = face normal axis.
 * quadVertices = 4 corner offsets [du, dv, dn] in CCW winding from outside.
 */
interface FaceConfig {
  uAxis: 0 | 1 | 2;
  vAxis: 0 | 1 | 2;
  nAxis: 0 | 1 | 2;
  nOffset: number;
  quadVertices: [number, number, number][];
}

const FACE_CONFIGS: FaceConfig[] = [
  // Front (+Z): face at z+1, sweep XY
  {
    uAxis: 0,
    vAxis: 1,
    nAxis: 2,
    nOffset: 1,
    quadVertices: [
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
    ],
  },
  // Back (-Z): face at z, sweep XY
  {
    uAxis: 0,
    vAxis: 1,
    nAxis: 2,
    nOffset: 0,
    quadVertices: [
      [1, 0, 0],
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
    ],
  },
  // Top (+Y): face at y+1, sweep XZ — [du,dv,dn] where u=X,v=Z,n=Y
  {
    uAxis: 0,
    vAxis: 2,
    nAxis: 1,
    nOffset: 1,
    quadVertices: [
      [0, 0, 1],
      [0, 1, 1],
      [1, 1, 1],
      [1, 0, 1],
    ],
  },
  // Bottom (-Y): face at y, sweep XZ — [du,dv,dn] where u=X,v=Z,n=Y
  {
    uAxis: 0,
    vAxis: 2,
    nAxis: 1,
    nOffset: 0,
    quadVertices: [
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
      [0, 0, 0],
    ],
  },
  // Right (+X): face at x+1, sweep ZY — [du,dv,dn] where u=Z,v=Y,n=X
  {
    uAxis: 2,
    vAxis: 1,
    nAxis: 0,
    nOffset: 1,
    quadVertices: [
      [0, 1, 1],
      [1, 1, 1],
      [1, 0, 1],
      [0, 0, 1],
    ],
  },
  // Left (-X): face at x, sweep ZY — [du,dv,dn] where u=Z,v=Y,n=X
  {
    uAxis: 2,
    vAxis: 1,
    nAxis: 0,
    nOffset: 0,
    quadVertices: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
    ],
  },
];

/**
 * Builds the mesh for a single chunk with hidden face culling and greedy meshing.
 * Indices are grouped by material for efficient multi-material rendering.
 */
function buildChunkMesh(
  cellMap: CellMapT,
  chunk: ChunkMesh,
  expanded: Array3D<number>,
): void {
  const { cx, cy, cz } = chunk;
  const mapSizeX = cellMap.mapSize.x;
  const mapSizeY = cellMap.mapSize.y;
  const mapSizeZ = cellMap.mapSize.z;
  const cellSizeX = cellMap.cellSize.x;
  const cellSizeY = cellMap.cellSize.y;
  const cellSizeZ = cellMap.cellSize.z;
  const cellSizes = [cellSizeX, cellSizeY, cellSizeZ];

  // Cell coordinate range for this chunk (clamped to map bounds)
  const startX = cx * CHUNK_SIZE;
  const startY = cy * CHUNK_SIZE;
  const startZ = cz * CHUNK_SIZE;
  const endX = Math.min(startX + CHUNK_SIZE, mapSizeX);
  const endY = Math.min(startY + CHUNK_SIZE, mapSizeY);
  const endZ = Math.min(startZ + CHUNK_SIZE, mapSizeZ);
  const chunkW = endX - startX;
  const chunkH = endY - startY;
  const chunkD = endZ - startZ;

  const strideY = mapSizeX;
  const strideZ = mapSizeX * mapSizeY;

  // Collect greedy-merged quads tagged with their material
  const quads: {
    materialIndex: number;
    verts: [number, number, number][];
    normal: [number, number, number];
  }[] = [];

  // Process each face direction
  for (let faceDir = 0; faceDir < 6; faceDir++) {
    const dir = FACE_DIRS[faceDir];
    const config = FACE_CONFIGS[faceDir];
    const { uAxis, vAxis, nAxis } = config;

    const sliceStarts = [startX, startY, startZ];
    const sliceEnds = [endX, endY, endZ];
    const sliceDims = [chunkW, chunkH, chunkD];

    const nStart = sliceStarts[nAxis];
    const nEnd = sliceEnds[nAxis];
    const uSize = sliceDims[uAxis];
    const vSize = sliceDims[vAxis];
    const uStart = sliceStarts[uAxis];
    const vStart = sliceStarts[vAxis];

    // For each slice perpendicular to this face's normal
    for (let n = nStart; n < nEnd; n++) {
      // Build 2D mask: materialIndex for cells needing this face, -1 otherwise
      const mask = new Int32Array(uSize * vSize);
      mask.fill(-1);

      for (let v = 0; v < vSize; v++) {
        for (let u = 0; u < uSize; u++) {
          const coords = [0, 0, 0];
          coords[uAxis] = uStart + u;
          coords[vAxis] = vStart + v;
          coords[nAxis] = n;

          const cellIndex =
            coords[2] * strideZ + coords[1] * strideY + coords[0];
          const packed = expanded.value[cellIndex];
          const cell = unpackCell(packed);

          // Skip air or invisible cells
          if (!cell.visible || cell.shapeIndex === 0) continue;

          // Check neighbor — face is visible if neighbor is out of bounds or non-solid
          const neighborX = coords[0] + dir.dx;
          const neighborY = coords[1] + dir.dy;
          const neighborZ = coords[2] + dir.dz;

          let neighborSolid = false;
          if (
            neighborX >= 0 &&
            neighborX < mapSizeX &&
            neighborY >= 0 &&
            neighborY < mapSizeY &&
            neighborZ >= 0 &&
            neighborZ < mapSizeZ
          ) {
            const neighborPacked =
              expanded.value[
                neighborZ * strideZ + neighborY * strideY + neighborX
              ];
            const neighbor = unpackCell(neighborPacked);
            neighborSolid = neighbor.visible && neighbor.shapeIndex !== 0;
          }

          if (!neighborSolid) {
            mask[v * uSize + u] = cell.materialIndex;
          }
        }
      }

      // Greedy meshing: merge adjacent faces with the same material
      const visited = new Uint8Array(uSize * vSize);

      for (let v = 0; v < vSize; v++) {
        for (let u = 0; u < uSize; u++) {
          const maskIdx = v * uSize + u;
          if (visited[maskIdx] || mask[maskIdx] === -1) continue;

          const matIndex = mask[maskIdx];

          // Extend width along u axis
          let width = 1;
          while (
            u + width < uSize &&
            !visited[v * uSize + u + width] &&
            mask[v * uSize + u + width] === matIndex
          ) {
            width++;
          }

          // Extend height along v axis
          let height = 1;
          let canExtend = true;
          while (canExtend && v + height < vSize) {
            for (let du = 0; du < width; du++) {
              const checkIdx = (v + height) * uSize + u + du;
              if (visited[checkIdx] || mask[checkIdx] !== matIndex) {
                canExtend = false;
                break;
              }
            }
            if (canExtend) height++;
          }

          // Mark visited
          for (let dv = 0; dv < height; dv++) {
            for (let du = 0; du < width; du++) {
              visited[(v + dv) * uSize + u + du] = 1;
            }
          }

          // Emit quad vertices in world space
          const baseCoords = [0, 0, 0];
          baseCoords[uAxis] = uStart + u;
          baseCoords[vAxis] = vStart + v;
          baseCoords[nAxis] = n;

          const verts: [number, number, number][] = [];
          for (const [du, dv, dn] of config.quadVertices) {
            const pos: [number, number, number] = [0, 0, 0];
            pos[uAxis] = (baseCoords[uAxis] + du * width) * cellSizes[uAxis];
            pos[vAxis] = (baseCoords[vAxis] + dv * height) * cellSizes[vAxis];
            pos[nAxis] = (baseCoords[nAxis] + dn) * cellSizes[nAxis];
            verts.push(pos);
          }

          quads.push({
            materialIndex: matIndex,
            verts,
            normal: [dir.nx, dir.ny, dir.nz],
          });
        }
      }
    }
  }

  // Sort quads by material for contiguous draw ranges
  quads.sort((a, b) => a.materialIndex - b.materialIndex);

  // Build vertex buffer (interleaved pos+normal) and index buffer
  const vertexFloats: number[] = [];
  const indexInts: number[] = [];
  const ranges: DrawRange[] = [];
  let currentMaterial = -1;
  let currentRange: DrawRange | null = null;

  for (const quad of quads) {
    if (quad.materialIndex !== currentMaterial) {
      currentMaterial = quad.materialIndex;
      currentRange = {
        materialIndex: currentMaterial,
        indexOffset: indexInts.length,
        indexCount: 0,
      };
      ranges.push(currentRange);
    }

    const vertexBase = vertexFloats.length / 6;

    for (const [px, py, pz] of quad.verts) {
      vertexFloats.push(
        px,
        py,
        pz,
        quad.normal[0],
        quad.normal[1],
        quad.normal[2],
      );
    }

    // Two CCW triangles: 0-1-2, 0-2-3
    indexInts.push(
      vertexBase,
      vertexBase + 1,
      vertexBase + 2,
      vertexBase,
      vertexBase + 2,
      vertexBase + 3,
    );

    currentRange!.indexCount += 6;
  }

  // Update chunk
  chunk.vertices =
    vertexFloats.length > 0 ? new Float32Array(vertexFloats) : null;
  chunk.indices = indexInts.length > 0 ? new Uint32Array(indexInts) : null;
  chunk.drawRanges = ranges;
  chunk.faceCount = quads.length;
  chunk.dirty = false;
}

/**
 * Rebuilds all dirty chunks in a cell map.
 * Call this before rendering when any chunks are dirty.
 */
export function rebuildDirtyChunks(cellMap: CellMapT): void {
  const hasDirty = cellMap.chunks.some((c) => c.dirty);
  if (!hasDirty) return;

  // Expand packed data once for O(1) random access during mesh building
  const expanded = cellMap.packedData.expand();

  for (const chunk of cellMap.chunks) {
    if (!chunk.dirty) continue;
    buildChunkMesh(cellMap, chunk, expanded);
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
