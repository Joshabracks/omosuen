import type { ComponentData, ComponentOptions } from '../types';
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
import { Vector2D } from '../../math';

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
