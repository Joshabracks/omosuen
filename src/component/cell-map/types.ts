import { Vector3D } from '../../math';

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
   * Texture coordinates as flat array: [u,v, u,v, ...]
   */
  uvs: Float32Array;

  /**
   * Triangle indices referencing vertices array
   */
  indices: Uint16Array;
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
