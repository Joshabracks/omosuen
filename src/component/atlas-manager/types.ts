import { Vector2D } from '../../math';
import type { SpaceTree } from './space-tree';

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
   * May be a loaded HTMLImageElement (file path) or an in-memory canvas /
   * ImageBitmap (e.g. Aseprite-composited frames); drawImage accepts all of these.
   */
  sourceImage: CanvasImageSource;

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

  /**
   * Monotonic unique id, assigned at creation. Used as the stable tiebreak in the
   * free-space ordered sets (SpaceTree) so equal-size spaces keep insertion order
   * — matching the previous sorted-array packing exactly — and so removal can
   * locate a space by a unique key.
   */
  uid: number;
}

/**
 * Frame bucket types for sorting during packing
 */
export type FrameBucket = 'w' | 'h' | 's';

/**
 * A packed atlas region: where a unique frame ended up. Stored in the atlas
 * manager's `packedByKey` dedup map (retain mode) so re-referenced frames reuse
 * the region and genuinely new frames are detected on a runtime add.
 */
export interface PackedRegion {
  atlasIndex: number;
  atlasPosition: Vector2D;
  size: Vector2D;
}

/**
 * A rectangle of an atlas that changed in a particular (incremental) compile,
 * tagged with the atlasVersion that produced it. Retain mode logs these so a
 * camera can upload just the delta since its last-uploaded version via
 * texSubImage2D (reading the pixels from the retained canvas on demand) instead
 * of re-uploading the whole atlas. Stores only the rect — the canvas is the
 * source of truth, so a full re-upload is always a valid fallback.
 */
export interface AtlasDirtyRegion {
  version: number;
  atlasIndex: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Free-space ordered sets for finding best-fit space, keyed by different criteria
 * (width / height / size). Held inside PackerState so the free-space trees persist
 * across incremental adds (retain mode) instead of being rebuilt every compile.
 */
export interface SpaceBuckets {
  w: SpaceTree; // ordered by width then height
  h: SpaceTree; // ordered by height then width
  s: SpaceTree; // ordered by width+height
}

/**
 * Persistent guillotine-packer state. `packFrames` builds a throwaway one per
 * call (release/full compile); retain mode keeps one on the atlas manager so
 * `packFramesInto` can place new frames into the existing free space.
 */
export interface PackerState {
  rootSpaces: AtlasSpace[];
  spaceBuckets: SpaceBuckets;
  currentAtlasIndex: number;
  atlasSize: number;
  maxAtlases: number;
  padding: number;
}

// Monotonic source of AtlasSpace uids (unique tiebreak / removal key for the
// free-space ordered sets). Module-global; the absolute values don't matter, only
// that they're unique and increase with creation order (= stable insertion order).
let nextSpaceUid = 0;

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
    uid: nextSpaceUid++,
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
    uid: nextSpaceUid++,
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
