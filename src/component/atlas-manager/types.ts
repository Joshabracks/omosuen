import { Vector2D } from '../../math';

/**
 * UnpackedFrame: A frame that needs to be packed into an atlas.
 * Contains all information needed during the packing process.
 */
export interface UnpackedFrame {
  /**
   * Size of the frame (width, height)
   */
  size: Vector2D;

  /**
   * Source image this frame is cut from. The frame is blitted straight onto the
   * atlas at build time via drawImage — no per-frame ImageData is extracted.
   */
  sourceImage: HTMLImageElement;

  /**
   * Top-left position of the frame within `sourceImage`.
   */
  sourcePosition: Vector2D;

  /**
   * Position in the atlas (set during packing)
   */
  atlasPosition?: Vector2D;

  /**
   * Index of the atlas this frame is packed into (0-15, set during packing)
   */
  atlasIndex?: number;
}

/**
 * AtlasSpace: Represents a 2D space in an atlas that can be subdivided.
 * Used for bin packing with the guillotine algorithm.
 */
export interface AtlasSpace {
  /**
   * Position of this space within the parent atlas (or root)
   */
  position: Vector2D;

  /**
   * Parent AtlasSpace (null for root spaces)
   */
  parent: AtlasSpace | null;

  /**
   * Size of this space (width, height)
   */
  size: Vector2D;

  /**
   * How this space is allocated:
   * - 'empty': Space is available for allocation
   * - 'vertical': Space is split into left (0) and right (1)
   * - 'horizontal': Space is split into top (0) and bottom (1)
   */
  slice: 'empty' | 'vertical' | 'horizontal';

  /**
   * Left or top allocation (depending on slice type)
   * Can be either an UnpackedFrame (leaf) or another AtlasSpace (subdivision)
   */
  '0': UnpackedFrame | AtlasSpace | null;

  /**
   * Right or bottom allocation (depending on slice type)
   * Can be another AtlasSpace for remaining space, or null if perfect fit
   */
  '1': AtlasSpace | null;

  /**
   * Root atlas index (0-15) if this is a root space, otherwise -1
   */
  rootIndex: number;
}

/**
 * Frame bucket types for sorting during packing
 */
export type FrameBucket = 'w' | 'h' | 's';

/**
 * Helper function to create a root AtlasSpace
 */
export function createRootAtlasSpace(
  index: number,
  size: Vector2D,
): AtlasSpace {
  return {
    position: new Vector2D(0, 0),
    parent: null,
    size,
    slice: 'empty',
    '0': null,
    '1': null,
    rootIndex: index,
  };
}

/**
 * Helper function to create a child AtlasSpace
 */
export function createChildAtlasSpace(
  parent: AtlasSpace,
  position: Vector2D,
  size: Vector2D,
): AtlasSpace {
  return {
    position,
    parent,
    size,
    slice: 'empty',
    '0': null,
    '1': null,
    rootIndex: -1,
  };
}

/**
 * Determines which bucket a frame belongs to based on its dimensions.
 *
 * @param frame - UnpackedFrame to categorize
 * @returns 'w' if wider, 'h' if taller, 's' if square
 */
export function getFrameBucket(frame: UnpackedFrame): FrameBucket {
  if (frame.size.x > frame.size.y) return 'w';
  if (frame.size.y > frame.size.x) return 'h';
  return 's';
}

/**
 * Comparator for sorting frames by width (DESC) then height (DESC)
 */
export function compareByWidth(a: UnpackedFrame, b: UnpackedFrame): number {
  if (a.size.x !== b.size.x) {
    return b.size.x - a.size.x; // Wider first
  }
  return b.size.y - a.size.y; // Then taller first
}

/**
 * Comparator for sorting frames by height (DESC) then width (DESC)
 */
export function compareByHeight(a: UnpackedFrame, b: UnpackedFrame): number {
  if (a.size.y !== b.size.y) {
    return b.size.y - a.size.y; // Taller first
  }
  return b.size.x - a.size.x; // Then wider first
}

/**
 * Comparator for sorting square frames by size (DESC)
 */
export function compareBySize(a: UnpackedFrame, b: UnpackedFrame): number {
  return b.size.x - a.size.x; // Both dimensions are equal, so just compare one
}

/**
 * Comparator for sorting AtlasSpaces by width (ASC) then height (ASC)
 */
export function compareSpacesByWidth(a: AtlasSpace, b: AtlasSpace): number {
  if (a.size.x !== b.size.x) {
    return a.size.x - b.size.x; // Smaller width first
  }
  return a.size.y - b.size.y; // Then smaller height first
}

/**
 * Comparator for sorting AtlasSpaces by height (ASC) then width (ASC)
 */
export function compareSpacesByHeight(a: AtlasSpace, b: AtlasSpace): number {
  if (a.size.y !== b.size.y) {
    return a.size.y - b.size.y; // Smaller height first
  }
  return a.size.x - b.size.x; // Then smaller width first
}

/**
 * Comparator for sorting AtlasSpaces by size (ASC)
 */
export function compareSpacesBySize(a: AtlasSpace, b: AtlasSpace): number {
  const sizeA = a.size.x + a.size.y;
  const sizeB = b.size.x + b.size.y;
  return sizeA - sizeB; // Smaller first
}
