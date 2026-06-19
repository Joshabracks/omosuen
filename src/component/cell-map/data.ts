import {
  ComponentData,
  ComponentOptions,
  ComponentSerializer,
  ComponentUnique,
  DeserializationError,
  DeserializeResult,
} from '../types';
import { Array3D, Array3Di, Vector3D } from '../../math';
import {
  Material,
  Mesh,
  ChunkMesh,
  packCell,
  unpackCell,
  createDefaultCellData,
  CHUNK_SIZE,
} from './types';
import {
  initRenderWasm,
  loadCellStore,
  cellStoreDump,
  cellStoreGet,
} from '../camera/render/wasm';

/**
 * Read-only view over the canonical cell store, exposed as `cellMap.packedData`
 * for consumer code that needs to read cells (e.g. counting visible cells for
 * stats). Read-only by design: mutation goes through `setCellData`, so the
 * RLE-compressed store can't be corrupted from outside.
 */
export interface CellPackedReadView {
  forEach(
    cb: (value: number, x: number, y: number, z: number, index: number) => void,
  ): void;
  get(coord: Vector3D): number;
}

// ── Module-level singleton storage ──
// Data lives here to avoid GC pressure and enable direct imports.
// The CellMapT instance delegates to these via getter/setter properties.

export let cmMaterials: Material[] = [];
export let cmMaterialMap: Array3D<number>;
export let cmShapeMap: Array3D<number>;
export let cmMeshes: Mesh[] = [];
export let cmEmissionMap: Array3D<number>;
export let cmVisibilityMap: Array3D<boolean>;
export let cmCellSize: Vector3D;
export let cmMapSize: Vector3D;
export let cmSmoothing: number = 0;
export let cmSmoothingWeights: Array3Di;
export let cmNormalSmoothing: number = 0;
export let cmNeedsGPUUpdate: boolean = true;
export let cmChunks: ChunkMesh[] = [];
export let cmChunkGridSize: { x: number; y: number; z: number } = {
  x: 0,
  y: 0,
  z: 0,
};
export let cmRevealExempt: boolean = false;

/**
 * Stable read-only view over the canonical WASM cell store, returned by the
 * `cellMap.packedData` getter. Reused (no per-access allocation).
 */
const packedDataView: CellPackedReadView = {
  forEach(cb): void {
    const flat = cellStoreDump();
    const mx = cmMapSize.x;
    const my = cmMapSize.y;
    let x = 0;
    let y = 0;
    let z = 0;
    for (let i = 0; i < flat.length; i++) {
      cb(flat[i], x, y, z, i);
      x++;
      if (x >= mx) {
        x = 0;
        y++;
        if (y >= my) {
          y = 0;
          z++;
        }
      }
    }
  },
  get(coord: Vector3D): number {
    return cellStoreGet(coord.x, coord.y, coord.z);
  },
};

/**
 * Resets all module-level cell-map state to defaults.
 * Called by dispose to release memory.
 */
export function resetCellMapState(): void {
  cmMaterials = [];
  cmMaterialMap = undefined!;
  cmShapeMap = undefined!;
  cmMeshes = [];
  cmEmissionMap = undefined!;
  cmVisibilityMap = undefined!;
  cmCellSize = undefined!;
  cmMapSize = undefined!;
  cmSmoothing = 0;
  cmSmoothingWeights = undefined!;
  cmNormalSmoothing = 0;
  cmNeedsGPUUpdate = true;
  cmChunks = [];
  cmChunkGridSize = { x: 0, y: 0, z: 0 };
  cmRevealExempt = false;
}

/**
 * Creates a CellMapT instance with getter/setter properties
 * that delegate to module-level variables.
 */
function makeCellMapInstance(name: string): CellMapT {
  return {
    name,
    type: 'cell-map',
    parent: null,
    get materials() {
      return cmMaterials;
    },
    set materials(v) {
      cmMaterials = v;
    },
    get materialMap() {
      return cmMaterialMap;
    },
    set materialMap(v) {
      cmMaterialMap = v;
    },
    get shapeMap() {
      return cmShapeMap;
    },
    set shapeMap(v) {
      cmShapeMap = v;
    },
    get meshes() {
      return cmMeshes;
    },
    set meshes(v) {
      cmMeshes = v;
    },
    get emissionMap() {
      return cmEmissionMap;
    },
    set emissionMap(v) {
      cmEmissionMap = v;
    },
    get visibilityMap() {
      return cmVisibilityMap;
    },
    set visibilityMap(v) {
      cmVisibilityMap = v;
    },
    get cellSize() {
      return cmCellSize;
    },
    set cellSize(v) {
      cmCellSize = v;
    },
    get mapSize() {
      return cmMapSize;
    },
    set mapSize(v) {
      cmMapSize = v;
    },
    get packedData() {
      return packedDataView;
    },
    get smoothing() {
      return cmSmoothing;
    },
    set smoothing(v) {
      cmSmoothing = v;
    },
    get smoothingWeights() {
      return cmSmoothingWeights;
    },
    set smoothingWeights(v) {
      cmSmoothingWeights = v;
    },
    get normalSmoothing() {
      return cmNormalSmoothing;
    },
    set normalSmoothing(v) {
      cmNormalSmoothing = v;
    },
    get needsGPUUpdate() {
      return cmNeedsGPUUpdate;
    },
    set needsGPUUpdate(v) {
      cmNeedsGPUUpdate = v;
    },
    get chunks() {
      return cmChunks;
    },
    set chunks(v) {
      cmChunks = v;
    },
    get chunkGridSize() {
      return cmChunkGridSize;
    },
    set chunkGridSize(v) {
      cmChunkGridSize = v;
    },
    get revealExempt() {
      return cmRevealExempt;
    },
    set revealExempt(v) {
      cmRevealExempt = v;
    },
  } as CellMapT;
}

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

  /** Read-only view over the canonical cell store (see CellPackedReadView). */
  packedData: CellPackedReadView;

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
    0,
    1,
    2,
    0,
    2,
    3, // Front
    4,
    5,
    6,
    4,
    6,
    7, // Back
    8,
    9,
    10,
    8,
    10,
    11, // Top
    12,
    13,
    14,
    12,
    14,
    15, // Bottom
    16,
    17,
    18,
    16,
    18,
    19, // Right
    20,
    21,
    22,
    20,
    22,
    23, // Left
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
 * Initializes chunk array with all chunks marked dirty.
 */
function initChunks(cgs: { x: number; y: number; z: number }): ChunkMesh[] {
  const result: ChunkMesh[] = [];
  for (let cz = 0; cz < cgs.z; cz++) {
    for (let cy = 0; cy < cgs.y; cy++) {
      for (let cx = 0; cx < cgs.x; cx++) {
        result.push({
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
  return result;
}

/**
 * Builder function for CellMap component
 */
export async function builder(options: CellMapOptions): Promise<CellMapT> {
  // The canonical cell store lives in the render WASM module; ensure it is
  // instantiated before we load cells into it.
  await initRenderWasm();

  // Validate required inputs
  if (!options.materials || options.materials.length === 0) {
    throw new Error('CellMap requires at least one material');
  }

  if (!options.materialMap) {
    throw new Error('CellMap requires materialMap');
  }

  if (!options.cellSize || !options.mapSize) {
    throw new Error('CellMap requires cellSize and mapSize');
  }

  // Validate materialMap dimensions match mapSize
  if (
    options.materialMap.size.x !== options.mapSize.x ||
    options.materialMap.size.y !== options.mapSize.y ||
    options.materialMap.size.z !== options.mapSize.z
  ) {
    throw new Error(
      `materialMap dimensions (${options.materialMap.size.x},${options.materialMap.size.y},${options.materialMap.size.z}) ` +
        `must match mapSize (${options.mapSize.x},${options.mapSize.y},${options.mapSize.z})`,
    );
  }

  // Create default shapeMap if not provided (all cubes)
  const optShapeMap =
    options.shapeMap || new Array3D<number>(options.mapSize, 1);

  // Validate shapeMap dimensions if provided
  if (
    optShapeMap.size.x !== options.mapSize.x ||
    optShapeMap.size.y !== options.mapSize.y ||
    optShapeMap.size.z !== options.mapSize.z
  ) {
    throw new Error('shapeMap dimensions must match mapSize');
  }

  // Create default emissionMap if not provided (no emission)
  const optEmissionMap =
    options.emissionMap || new Array3D<number>(options.mapSize, 0);

  // Validate emissionMap dimensions if provided
  if (
    optEmissionMap.size.x !== options.mapSize.x ||
    optEmissionMap.size.y !== options.mapSize.y ||
    optEmissionMap.size.z !== options.mapSize.z
  ) {
    throw new Error('emissionMap dimensions must match mapSize');
  }

  // Create default visibilityMap if not provided (all visible)
  const optVisibilityMap =
    options.visibilityMap || new Array3D<boolean>(options.mapSize, true);

  // Validate visibilityMap dimensions if provided
  if (
    optVisibilityMap.size.x !== options.mapSize.x ||
    optVisibilityMap.size.y !== options.mapSize.y ||
    optVisibilityMap.size.z !== options.mapSize.z
  ) {
    throw new Error('visibilityMap dimensions must match mapSize');
  }

  // Prepare meshes array with default cube at index 1
  const optMeshes = options.meshes || [];

  // Ensure index 0 exists (reserved for air - empty mesh)
  if (!optMeshes[0]) {
    optMeshes[0] = {
      vertices: new Float32Array(0),
      uvs: new Float32Array(0),
      indices: new Uint16Array(0),
    };
  }

  // Ensure index 1 exists (default cube)
  if (!optMeshes[1]) {
    optMeshes[1] = generateDefaultCubeMesh();
  }

  // Pack all cell data into a single Array3D
  const packedArray = new Array3D<number>(options.mapSize);

  packedArray.forEach((_, x, y, z, i) => {
    const coords = new Vector3D(x, y, z);

    const cellData = createDefaultCellData();
    cellData.materialIndex = options.materialMap.get(coords);
    cellData.shapeIndex = optShapeMap.get(coords);
    cellData.emissionIntensity = optEmissionMap.get(coords);
    cellData.visible = optVisibilityMap.get(coords);

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

  // Load the packed cells into the canonical WASM store (RLE-compressed there).
  loadCellStore(
    packedArray.value,
    options.mapSize.x * options.mapSize.y * options.mapSize.z,
    options.mapSize.x,
    options.mapSize.y,
    options.mapSize.z,
  );

  // Smoothing configuration
  const optSmoothing = options.smoothing ?? 0;
  const optNormalSmoothing = Math.max(
    0,
    Math.min(1, options.normalSmoothing ?? 0),
  );

  let weightsArray3D: Array3D<number>;
  const rawWeight = options.smoothingWeights ?? 8;
  if (typeof rawWeight === 'number') {
    const clamped = Math.max(0, Math.min(15, Math.round(rawWeight)));
    weightsArray3D = new Array3D<number>(options.mapSize, clamped);
  } else {
    if (
      rawWeight.size.x !== options.mapSize.x ||
      rawWeight.size.y !== options.mapSize.y ||
      rawWeight.size.z !== options.mapSize.z
    ) {
      throw new Error('smoothingWeights dimensions must match mapSize');
    }
    weightsArray3D = rawWeight;
  }
  const optSmoothingWeights = new Array3Di(weightsArray3D, 8, [4, 4], 'clamp');

  // Calculate chunk grid dimensions
  const optChunkGridSize = {
    x: Math.ceil(options.mapSize.x / CHUNK_SIZE),
    y: Math.ceil(options.mapSize.y / CHUNK_SIZE),
    z: Math.ceil(options.mapSize.z / CHUNK_SIZE),
  };

  // Assign to module-level storage
  cmMaterials = options.materials;
  cmMaterialMap = options.materialMap;
  cmShapeMap = optShapeMap;
  cmMeshes = optMeshes;
  cmEmissionMap = optEmissionMap;
  cmVisibilityMap = optVisibilityMap;
  cmCellSize = options.cellSize;
  cmMapSize = options.mapSize;
  cmSmoothing = optSmoothing;
  cmSmoothingWeights = optSmoothingWeights;
  cmNormalSmoothing = optNormalSmoothing;
  cmNeedsGPUUpdate = true;
  cmChunkGridSize = optChunkGridSize;
  cmChunks = initChunks(optChunkGridSize);
  cmRevealExempt = options.revealExempt ?? false;

  return makeCellMapInstance(options.name);
}

/**
 * Serializes a cell-map component to a plain object.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serialize(component: ComponentData): any {
  const cm = component as CellMapT;
  const size = cm.mapSize;

  // Dump the canonical WASM store to a flat array of 32-bit packed ints.
  const packedFlat: number[] = Array.from(cellStoreDump());

  return {
    type: 'cell-map',
    name: cm.name,
    unique: ComponentUnique.GLOBAL,
    materials: cm.materials.map((m) => ({
      albedoTextureKey: m.albedoTextureKey,
      normalTextureKey: m.normalTextureKey,
      emissionTextureKey: m.emissionTextureKey,
      materialTextureKey: m.materialTextureKey,
      albedoFrame: m.albedoFrame ?? 0,
      normalFrame: m.normalFrame ?? 0,
      emissionFrame: m.emissionFrame ?? 0,
      materialFrame: m.materialFrame ?? 0,
      sides: m.sides,
      smoothness: m.smoothness,
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
async function deserialize(data: any): Promise<DeserializeResult<CellMapT>> {
  const errors: DeserializationError[] = [];

  if (!data || typeof data !== 'object') {
    return {
      component: null,
      errors: [
        {
          code: 'INVALID_DATA',
          message: 'cell-map deserialize received non-object data',
        },
      ],
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const {
    type,
    name,
    materials: dataMaterials,
    cellSize: dataCellSize,
    mapSize: dataMapSize,
    packedData: dataPackedData,
    smoothing: dataSmoothing,
    normalSmoothing: dataNormalSmoothing,
    revealExempt: dataRevealExempt,
  } = data;

  if (type !== 'cell-map') {
    errors.push({
      code: 'TYPE_MISMATCH',
      message: `type ${type} does not match "cell-map"`,
    });
  }
  if (!name) {
    errors.push({
      code: 'MISSING_NAME',
      message: 'cell-map requires a name',
    });
  }
  if (!dataMaterials || !Array.isArray(dataMaterials)) {
    errors.push({
      code: 'MISSING_MATERIALS',
      message: 'cell-map requires a materials array',
    });
  }
  if (!dataCellSize || !dataMapSize) {
    errors.push({
      code: 'MISSING_DIMENSIONS',
      message: 'cell-map requires cellSize and mapSize',
    });
  }
  if (!dataPackedData || !Array.isArray(dataPackedData)) {
    errors.push({
      code: 'MISSING_PACKED_DATA',
      message: 'cell-map requires packedData array',
    });
  }
  if (errors.length > 0) {
    return { component: null, errors };
  }

  // Reconstruct Vector3D for cellSize and mapSize
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const cs = new Vector3D(dataCellSize.x, dataCellSize.y, dataCellSize.z);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const ms = new Vector3D(dataMapSize.x, dataMapSize.y, dataMapSize.z);

  // Reconstruct input maps by unpacking each cell from the flat packed array
  const dMaterialMap = new Array3D<number>(ms, 0);
  const dShapeMap = new Array3D<number>(ms, 1);
  const dEmissionMap = new Array3D<number>(ms, 0);
  const dVisibilityMap = new Array3D<boolean>(ms, true);

  for (let i = 0; i < (dataPackedData as number[]).length; i++) {
    const cell = unpackCell((dataPackedData as number[])[i]);
    dMaterialMap.indexSet(i, cell.materialIndex);
    dShapeMap.indexSet(i, cell.shapeIndex);
    dEmissionMap.indexSet(i, cell.emissionIntensity);
    dVisibilityMap.indexSet(i, cell.visible);
  }

  // Pack each cell into an Array3D, then load it into the canonical WASM RLE
  // store via loadCellStore below (mirrors builder).
  const packedArray = new Array3D<number>(ms);
  packedArray.forEach((_, x, y, z, i) => {
    const coords = new Vector3D(x, y, z);
    const cellData = createDefaultCellData();
    cellData.materialIndex = dMaterialMap.get(coords);
    cellData.shapeIndex = dShapeMap.get(coords);
    cellData.emissionIntensity = dEmissionMap.get(coords);
    cellData.visible = dVisibilityMap.get(coords);

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
  // Load the packed cells into the canonical WASM store.
  await initRenderWasm();
  loadCellStore(packedArray.value, packedArray.value.length, ms.x, ms.y, ms.z);

  // Meshes: air at 0, default cube at 1
  const dMeshes: Mesh[] = [
    {
      vertices: new Float32Array(0),
      uvs: new Float32Array(0),
      indices: new Uint16Array(0),
    },
    generateDefaultCubeMesh(),
  ];

  // Smoothing weights (uniform default)
  const weightsArray3D = new Array3D<number>(ms, 8);
  const dSmoothingWeights = new Array3Di(weightsArray3D, 8, [4, 4], 'clamp');

  // Chunk grid
  const dChunkGridSize = {
    x: Math.ceil(ms.x / CHUNK_SIZE),
    y: Math.ceil(ms.y / CHUNK_SIZE),
    z: Math.ceil(ms.z / CHUNK_SIZE),
  };

  // Reconstruct materials array
  const mats: Material[] = (dataMaterials as Material[]).map((m) => ({
    albedoTextureKey: m.albedoTextureKey || '',
    normalTextureKey: m.normalTextureKey || '',
    emissionTextureKey: m.emissionTextureKey || '',
    materialTextureKey: m.materialTextureKey || '',
    albedoFrame: m.albedoFrame ?? 0,
    normalFrame: m.normalFrame ?? 0,
    emissionFrame: m.emissionFrame ?? 0,
    materialFrame: m.materialFrame ?? 0,
    sides: m.sides,
    smoothness: m.smoothness,
  }));

  // Assign to module-level storage
  cmMaterials = mats;
  cmMaterialMap = dMaterialMap;
  cmShapeMap = dShapeMap;
  cmMeshes = dMeshes;
  cmEmissionMap = dEmissionMap;
  cmVisibilityMap = dVisibilityMap;
  cmCellSize = cs;
  cmMapSize = ms;
  cmSmoothing = (dataSmoothing as number) ?? 0;
  cmSmoothingWeights = dSmoothingWeights;
  cmNormalSmoothing = Math.max(
    0,
    Math.min(1, (dataNormalSmoothing as number) ?? 0),
  );
  cmNeedsGPUUpdate = true;
  cmChunkGridSize = dChunkGridSize;
  cmChunks = initChunks(dChunkGridSize);
  cmRevealExempt = (dataRevealExempt as boolean) ?? false;

  return {
    component: makeCellMapInstance(name as string),
    errors,
  };
}

export const CellMapSerializer: ComponentSerializer = {
  serialize,
  deserialize,
};
