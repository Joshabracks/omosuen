import { Vector2D, Vector4D } from '../../math';

/**
 * FrameMap: Array of Vector4D coordinates defining frame rectangles.
 * Each Vector4D represents: (x: left, y: top, z: width, w: height)
 */
export type FrameMap = Vector4D[];

/**
 * GridConfig: Configuration for extracting frames from a uniform grid.
 * Assumes all frames are the same size and arranged in a tight grid pattern.
 */
export interface GridConfig {
  /**
   * Size of each cell in the grid (width, height)
   */
  cellSize: Vector2D;

  /**
   * Grid dimensions (columns, rows)
   */
  gridSize: Vector2D;

  /**
   * Optional: Index of the last valid cell in the grid.
   * If provided, cells beyond this index are considered empty.
   * Useful for grids where the last row is not completely filled.
   */
  cellCount?: number;
}

/**
 * ImageType: Union type for frame extraction configurations.
 * - FrameMap: Explicitly defined frame rectangles
 * - GridConfig: Uniform grid-based extraction
 * - undefined: Entire image is treated as a single frame
 */
export type ImageType = FrameMap | GridConfig | undefined;

/**
 * OriginalFrame: Represents a frame in its original source image.
 * Used for extraction during atlas packing and for serialization/deserialization.
 */
export interface OriginalFrame {
  /**
   * Frame index within the texture map
   */
  frameIndex: number;

  /**
   * Position of the top-left corner in the source image (x, y)
   */
  position: Vector2D;

  /**
   * Size of the frame (width, height)
   */
  size: Vector2D;
}

/**
 * PackedFrame: Represents a frame after it has been packed into an atlas.
 * Used at runtime for rendering and sprite lookups.
 */
export interface PackedFrame {
  /**
   * Frame index within the texture map
   */
  frameIndex: number;

  /**
   * Position of the top-left corner in the atlas texture (x, y)
   */
  atlasPosition: Vector2D;

  /**
   * Index of the atlas texture this frame is packed into (0-15)
   */
  atlasIndex: number;

  /**
   * Size of the frame (width, height)
   * Should match the original frame size
   */
  size: Vector2D;
}

/**
 * Helper function to check if an ImageType is a FrameMap
 */
export function isFrameMap(imageType: ImageType): imageType is FrameMap {
  return Array.isArray(imageType);
}

/**
 * Helper function to check if an ImageType is a GridConfig
 */
export function isGridConfig(imageType: ImageType): imageType is GridConfig {
  return (
    imageType !== undefined &&
    !Array.isArray(imageType) &&
    typeof imageType === 'object' &&
    'cellSize' in imageType &&
    'gridSize' in imageType
  );
}
