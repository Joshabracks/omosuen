import { ComponentData, ComponentOptions } from '../base';
import { Array3D, Array3Dc, Array3Di, Vector3D } from '../../math';
import {
  Material,
  Mesh,
  ChunkMesh,
  packCell,
  createDefaultCellData,
  CHUNK_SIZE,
} from './types';

export interface CellMapOptions extends ComponentOptions {
  /**
   * Array of material definitions (required)
   * Each material references 4 TextureMap component IDs
   */
  materials: Material[];

  /**
   * Map of material indices per cell (required)
   * Must match mapSize dimensions
   */
  materialMap: Array3D<number>;

  /**
   * Map of shape indices per cell (optional)
   * 0 = air/empty, 1 = default cube
   * Defaults to 1 (cube) everywhere if not provided
   */
  shapeMap?: Array3D<number>;

  /**
   * Array of custom mesh definitions (optional)
   * Index 0 = reserved for air
   * Index 1 = default cube (auto-generated if not provided)
   */
  meshes?: Mesh[];

  /**
   * Map of emission intensity per cell (optional, 0-31)
   * Defaults to 0 everywhere if not provided
   */
  emissionMap?: Array3D<number>;

  /**
   * Map of visibility flags per cell (optional)
   * Defaults to true everywhere if not provided
   */
  visibilityMap?: Array3D<boolean>;

  /**
   * Size of a single cell (width, depth, height)
   */
  cellSize: Vector3D;

  /**
   * Dimensions of the map in cells (width, depth, height)
   */
  mapSize: Vector3D;

  /**
   * Number of surface-net smoothing iterations (0 or less = no smoothing)
   */
  smoothing?: number;

  /**
   * Per-cell smoothing weights (0-15, mapped to 0.0-1.0 internally).
   * - number: uniform weight for all cells (default 8)
   * - Array3D<number>: per-cell weights, stored as Array3Di(bitWidth:8, packing:[4,4], overflow:clamp)
   */
  smoothingWeights?: number | Array3D<number>;

  /**
   * Normal smoothing weight (0-1). 0 = flat per-face normals (default),
   * 1 = fully averaged per-vertex normals, values in between lerp.
   */
  normalSmoothing?: number;

  /** If true, this cell-map is exempt from Y-slice reveal clipping (default: false) */
  revealExempt?: boolean;
}

export interface CellMapT extends ComponentData {
  type: 'cell-map';

  // Material definitions
  materials: Material[];

  // Input maps (preserved for reference)
  materialMap: Array3D<number>;
  shapeMap: Array3D<number>;
  meshes: Mesh[];
  emissionMap: Array3D<number>;
  visibilityMap: Array3D<boolean>;

  // World configuration
  cellSize: Vector3D;
  mapSize: Vector3D;

  // Compressed storage
  packedData: Array3Dc<number>;

  // Smoothing
  smoothing: number;
  smoothingWeights: Array3Di;
  normalSmoothing: number;

  // GPU sync
  needsGPUUpdate: boolean;

  // Chunk-based rendering
  chunks: ChunkMesh[];
  chunkGridSize: { x: number; y: number; z: number };

  /** If true, this cell-map is exempt from Y-slice reveal clipping. Default: false */
  revealExempt: boolean;
}

/**
 * Generates a default cube mesh with unit dimensions
 * Centered at origin, 24 vertices (4 per face for proper normals/UVs)
 */
export function generateDefaultCubeMesh(): Mesh {
  // 24 vertices (4 per face) for proper normals and UVs
  const vertices = new Float32Array([
    // Front face (z = 0.5)
    -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
    // Back face (z = -0.5)
    0.5, -0.5, -0.5, -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5,
    // Top face (y = 0.5)
    -0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5,
    // Bottom face (y = -0.5)
    -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5, -0.5, 0.5,
    // Right face (x = 0.5)
    0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5,
    // Left face (x = -0.5)
    -0.5, -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5,
  ]);

  // UVs: Standard 0-1 mapping for each face
  const uvs = new Float32Array([
    // Front
    0, 0, 1, 0, 1, 1, 0, 1,
    // Back
    0, 0, 1, 0, 1, 1, 0, 1,
    // Top
    0, 0, 1, 0, 1, 1, 0, 1,
    // Bottom
    0, 0, 1, 0, 1, 1, 0, 1,
    // Right
    0, 0, 1, 0, 1, 1, 0, 1,
    // Left
    0, 0, 1, 0, 1, 1, 0, 1,
  ]);

  // Indices: 6 faces × 2 triangles × 3 vertices = 36 indices
  /* eslint-disable prettier/prettier */
  const indices = new Uint16Array([
    0, 1, 2, 0, 2, 3, // Front
    4, 5, 6, 4, 6, 7, // Back
    8, 9, 10, 8, 10, 11, // Top
    12, 13, 14, 12, 14, 15, // Bottom
    16, 17, 18, 16, 18, 19, // Right
    20, 21, 22, 20, 22, 23, // Left
  ]);

  return { vertices, uvs, indices };
}
  /* eslint-enable prettier/prettier */
/**
 * Property allowlist for CellMap component
 * Defines which properties can be accessed directly on the component
 */
export const PROPERTY_ALLOWLIST = [
  'materials',
  'materialMap',
  'shapeMap',
  'meshes',
  'emissionMap',
  'visibilityMap',
  'cellSize',
  'mapSize',
  'packedData',
  'needsGPUUpdate',
  'chunks',
  'chunkGridSize',
  'smoothing',
  'smoothingWeights',
  'normalSmoothing',
  'revealExempt',
];

/**
 * Builder function for CellMap component
 */
export async function builder(options: CellMapOptions): Promise<CellMapT> {
  const { materials, materialMap, cellSize, mapSize } = options;

  // Validate required inputs
  if (!materials || materials.length === 0) {
    throw new Error('CellMap requires at least one material');
  }

  if (!materialMap) {
    throw new Error('CellMap requires materialMap');
  }

  if (!cellSize || !mapSize) {
    throw new Error('CellMap requires cellSize and mapSize');
  }

  // Validate materialMap dimensions match mapSize
  if (
    materialMap.size.x !== mapSize.x ||
    materialMap.size.y !== mapSize.y ||
    materialMap.size.z !== mapSize.z
  ) {
    throw new Error(
      `materialMap dimensions (${materialMap.size.x},${materialMap.size.y},${materialMap.size.z}) ` +
        `must match mapSize (${mapSize.x},${mapSize.y},${mapSize.z})`,
    );
  }

  // Create default shapeMap if not provided (all cubes)
  const shapeMap = options.shapeMap || new Array3D<number>(mapSize, 1); // 1 = default cube

  // Validate shapeMap dimensions if provided
  if (
    shapeMap.size.x !== mapSize.x ||
    shapeMap.size.y !== mapSize.y ||
    shapeMap.size.z !== mapSize.z
  ) {
    throw new Error('shapeMap dimensions must match mapSize');
  }

  // Create default emissionMap if not provided (no emission)
  const emissionMap = options.emissionMap || new Array3D<number>(mapSize, 0); // 0 = no emission

  // Validate emissionMap dimensions if provided
  if (
    emissionMap.size.x !== mapSize.x ||
    emissionMap.size.y !== mapSize.y ||
    emissionMap.size.z !== mapSize.z
  ) {
    throw new Error('emissionMap dimensions must match mapSize');
  }

  // Create default visibilityMap if not provided (all visible)
  const visibilityMap =
    options.visibilityMap || new Array3D<boolean>(mapSize, true); // true = visible

  // Validate visibilityMap dimensions if provided
  if (
    visibilityMap.size.x !== mapSize.x ||
    visibilityMap.size.y !== mapSize.y ||
    visibilityMap.size.z !== mapSize.z
  ) {
    throw new Error('visibilityMap dimensions must match mapSize');
  }

  // Prepare meshes array with default cube at index 1
  const meshes = options.meshes || [];

  // Ensure index 0 exists (reserved for air - empty mesh)
  if (!meshes[0]) {
    meshes[0] = {
      vertices: new Float32Array(0),
      uvs: new Float32Array(0),
      indices: new Uint16Array(0),
    };
  }

  // Ensure index 1 exists (default cube)
  if (!meshes[1]) {
    meshes[1] = generateDefaultCubeMesh();
  }

  // Pack all cell data into a single Array3D
  const packedArray = new Array3D<number>(mapSize);

  packedArray.forEach((_, x, y, z, i) => {
    const coords = new Vector3D(x, y, z);

    const cellData = createDefaultCellData();
    cellData.materialIndex = materialMap.get(coords);
    cellData.shapeIndex = shapeMap.get(coords);
    cellData.emissionIntensity = emissionMap.get(coords);
    cellData.visible = visibilityMap.get(coords);

    // Clamp values to valid ranges
    cellData.materialIndex = Math.max(
      0,
      Math.min(0xfff, cellData.materialIndex),
    );
    cellData.shapeIndex = Math.max(0, Math.min(0xfff, cellData.shapeIndex));
    cellData.emissionIntensity = Math.max(
      0,
      Math.min(0x1f, cellData.emissionIntensity),
    );

    packedArray.indexSet(i, packCell(cellData));
  });

  // Create compressed Array3Dic
  // Using RLE compression with 32-bit values (no sub-integer bit packing needed)
  // Note: Array3Dic uses generic T, not bit-packed integers like Array3Di
  const packedData = new Array3Dc(packedArray, 0.05); // 5% dirty threshold

  // Smoothing configuration
  const smoothing = options.smoothing ?? 0;
  const normalSmoothing = Math.max(
    0,
    Math.min(1, options.normalSmoothing ?? 0),
  );

  let weightsArray3D: Array3D<number>;
  const rawWeight = options.smoothingWeights ?? 8;
  if (typeof rawWeight === 'number') {
    const clamped = Math.max(0, Math.min(15, Math.round(rawWeight)));
    weightsArray3D = new Array3D<number>(mapSize, clamped);
  } else {
    if (
      rawWeight.size.x !== mapSize.x ||
      rawWeight.size.y !== mapSize.y ||
      rawWeight.size.z !== mapSize.z
    ) {
      throw new Error('smoothingWeights dimensions must match mapSize');
    }
    weightsArray3D = rawWeight;
  }
  const smoothingWeights = new Array3Di(weightsArray3D, 8, [4, 4], 'clamp');

  // Calculate chunk grid dimensions
  const chunkGridSize = {
    x: Math.ceil(mapSize.x / CHUNK_SIZE),
    y: Math.ceil(mapSize.y / CHUNK_SIZE),
    z: Math.ceil(mapSize.z / CHUNK_SIZE),
  };

  // Initialize chunk array with all chunks marked dirty
  const chunks: ChunkMesh[] = [];
  for (let cz = 0; cz < chunkGridSize.z; cz++) {
    for (let cy = 0; cy < chunkGridSize.y; cy++) {
      for (let cx = 0; cx < chunkGridSize.x; cx++) {
        chunks.push({
          cx,
          cy,
          cz,
          dirty: true,
          vertices: null,
          indices: null,
          drawRanges: [],
          faceCount: 0,
          glVertexBuffer: null,
          glIndexBuffer: null,
        });
      }
    }
  }

  return {
    name: options.name,
    type: 'cell-map',
    parent: null,
    materials,
    materialMap,
    shapeMap,
    meshes,
    emissionMap,
    visibilityMap,
    cellSize,
    mapSize,
    packedData,
    smoothing,
    smoothingWeights,
    normalSmoothing,
    needsGPUUpdate: true,
    chunks,
    chunkGridSize,
    revealExempt: options.revealExempt ?? false,
  };
}
