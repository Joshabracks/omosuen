import type {
  ComponentData,
  ComponentOptions,
  ComponentSerializer,
} from '../types';
import { ComponentUnique } from '../types';
import type {
  ImageType,
  OriginalFrame,
  PackedFrame,
  GridConfig,
} from './types';
import { isFrameMap, isGridConfig } from './types';
import type { TextureMapMethods } from './methods';
import type { ComponentInstanceMethods } from '../types';
import { Vector2D, Vector4D } from '../../math';

export interface TextureMapT
  extends ComponentData, ComponentInstanceMethods<TextureMapMethods> {
  type: 'texture-map';
  unique: ComponentUnique.FALSE;

  /**
   * Unique key for this texture map.
   * Used for atlas lookups and serialization.
   */
  textureMapKey: string;

  /**
   * File path to the source image.
   */
  filePath: string;

  /**
   * Configuration for how to extract frames from the source image.
   * - FrameMap: Explicit frame rectangles
   * - GridConfig: Uniform grid extraction
   * - undefined: Entire image is a single frame
   */
  imageType: ImageType;

  /**
   * Original frame definitions from the source image.
   * Required for atlas packing and serialization/deserialization.
   */
  originalFrames: OriginalFrame[];

  /**
   * Packed frame data after atlas processing.
   * Populated by AtlasManager.processTextureMaps().
   * Used at runtime for rendering.
   */
  packedFrames: PackedFrame[];

  /**
   * O(1) lookup map from frameIndex to PackedFrame.
   * Built automatically by setPackedFrames().
   */
  frameIndexMap: Map<number, PackedFrame>;
}

export const PROPERTY_ALLOWLIST = [
  'textureMapKey',
  'filePath',
  'imageType',
  'originalFrames',
  'packedFrames',
  'frameIndexMap',
];

/**
 * Options for creating a TextureMap component.
 */
export interface TextureMapOptions extends ComponentOptions {
  /**
   * Unique key for this texture map.
   */
  textureMapKey: string;

  /**
   * File path to the source image.
   */
  filePath: string;

  /**
   * Configuration for frame extraction.
   * - FrameMap: Array of Vector4D frame rectangles
   * - GridConfig: Uniform grid configuration
   * - undefined: Entire image is a single frame
   */
  imageType?: ImageType;

  /**
   * Optional atlas manager to auto-register this texture map with.
   * If provided, automatically calls atlasManager.addTextureMap() during initialization.
   */
  atlasManager?: unknown; // Using unknown to avoid circular dependency, will be cast to AtlasManagerT
}

/**
 * Extracts original frames from an image based on the imageType configuration.
 *
 * @param imageType - Frame extraction configuration
 * @param imageSize - Size of the source image (width, height)
 * @returns Array of OriginalFrame definitions
 */
function extractOriginalFrames(
  imageType: ImageType,
  imageSize?: Vector2D,
): OriginalFrame[] {
  // Case 1: FrameMap - explicit frame definitions
  if (isFrameMap(imageType)) {
    return imageType.map((rect, index) => ({
      frameIndex: index,
      position: new Vector2D(rect.x, rect.y),
      size: new Vector2D(rect.z, rect.w),
    }));
  }

  // Case 2: GridConfig - uniform grid extraction
  if (isGridConfig(imageType)) {
    const frames: OriginalFrame[] = [];
    const { cellSize, gridSize, cellCount } = imageType as GridConfig;
    const maxCells =
      cellCount !== undefined ? cellCount : gridSize.x * gridSize.y;

    for (let row = 0; row < gridSize.y; row++) {
      for (let col = 0; col < gridSize.x; col++) {
        const index = row * gridSize.x + col;
        if (index >= maxCells) break;

        frames.push({
          frameIndex: index,
          position: new Vector2D(col * cellSize.x, row * cellSize.y),
          size: new Vector2D(cellSize.x, cellSize.y),
        });
      }
    }

    return frames;
  }

  // Case 3: undefined - entire image is a single frame
  if (imageSize) {
    return [
      {
        frameIndex: 0,
        position: new Vector2D(0, 0),
        size: new Vector2D(imageSize.x, imageSize.y),
      },
    ];
  }

  // If no imageSize provided and imageType is undefined, return empty array
  // The frames will be populated later when the image is loaded
  return [];
}

/**
 * Builder function for creating TextureMap components.
 */
export function builder(options: TextureMapOptions): TextureMapT {
  const { textureMapKey, filePath, imageType, name, atlasManager } = options;

  // Extract original frames if imageType is provided
  // If imageType is undefined, frames will be set when image loads
  const originalFrames = extractOriginalFrames(imageType);

  const textureMap = {
    type: 'texture-map' as const,
    name: name || textureMapKey,
    unique: ComponentUnique.FALSE,
    parent: null,
    _disposed: false,
    textureMapKey,
    filePath,
    imageType,
    originalFrames,
    packedFrames: [],
    frameIndexMap: new Map(),
  } as unknown as TextureMapT;

  // Auto-register with atlas manager if provided
  if (atlasManager) {
    // Cast to any to avoid circular dependency issues
    const am = atlasManager as any;
    if (am.type === 'atlas-manager' && typeof am.addTextureMap === 'function') {
      am.addTextureMap(textureMap);
    } else {
      console.warn(
        '[texture-map] atlasManager option provided but is not a valid AtlasManager component',
      );
    }
  }

  return textureMap;
}

/**
 * Serializes a texture-map component to a plain object.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serialize(component: ComponentData): any {
  const t = component as TextureMapT;

  // Serialize imageType based on mode
  let imageTypeData: unknown = null;

  if (isFrameMap(t.imageType)) {
    imageTypeData = {
      mode: 'framemap',
      frames: t.imageType.map((rect) => ({
        x: rect.x,
        y: rect.y,
        w: rect.z,
        h: rect.w,
      })),
    };
  } else if (isGridConfig(t.imageType)) {
    const grid = t.imageType as GridConfig;
    imageTypeData = {
      mode: 'grid',
      cellWidth: grid.cellSize.x,
      cellHeight: grid.cellSize.y,
      cols: grid.gridSize.x,
      rows: grid.gridSize.y,
      cellCount: grid.cellCount,
    };
  }

  return {
    type: 'texture-map',
    name: t.name,
    unique: ComponentUnique.FALSE,
    textureMapKey: t.textureMapKey,
    filePath: t.filePath,
    imageType: imageTypeData,
  };
}

/**
 * Deserializes a plain object back into a texture-map component.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deserialize(data: any): TextureMapT {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const {
    type,
    name,
    textureMapKey,
    filePath,
    imageType: imageTypeData,
  } = data;

  const errors = [];
  if (type !== 'texture-map') {
    errors.push(`type ${type} does not match "texture-map"`);
  }
  if (!name) {
    errors.push('texture-map requires a name');
  }
  if (errors.length) {
    throw new Error(errors.join('\n'));
  }

  // Reconstruct imageType from serialized format
  let imageType: ImageType;

  if (imageTypeData && typeof imageTypeData === 'object') {
    if (
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      imageTypeData.mode === 'framemap' &&
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      Array.isArray(imageTypeData.frames)
    ) {
      // Reconstruct FrameMap (Vector4D[])
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      imageType = imageTypeData.frames.map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (f: any) => new Vector4D(f.x, f.y, f.w, f.h),
      );
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    } else if (imageTypeData.mode === 'grid') {
      // Reconstruct GridConfig
      imageType = {
        cellSize: new Vector2D(
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          imageTypeData.cellWidth,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          imageTypeData.cellHeight,
        ),
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        gridSize: new Vector2D(imageTypeData.cols, imageTypeData.rows),
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
        cellCount: imageTypeData.cellCount,
      } as GridConfig;
    }
  }

  return builder({
    name: name as string,
    textureMapKey: textureMapKey as string,
    filePath: filePath as string,
    imageType,
  });
}

export const TextureMapSerializer: ComponentSerializer = {
  serialize,
  deserialize,
};
