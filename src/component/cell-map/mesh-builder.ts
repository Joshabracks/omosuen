import { Array3D } from '../../math';
import type { CellMapT } from './data';
import { ChunkMesh, DrawRange, CHUNK_SIZE, unpackCell } from './types';
import { setMeshMap, buildChunkMeshWasm } from '../camera/render/wasm';

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
 * Record for a visible face quad used by the smoothed mesh builder.
 */
interface FaceRecord {
  vertexKeys: string[]; // 4 position keys
  materialIndex: number;
  normal: [number, number, number];
  isInterior: boolean; // true if face cell is inside chunk bounds
}

/**
 * Writes a quad (4 vertices, 2 triangles) into the vertex and index buffers.
 * Each vertex is 9 floats: [px, py, pz, nx, ny, nz, opx, opy, opz].
 * normals/origPositions length 1 = broadcast to all 4 vertices, length 4 = per-vertex.
 */
function emitQuad(
  vertexFloats: number[],
  indexInts: number[],
  positions: [number, number, number][],
  normals: [number, number, number][],
  origPositions: [number, number, number][],
): void {
  const base = vertexFloats.length / 9;
  const n0 = normals[0];
  const o0 = origPositions[0];
  for (let i = 0; i < 4; i++) {
    const p = positions[i];
    const n = normals.length > 1 ? normals[i] : n0;
    const o = origPositions.length > 1 ? origPositions[i] : o0;
    vertexFloats.push(p[0], p[1], p[2], n[0], n[1], n[2], o[0], o[1], o[2]);
  }
  indexInts.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/**
 * Laplacian smoothing with vertex constraining.
 * Each vertex is iteratively relaxed toward the average of its neighbors,
 * weighted by the vertex's smoothing weight, then clamped within ±halfCellSize
 * of its original grid position.
 */
function smoothVertices(
  positions: [number, number, number][],
  originalPositions: [number, number, number][],
  adjacency: Set<number>[],
  weights: number[],
  iterations: number,
  halfCellSize: [number, number, number],
): void {
  const lambda = 0.5;
  const newPositions: [number, number, number][] = positions.map(
    (p) => [p[0], p[1], p[2]] as [number, number, number],
  );

  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < positions.length; i++) {
      const w = weights[i];
      const neighbors = adjacency[i];
      if (w === 0 || neighbors.size === 0) {
        newPositions[i][0] = positions[i][0];
        newPositions[i][1] = positions[i][1];
        newPositions[i][2] = positions[i][2];
        continue;
      }

      // Average neighbor positions
      let avgX = 0,
        avgY = 0,
        avgZ = 0;
      for (const ni of neighbors) {
        avgX += positions[ni][0];
        avgY += positions[ni][1];
        avgZ += positions[ni][2];
      }
      const count = neighbors.size;
      avgX /= count;
      avgY /= count;
      avgZ /= count;

      // Lerp toward average
      const t = w * lambda;
      let nx = positions[i][0] + (avgX - positions[i][0]) * t;
      let ny = positions[i][1] + (avgY - positions[i][1]) * t;
      let nz = positions[i][2] + (avgZ - positions[i][2]) * t;

      // Constrain: clamp to ±halfCell of original position
      const ox = originalPositions[i][0];
      const oy = originalPositions[i][1];
      const oz = originalPositions[i][2];
      nx = Math.max(ox - halfCellSize[0], Math.min(ox + halfCellSize[0], nx));
      ny = Math.max(oy - halfCellSize[1], Math.min(oy + halfCellSize[1], ny));
      nz = Math.max(oz - halfCellSize[2], Math.min(oz + halfCellSize[2], nz));

      newPositions[i][0] = nx;
      newPositions[i][1] = ny;
      newPositions[i][2] = nz;
    }

    // Swap: copy newPositions into positions for next iteration
    for (let i = 0; i < positions.length; i++) {
      positions[i][0] = newPositions[i][0];
      positions[i][1] = newPositions[i][1];
      positions[i][2] = newPositions[i][2];
    }
  }
}

/**
 * Computes smooth per-vertex normals by accumulating face normals (cross product)
 * onto each vertex, then normalizing.
 */
function computeSmoothNormals(
  faces: FaceRecord[],
  positions: [number, number, number][],
  vertexKeyToIndex: Map<string, number>,
  vertexCount: number,
): [number, number, number][] {
  const vertexNormals: [number, number, number][] = new Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    vertexNormals[i] = [0, 0, 0];
  }

  for (const face of faces) {
    const indices = face.vertexKeys.map((k) => vertexKeyToIndex.get(k)!);
    const p0 = positions[indices[0]];
    const p1 = positions[indices[1]];
    const p2 = positions[indices[2]];

    const e1x = p1[0] - p0[0],
      e1y = p1[1] - p0[1],
      e1z = p1[2] - p0[2];
    const e2x = p2[0] - p0[0],
      e2y = p2[1] - p0[1],
      e2z = p2[2] - p0[2];
    const fnx = e1y * e2z - e1z * e2y;
    const fny = e1z * e2x - e1x * e2z;
    const fnz = e1x * e2y - e1y * e2x;

    for (const idx of indices) {
      vertexNormals[idx][0] += fnx;
      vertexNormals[idx][1] += fny;
      vertexNormals[idx][2] += fnz;
    }
  }

  for (const vn of vertexNormals) {
    const len = Math.sqrt(vn[0] * vn[0] + vn[1] * vn[1] + vn[2] * vn[2]);
    if (len > 0) {
      vn[0] /= len;
      vn[1] /= len;
      vn[2] /= len;
    }
  }

  return vertexNormals;
}

/**
 * Builds the mesh for a single chunk with hidden face culling and greedy meshing.
 * Indices are grouped by material for efficient multi-material rendering.
 * When smoothing > 0, delegates to buildSmoothedChunkMesh instead.
 */
export function buildChunkMesh(
  cellMap: CellMapT,
  chunk: ChunkMesh,
  expanded: Array3D<number>,
  expandedWeights: Array3D<number> | null,
): void {
  if (cellMap.smoothing > 0 && expandedWeights) {
    buildSmoothedChunkMesh(cellMap, chunk, expanded, expandedWeights);
    return;
  }
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

    emitQuad(vertexFloats, indexInts, quad.verts, [quad.normal], quad.verts);
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
 * Builds a smoothed chunk mesh using Laplacian relaxation (surface-net style).
 * Skips greedy meshing — emits individual quads with smoothed vertex positions
 * and smooth per-vertex normals.
 *
 * Includes a 1-cell overlap zone beyond chunk boundaries so vertices on chunk
 * edges have correct adjacency from neighboring cells (seamless chunk borders).
 */
function buildSmoothedChunkMesh(
  cellMap: CellMapT,
  chunk: ChunkMesh,
  expanded: Array3D<number>,
  expandedWeights: Array3D<number>,
): void {
  const { cx, cy, cz } = chunk;
  const mapSizeX = cellMap.mapSize.x;
  const mapSizeY = cellMap.mapSize.y;
  const mapSizeZ = cellMap.mapSize.z;
  const cellSizeX = cellMap.cellSize.x;
  const cellSizeY = cellMap.cellSize.y;
  const cellSizeZ = cellMap.cellSize.z;
  const cellSizes = [cellSizeX, cellSizeY, cellSizeZ];

  // Chunk cell range (actual chunk bounds)
  const chunkStartX = cx * CHUNK_SIZE;
  const chunkStartY = cy * CHUNK_SIZE;
  const chunkStartZ = cz * CHUNK_SIZE;
  const chunkEndX = Math.min(chunkStartX + CHUNK_SIZE, mapSizeX);
  const chunkEndY = Math.min(chunkStartY + CHUNK_SIZE, mapSizeY);
  const chunkEndZ = Math.min(chunkStartZ + CHUNK_SIZE, mapSizeZ);

  // Overlap must cover the smoothing influence radius so adjacent chunks
  // compute identical positions for shared boundary vertices.
  const overlap = Math.min(cellMap.smoothing, CHUNK_SIZE);
  const overlapStartX = Math.max(0, chunkStartX - overlap);
  const overlapStartY = Math.max(0, chunkStartY - overlap);
  const overlapStartZ = Math.max(0, chunkStartZ - overlap);
  const overlapEndX = Math.min(mapSizeX, chunkEndX + overlap);
  const overlapEndY = Math.min(mapSizeY, chunkEndY + overlap);
  const overlapEndZ = Math.min(mapSizeZ, chunkEndZ + overlap);

  const strideY = mapSizeX;
  const strideZ = mapSizeX * mapSizeY;

  // ── Phase 1: Collect visible faces (individual quads, no greedy merging) ──

  const faces: FaceRecord[] = [];

  // Vertex dedup map: posKey → index into uniqueVertices
  const vertexKeyToIndex = new Map<string, number>();
  const uniquePositions: [number, number, number][] = [];
  const originalPositions: [number, number, number][] = [];
  const vertexWeightSums: number[] = [];
  const vertexWeightCounts: number[] = [];
  const adjacency: Set<number>[] = [];

  function getOrCreateVertex(
    px: number,
    py: number,
    pz: number,
  ): [string, number] {
    const key = `${px},${py},${pz}`;
    let idx = vertexKeyToIndex.get(key);
    if (idx === undefined) {
      idx = uniquePositions.length;
      vertexKeyToIndex.set(key, idx);
      uniquePositions.push([px, py, pz]);
      originalPositions.push([px, py, pz]);
      vertexWeightSums.push(0);
      vertexWeightCounts.push(0);
      adjacency.push(new Set());
    }
    return [key, idx];
  }

  // Scan the overlap zone for visible faces
  for (let z = overlapStartZ; z < overlapEndZ; z++) {
    for (let y = overlapStartY; y < overlapEndY; y++) {
      for (let x = overlapStartX; x < overlapEndX; x++) {
        const cellIndex = z * strideZ + y * strideY + x;
        const packed = expanded.value[cellIndex];
        const cell = unpackCell(packed);

        if (!cell.visible || cell.shapeIndex === 0) continue;

        // Get this cell's smoothing weight (0-15)
        const cellWeight = expandedWeights.value[cellIndex];

        const isInterior =
          x >= chunkStartX &&
          x < chunkEndX &&
          y >= chunkStartY &&
          y < chunkEndY &&
          z >= chunkStartZ &&
          z < chunkEndZ;

        // Check each face direction
        for (let faceDir = 0; faceDir < 6; faceDir++) {
          const dir = FACE_DIRS[faceDir];
          const config = FACE_CONFIGS[faceDir];
          const { uAxis, vAxis, nAxis } = config;

          const neighborX = x + dir.dx;
          const neighborY = y + dir.dy;
          const neighborZ = z + dir.dz;

          // Face visible if neighbor is out of bounds or non-solid
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

          if (neighborSolid) continue;

          // Emit individual quad (no greedy merging)
          const baseCoords = [x, y, z];
          const vertexKeys: string[] = [];
          const vertexIndices: number[] = [];

          for (const [du, dv, dn] of config.quadVertices) {
            const pos: [number, number, number] = [0, 0, 0];
            pos[uAxis] = (baseCoords[uAxis] + du) * cellSizes[uAxis];
            pos[vAxis] = (baseCoords[vAxis] + dv) * cellSizes[vAxis];
            pos[nAxis] = (baseCoords[nAxis] + dn) * cellSizes[nAxis];
            const [key, idx] = getOrCreateVertex(pos[0], pos[1], pos[2]);
            vertexKeys.push(key);
            vertexIndices.push(idx);

            // Accumulate weight from this cell to the vertex
            vertexWeightSums[idx] += cellWeight;
            vertexWeightCounts[idx]++;
          }

          // Build adjacency from face edges: v0↔v1, v1↔v2, v2↔v3, v3↔v0
          for (let e = 0; e < 4; e++) {
            const a = vertexIndices[e];
            const b = vertexIndices[(e + 1) % 4];
            adjacency[a].add(b);
            adjacency[b].add(a);
          }

          faces.push({
            vertexKeys,
            materialIndex: cell.materialIndex,
            normal: [dir.nx, dir.ny, dir.nz],
            isInterior,
          });
        }
      }
    }
  }

  // ── Phase 2: Compute per-vertex weights (average of contributing cells) ──

  const vertexWeights: number[] = new Array(uniquePositions.length);
  for (let i = 0; i < uniquePositions.length; i++) {
    const count = vertexWeightCounts[i];
    const avg = count > 0 ? vertexWeightSums[i] / count : 0;
    vertexWeights[i] = avg / 15.0; // Map 0-15 → 0.0-1.0
  }

  // ── Phase 3: Iterative Laplacian smoothing ──

  smoothVertices(
    uniquePositions,
    originalPositions,
    adjacency,
    vertexWeights,
    cellMap.smoothing,
    [cellSizeX * 0.5, cellSizeY * 0.5, cellSizeZ * 0.5],
  );

  // ── Phase 4: Recompute normals from smoothed face geometry ──

  const normalSmoothing = cellMap.normalSmoothing;
  const vertexNormals =
    normalSmoothing > 0
      ? computeSmoothNormals(
          faces,
          uniquePositions,
          vertexKeyToIndex,
          uniquePositions.length,
        )
      : null;

  // ── Phase 5: Emit mesh data (interior faces only) ──

  const interiorFaces = faces.filter((f) => f.isInterior);
  interiorFaces.sort((a, b) => a.materialIndex - b.materialIndex);

  const vertexFloats: number[] = [];
  const indexInts: number[] = [];
  const ranges: DrawRange[] = [];
  let currentMaterial = -1;
  let currentRange: DrawRange | null = null;

  for (const face of interiorFaces) {
    if (face.materialIndex !== currentMaterial) {
      currentMaterial = face.materialIndex;
      currentRange = {
        materialIndex: currentMaterial,
        indexOffset: indexInts.length,
        indexCount: 0,
      };
      ranges.push(currentRange);
    }

    const indices = face.vertexKeys.map((k) => vertexKeyToIndex.get(k)!);

    // Compute flat face normal from smoothed geometry
    const p0 = uniquePositions[indices[0]];
    const p1 = uniquePositions[indices[1]];
    const p2 = uniquePositions[indices[2]];
    const e1x = p1[0] - p0[0],
      e1y = p1[1] - p0[1],
      e1z = p1[2] - p0[2];
    const e2x = p2[0] - p0[0],
      e2y = p2[1] - p0[1],
      e2z = p2[2] - p0[2];
    let fnx = e1y * e2z - e1z * e2y;
    let fny = e1z * e2x - e1x * e2z;
    let fnz = e1x * e2y - e1y * e2x;
    const fLen = Math.sqrt(fnx * fnx + fny * fny + fnz * fnz);
    if (fLen > 0) {
      fnx /= fLen;
      fny /= fLen;
      fnz /= fLen;
    }

    // Build per-vertex positions, normals, and original positions
    const quadPositions: [number, number, number][] = [];
    const quadNormals: [number, number, number][] = [];
    const quadOrigPositions: [number, number, number][] = [];
    for (const idx of indices) {
      quadPositions.push(uniquePositions[idx]);
      quadOrigPositions.push(originalPositions[idx]);
      if (!vertexNormals || normalSmoothing === 0) {
        quadNormals.push([fnx, fny, fnz]);
      } else if (normalSmoothing === 1) {
        const sn = vertexNormals[idx];
        quadNormals.push([sn[0], sn[1], sn[2]]);
      } else {
        const sn = vertexNormals[idx];
        const t = normalSmoothing;
        let nx = fnx + (sn[0] - fnx) * t;
        let ny = fny + (sn[1] - fny) * t;
        let nz = fnz + (sn[2] - fnz) * t;
        const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (nLen > 0) {
          nx /= nLen;
          ny /= nLen;
          nz /= nLen;
        }
        quadNormals.push([nx, ny, nz]);
      }
    }

    emitQuad(
      vertexFloats,
      indexInts,
      quadPositions,
      quadNormals,
      quadOrigPositions,
    );
    currentRange!.indexCount += 6;
  }

  // Update chunk
  chunk.vertices =
    vertexFloats.length > 0 ? new Float32Array(vertexFloats) : null;
  chunk.indices = indexInts.length > 0 ? new Uint32Array(indexInts) : null;
  chunk.drawRanges = ranges;
  chunk.faceCount = interiorFaces.length;
  chunk.dirty = false;
}

/**
 * Rebuilds all dirty chunks in a cell map.
 * Call this before rendering when any chunks are dirty.
 */
export function rebuildDirtyChunks(cellMap: CellMapT): void {
  const hasDirty = cellMap.chunks.some((c) => c.dirty);
  if (!hasDirty) return;

  // Expand packed data once for O(1) random access during mesh building.
  // (expand() is still JS-side; it moves into WASM with the canonical store in
  // render-crate step 3.)
  const expanded = cellMap.packedData.expand();

  if (cellMap.smoothing > 0) {
    // Smoothed meshing still runs in JS — WASM port is step 2b. This is a
    // per-cell-map feature split (by smoothing), not a runtime fallback.
    const expandedWeights = cellMap.smoothingWeights.expand();
    for (const chunk of cellMap.chunks) {
      if (!chunk.dirty) continue;
      buildSmoothedChunkMesh(cellMap, chunk, expanded, expandedWeights);
    }
    return;
  }

  // Greedy (non-smoothed) meshing runs in WASM (omosuen-render). Upload the map
  // once, then build each dirty chunk.
  const total = cellMap.mapSize.x * cellMap.mapSize.y * cellMap.mapSize.z;
  setMeshMap(
    expanded.value,
    total,
    cellMap.mapSize.x,
    cellMap.mapSize.y,
    cellMap.mapSize.z,
    cellMap.cellSize.x,
    cellMap.cellSize.y,
    cellMap.cellSize.z,
  );
  for (const chunk of cellMap.chunks) {
    if (!chunk.dirty) continue;
    const result = buildChunkMeshWasm(chunk.cx, chunk.cy, chunk.cz);
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
