import {
  ComponentData,
  ComponentOptions,
  ComponentSerializer,
  ComponentUnique,
} from '../types';
import { Array3D, Array3Dc, Array3Di, Vector3D } from '../../math';
import {
  Material,
  Mesh,
  ChunkMesh,
  packCell,
  unpackCell,
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

/**
 * Serializes a cell-map component to a plain object.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serialize(component: ComponentData): any {
  const cm = component as CellMapT;
  const size = cm.mapSize;

  // Expand RLE-compressed packedData to flat array of 32-bit packed ints
  const packedFlat: number[] = [];
  const expanded = cm.packedData.expand();
  expanded.forEach((val) => {
    packedFlat.push(val);
  });

  return {
    type: 'cell-map',
    name: cm.name,
    unique: ComponentUnique.FALSE,
    materials: cm.materials.map((m) => ({
      albedoTextureKey: m.albedoTextureKey,
      normalTextureKey: m.normalTextureKey,
      emissionTextureKey: m.emissionTextureKey,
      materialTextureKey: m.materialTextureKey,
      albedoFrame: m.albedoFrame ?? 0,
      normalFrame: m.normalFrame ?? 0,
      emissionFrame: m.emissionFrame ?? 0,
      materialFrame: m.materialFrame ?? 0,
    })),
    cellSize: {
      _vectorType: 'Vector3D',
      x: cm.cellSize.x,
      y: cm.cellSize.y,
      z: cm.cellSize.z,
    },
    mapSize: {
      _vectorType: 'Vector3D',
      x: size.x,
      y: size.y,
      z: size.z,
    },
    packedData: packedFlat,
    smoothing: cm.smoothing,
    normalSmoothing: cm.normalSmoothing,
    revealExempt: cm.revealExempt,
  };
}

/**
 * Deserializes a plain object back into a cell-map component.
 * Constructs CellMapT directly (mirrors builder logic) since builder is async.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deserialize(data: any): CellMapT {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const {
    type,
    name,
    materials,
    cellSize,
    mapSize,
    packedData,
    smoothing,
    normalSmoothing,
    revealExempt,
  } = data;

  const errors: string[] = [];
  if (type !== 'cell-map') {
    errors.push(`type ${type} does not match "cell-map"`);
  }
  if (!name) {
    errors.push('cell-map requires a name');
  }
  if (!materials || !Array.isArray(materials)) {
    errors.push('cell-map requires a materials array');
  }
  if (!cellSize || !mapSize) {
    errors.push('cell-map requires cellSize and mapSize');
  }
  if (!packedData || !Array.isArray(packedData)) {
    errors.push('cell-map requires packedData array');
  }
  if (errors.length) {
    throw new Error(errors.join('\n'));
  }

  // Reconstruct Vector3D for cellSize and mapSize
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const cs = new Vector3D(cellSize.x, cellSize.y, cellSize.z);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const ms = new Vector3D(mapSize.x, mapSize.y, mapSize.z);

  // Reconstruct input maps by unpacking each cell from the flat packed array
  const materialMap = new Array3D<number>(ms, 0);
  const shapeMap = new Array3D<number>(ms, 1);
  const emissionMap = new Array3D<number>(ms, 0);
  const visibilityMap = new Array3D<boolean>(ms, true);

  for (let i = 0; i < (packedData as number[]).length; i++) {
    const cell = unpackCell((packedData as number[])[i]);
    materialMap.indexSet(i, cell.materialIndex);
    shapeMap.indexSet(i, cell.shapeIndex);
    emissionMap.indexSet(i, cell.emissionIntensity);
    visibilityMap.indexSet(i, cell.visible);
  }

  // Re-pack into Array3D then compress to Array3Dc (mirrors builder)
  const packedArray = new Array3D<number>(ms);
  packedArray.forEach((_, x, y, z, i) => {
    const coords = new Vector3D(x, y, z);
    const cellData = createDefaultCellData();
    cellData.materialIndex = materialMap.get(coords);
    cellData.shapeIndex = shapeMap.get(coords);
    cellData.emissionIntensity = emissionMap.get(coords);
    cellData.visible = visibilityMap.get(coords);

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
  const compressedData = new Array3Dc(packedArray, 0.05);

  // Meshes: air at 0, default cube at 1
  const meshes: Mesh[] = [
    {
      vertices: new Float32Array(0),
      uvs: new Float32Array(0),
      indices: new Uint16Array(0),
    },
    generateDefaultCubeMesh(),
  ];

  // Smoothing weights (uniform default)
  const weightsArray3D = new Array3D<number>(ms, 8);
  const smoothingWeights = new Array3Di(weightsArray3D, 8, [4, 4], 'clamp');

  // Chunk grid
  const chunkGridSize = {
    x: Math.ceil(ms.x / CHUNK_SIZE),
    y: Math.ceil(ms.y / CHUNK_SIZE),
    z: Math.ceil(ms.z / CHUNK_SIZE),
  };

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

  // Reconstruct materials array
  const mats: Material[] = (materials as Material[]).map((m) => ({
    albedoTextureKey: m.albedoTextureKey || '',
    normalTextureKey: m.normalTextureKey || '',
    emissionTextureKey: m.emissionTextureKey || '',
    materialTextureKey: m.materialTextureKey || '',
    albedoFrame: m.albedoFrame ?? 0,
    normalFrame: m.normalFrame ?? 0,
    emissionFrame: m.emissionFrame ?? 0,
    materialFrame: m.materialFrame ?? 0,
  }));

  return {
    name: name as string,
    type: 'cell-map',
    parent: null,
    materials: mats,
    materialMap,
    shapeMap,
    meshes,
    emissionMap,
    visibilityMap,
    cellSize: cs,
    mapSize: ms,
    packedData: compressedData,
    smoothing: (smoothing as number) ?? 0,
    smoothingWeights,
    normalSmoothing: Math.max(0, Math.min(1, (normalSmoothing as number) ?? 0)),
    needsGPUUpdate: true,
    chunks,
    chunkGridSize,
    revealExempt: (revealExempt as boolean) ?? false,
  };
}

export const CellMapSerializer: ComponentSerializer = {
  serialize,
  deserialize,
};
