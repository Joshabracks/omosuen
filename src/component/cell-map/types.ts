import { Vector3D } from '../../math';

/**
 * Per-side frame overrides keyed to the three visible faces of a cell.
 * Any omitted side/channel falls back to the Material's base `*Frame`.
 *
 * Albedo, normal, and emission are sampled per-side by cell mode; the material
 * (PBR) channel is deferred until cell shading samples it.
 */
export interface MaterialSideFrames {
  /** Frame index into the albedo TextureMap for this side. */
  albedoFrame?: number;
  /** Frame index into the normal TextureMap for this side. */
  normalFrame?: number;
  /** Frame index into the emission TextureMap for this side. */
  emissionFrame?: number;
}

/**
 * Material definition: References to 4 TextureMap components
 * Each material bundles albedo, normal, emission, and material (PBR) textures
 */
export interface Material {
  /**
   * TextureMap key for albedo (diffuse color) texture
   * References TextureMap.textureMapKey field
   */
  albedoTextureKey: string;

  /**
   * TextureMap key for normal map texture
   * References TextureMap.textureMapKey field
   */
  normalTextureKey: string;

  /**
   * TextureMap key for emission (emissive) texture
   * References TextureMap.textureMapKey field
   */
  emissionTextureKey: string;

  /**
   * TextureMap key for material (PBR properties) texture
   * References TextureMap.textureMapKey field
   */
  materialTextureKey: string;

  /**
   * Frame index into albedo TextureMap (default 0)
   */
  albedoFrame: number;

  /**
   * Frame index into normal TextureMap (default 0)
   */
  normalFrame: number;

  /**
   * Frame index into emission TextureMap (default 0)
   */
  emissionFrame: number;

  /**
   * Frame index into material TextureMap (default 0)
   */
  materialFrame: number;

  /**
   * Optional per-visible-side frame overrides. The three visible faces are:
   * - `up`        → +Y top face        (triplanar XZ plane)
   * - `southEast` → +X camera-right    (triplanar YZ plane)
   * - `southWest` → +Z camera-left     (triplanar XY plane)
   * When omitted, every side uses the Material's base `*Frame` (unchanged
   * rendering). Per-side frames of a channel are assumed to live in the same
   * atlas page as the base frame.
   */
  sides?: {
    up?: MaterialSideFrames;
    southEast?: MaterialSideFrames;
    southWest?: MaterialSideFrames;
  };

  /**
   * Optional cell-type smoothing weight (0-15, same scale as the cell-map's
   * `smoothingWeights`). When defined, cells of this material use this weight
   * instead of the map/per-cell weight. When undefined, the per-cell/map weight
   * applies. Shared vertices between cells of differing weights take the lowest
   * (hardest) weight, so softer cells snap to harder cells' square corners.
   */
  smoothness?: number;
}

/**
 * Mesh definition: Vertex data for custom cell shapes
 * Index 0 reserved for air (no mesh)
 * Index 1 is the default cube mesh
 */
export interface Mesh {
  /**
   * Vertex positions as flat array: [x,y,z, x,y,z, ...]
   * Unit coordinates (0.5 to -0.5), scaled by cellSize at render time
   */
  vertices: Float32Array;

  /**
   * Texture coordinates as flat array: [u,v, u,v, ...].
   * For custom cell shapes (shapeIndex >= 2): if non-empty with one uv per vertex
   * (length === vertices.length / 3 * 2), the shape is textured by these UVs
   * (mapped into the material's base albedo/normal atlas frame). Empty = the cell
   * falls back to triplanar world-space texturing (the default for cubes).
   */
  uvs: Float32Array;

  /**
   * Triangle indices referencing vertices array
   */
  indices: Uint16Array;

  /**
   * Optional per-face coverage flags for custom shapes. Each defaults to `true`
   * (the face is fully covered, so neighbors cull against it — current behavior).
   * Set a side to `false` when the mesh does not fill that cell face, so the
   * neighboring cell renders its adjacent face into the gap instead of culling.
   */
  faceCover?: {
    posX?: boolean;
    negX?: boolean;
    posY?: boolean;
    negY?: boolean;
    posZ?: boolean;
    negZ?: boolean;
  };
}

/**
 * Unpacked cell data structure
 * Represents all properties of a single cell in the map
 */
export interface CellData {
  /**
   * Index into materials array (0-4095)
   */
  materialIndex: number;

  /**
   * Index into meshes array (0-4095)
   * 0 = air/empty, 1 = default cube
   */
  shapeIndex: number;

  /**
   * Emission intensity multiplier (0-31)
   * Applied to emission texture in shader
   */
  emissionIntensity: number;

  /**
   * Visibility flag for culling optimization
   * false = skip rendering this cell
   */
  visible: boolean;
}

/**
 * Helper function to create a default CellData
 */
export function createDefaultCellData(): CellData {
  return {
    materialIndex: 0,
    shapeIndex: 1, // Default to cube
    emissionIntensity: 0,
    visible: true,
  };
}

/**
 * Packs CellData into a single 32-bit integer
 * Bit layout: [material(12) | shape(12) | emission(5) | visible(1) | reserved(2)]
 */
export function packCell(data: CellData): number {
  return (
    (data.materialIndex & 0xfff) |
    ((data.shapeIndex & 0xfff) << 12) |
    ((data.emissionIntensity & 0x1f) << 24) |
    ((data.visible ? 1 : 0) << 29)
  );
}

/**
 * Unpacks a 32-bit integer into CellData
 */
export function unpackCell(packed: number): CellData {
  return {
    materialIndex: packed & 0xfff,
    shapeIndex: (packed >> 12) & 0xfff,
    emissionIntensity: (packed >> 24) & 0x1f,
    visible: ((packed >> 29) & 0x1) === 1,
  };
}

// ============================================================
// Chunk types for batched rendering
// ============================================================

/**
 * Default chunk size in cells per axis, used when a cell-map doesn't specify
 * its own `chunkSize`. Sized to roughly match a "full zoomed-out" camera view
 * (X/Z wide, Y shallow) rather than a cube. Runtime-configurable per cell-map
 * (see `CellMapOptions.chunkSize`) — this is only the fallback.
 */
export const DEFAULT_CHUNK_SIZE = new Vector3D(32, 32, 20);

/**
 * A draw range within a chunk's index buffer for a specific material.
 * All faces in this range share the same material/texture.
 */
export interface DrawRange {
  /** Index into the cell map's materials array */
  materialIndex: number;
  /** True when this range samples by mesh UV instead of triplanar. */
  useMeshUV: boolean;
  /** Byte offset into the chunk's index buffer (in index count, not bytes) */
  indexOffset: number;
  /** Number of indices to draw */
  indexCount: number;
}

/**
 * Built mesh data for a single chunk, ready for GPU upload.
 * Contains all visible faces after hidden face culling and greedy meshing.
 */
export interface ChunkMesh {
  /** Chunk grid position (in chunk coordinates, not cell coordinates) */
  cx: number;
  cy: number;
  cz: number;

  /** Whether this chunk needs its mesh rebuilt */
  dirty: boolean;
  /** Whether this chunk's mesh has changed since its last GPU buffer upload */
  gpuDirty: boolean;

  /** Interleaved vertex data: pos3+normal3+origPos3+emission1 (stride 10), or +uv2 (stride 12) */
  vertices: Float32Array | null;
  /** Floats per vertex in `vertices`: 10, or 12 when UV custom shapes are present */
  stride: number;
  /** Index data */
  indices: Uint32Array | null;
  /** Material-grouped draw ranges within the index buffer */
  drawRanges: DrawRange[];

  /** Total visible face count (for stats) */
  faceCount: number;

  /** GPU buffer references (null until uploaded) */
  glVertexBuffer: WebGLBuffer | null;
  glIndexBuffer: WebGLBuffer | null;
}

// ============================================================
// Surface / collision query result types (see cell-map/raycast.ts)
// ============================================================

/** A ray hit against the cell-map's actual (smoothed/custom) mesh surface. */
export interface RaycastHit {
  /** World-space intersection point. */
  point: Vector3D;
  /** Unit surface normal, oriented to oppose the ray direction. */
  normal: Vector3D;
  /** Integer cell coordinate of the solid cell owning the hit surface. */
  cell: Vector3D;
  /** World-space distance from the ray origin to `point`. */
  distance: number;
}

/** A vertical surface sample: the topmost mesh point at a world (x,z). */
export interface SurfaceHit {
  /** World-space surface point. */
  point: Vector3D;
  /** Unit surface normal (points generally upward). */
  normal: Vector3D;
}

/** Options for cell-map ray/surface queries. */
export interface RaycastOptions {
  /** Max world distance to travel before giving up (default: full map extent). */
  maxDistance?: number;
  /**
   * When true, barycentric-interpolate the per-vertex normals for a smooth normal
   * (slope-aligned orientation). Default false = flat geometric triangle normal.
   */
  smoothNormal?: boolean;
}
