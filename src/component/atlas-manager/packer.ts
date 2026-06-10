import { Vector2D } from '../../math';
import type {
  UnpackedFrame,
  AtlasSpace,
  FrameBucket,
  SpaceBuckets,
  PackerState,
} from './types';
import {
  createRootAtlasSpace,
  createChildAtlasSpace,
  getFrameBucket,
  compareByWidth,
  compareByHeight,
  compareBySize,
  compareSpacesByWidth,
  compareSpacesByHeight,
  compareSpacesBySize,
} from './types';
import { SpaceTree } from './space-tree';

/**
 * Frame buckets for bin packing.
 * Frames are sorted into buckets based on their aspect ratio.
 */
interface FrameBuckets {
  w: UnpackedFrame[]; // Width > height
  h: UnpackedFrame[]; // Height > width
  s: UnpackedFrame[]; // Width === height (square)
}

// Free-space ordering for each bucket: the existing size comparators, made into a
// strict total order with a uid tiebreak (so equal-size spaces keep insertion
// order — identical to the old sorted-array packing).
const cmpW = (a: AtlasSpace, b: AtlasSpace): number =>
  compareSpacesByWidth(a, b) || a.uid - b.uid;
const cmpH = (a: AtlasSpace, b: AtlasSpace): number =>
  compareSpacesByHeight(a, b) || a.uid - b.uid;
const cmpS = (a: AtlasSpace, b: AtlasSpace): number =>
  compareSpacesBySize(a, b) || a.uid - b.uid;

/**
 * Builds the three empty free-space ordered sets (width / height / size keyed).
 */
function createSpaceBuckets(): SpaceBuckets {
  return {
    // width-keyed → residual fit dimension is height.
    w: new SpaceTree({
      cmp: cmpW,
      primary: (s) => s.size.x,
      primaryMin: (x) => x,
      secondary: (s) => s.size.y,
      secondaryMin: (_x, y) => y,
    }),
    // height-keyed → residual fit dimension is width.
    h: new SpaceTree({
      cmp: cmpH,
      primary: (s) => s.size.y,
      primaryMin: (_x, y) => y,
      secondary: (s) => s.size.x,
      secondaryMin: (x) => x,
    }),
    // size-keyed (square frames only: needX === needY, so x≥n && y≥n ⇔ min≥n).
    s: new SpaceTree({
      cmp: cmpS,
      primary: (s) => s.size.x + s.size.y,
      primaryMin: (x, y) => x + y,
      secondary: (s) => Math.min(s.size.x, s.size.y),
      secondaryMin: (x) => x,
    }),
  };
}

/** Inserts a free space into all three buckets. */
function addSpaceToBuckets(
  spaceBuckets: SpaceBuckets,
  space: AtlasSpace,
): void {
  spaceBuckets.w.insert(space);
  spaceBuckets.h.insert(space);
  spaceBuckets.s.insert(space);
}

/** Removes a free space from all three buckets. */
function removeSpaceFromBuckets(
  spaceBuckets: SpaceBuckets,
  space: AtlasSpace,
): void {
  spaceBuckets.w.remove(space);
  spaceBuckets.h.remove(space);
  spaceBuckets.s.remove(space);
}

/**
 * Creates a fresh persistent packer state: `maxAtlases` empty root spaces, with
 * only the first atlas's free space initially available (subsequent atlases are
 * opened lazily as frames overflow). Retain mode keeps one of these on the atlas
 * manager so incremental adds reuse the accumulated free space.
 */
export function createPackerState(
  atlasSize: number,
  maxAtlases: number,
  padding: number,
): PackerState {
  const rootSpaces: AtlasSpace[] = [];
  for (let i = 0; i < maxAtlases; i++) {
    rootSpaces.push(
      createRootAtlasSpace(i, new Vector2D(atlasSize, atlasSize)),
    );
  }
  const spaceBuckets = createSpaceBuckets();
  // Only the first atlas's free space is available initially; subsequent atlases
  // are opened lazily as frames overflow.
  addSpaceToBuckets(spaceBuckets, rootSpaces[0]);
  return {
    rootSpaces,
    spaceBuckets,
    currentAtlasIndex: 0,
    atlasSize,
    maxAtlases,
    padding,
  };
}

/**
 * Packs `frames` into the (possibly already-partially-filled) packer `state`,
 * mutating its free-space tree and assigning each frame's `atlasIndex` /
 * `atlasPosition`. Used by both the full compile (via `packFrames`, a fresh
 * state) and incremental runtime adds (a retained state). Returns the same
 * frames, now positioned.
 *
 * @throws Error if a frame cannot fit in any available atlas
 */
export function packFramesInto(
  state: PackerState,
  frames: UnpackedFrame[],
): UnpackedFrame[] {
  if (frames.length === 0) {
    return [];
  }

  const { rootSpaces, spaceBuckets, atlasSize, maxAtlases, padding } = state;

  // Sort frames into buckets (DESC, largest first)
  const frameBuckets = sortFramesIntoBuckets(frames);

  const packedFrames: UnpackedFrame[] = [];

  // Consume each bucket front-to-back via an index (not shift()/unshift(), which
  // are O(n) and would make a large pack O(N²)). A frame that doesn't fit is
  // retried against the next atlas by simply not advancing its index.
  const idx: Record<FrameBucket, number> = { w: 0, h: 0, s: 0 };

  // Pack frames by rotating through buckets (h -> w -> s)
  while (
    idx.h < frameBuckets.h.length ||
    idx.w < frameBuckets.w.length ||
    idx.s < frameBuckets.s.length
  ) {
    // Determine which bucket to pull from (peek, don't advance yet)
    let bucketType: FrameBucket;
    if (idx.h < frameBuckets.h.length) bucketType = 'h';
    else if (idx.w < frameBuckets.w.length) bucketType = 'w';
    else bucketType = 's';
    const frame = frameBuckets[bucketType][idx[bucketType]];

    // Find best-fit space for this frame (including padding)
    const paddedSize = new Vector2D(
      frame.size.x + padding,
      frame.size.y + padding,
    );
    const space = spaceBuckets[bucketType].findBestFit(
      paddedSize.x,
      paddedSize.y,
    );

    if (!space) {
      // No space found, try next atlas
      state.currentAtlasIndex++;
      if (state.currentAtlasIndex >= maxAtlases) {
        throw new Error(
          `Cannot fit frame (${frame.size.x}x${frame.size.y}) into any available atlas. ` +
            `MaxAtlases: ${maxAtlases}, AtlasSize: ${atlasSize}x${atlasSize}`,
        );
      }

      // Open the next atlas: add its root free space to the buckets, then retry
      // the same frame (index not advanced).
      addSpaceToBuckets(spaceBuckets, rootSpaces[state.currentAtlasIndex]);
      continue;
    }

    // Allocate frame to space
    allocateFrameToSpace(frame, space, padding);
    packedFrames.push(frame);
    idx[bucketType]++;

    // Remove allocated space from available spaces
    removeSpaceFromBuckets(spaceBuckets, space);

    // Collect and add all new available spaces from subdivision tree
    const newSpaces = collectAvailableSpaces(space);
    for (const newSpace of newSpaces) {
      addSpaceToBuckets(spaceBuckets, newSpace);
    }
  }

  return packedFrames;
}

/**
 * Packs unpacked frames into atlases using the guillotine bin packing algorithm.
 * Thin wrapper over a throwaway PackerState — preserves the original behaviour
 * and layout for the full-compile path and tests.
 *
 * @param frames - Array of unpacked frames to pack
 * @param atlasSize - Size of each atlas (power of 2)
 * @param maxAtlases - Maximum number of atlases (1-16)
 * @param padding - Padding between frames in pixels
 * @returns Array of packed frames with atlas positions
 * @throws Error if frames cannot fit in available atlases
 */
export function packFrames(
  frames: UnpackedFrame[],
  atlasSize: number,
  maxAtlases: number,
  padding: number,
): UnpackedFrame[] {
  const state = createPackerState(atlasSize, maxAtlases, padding);
  return packFramesInto(state, frames);
}

/**
 * Sorts frames into buckets based on aspect ratio and sorts each bucket.
 */
function sortFramesIntoBuckets(frames: UnpackedFrame[]): FrameBuckets {
  const buckets: FrameBuckets = { w: [], h: [], s: [] };

  for (const frame of frames) {
    const bucket = getFrameBucket(frame);
    buckets[bucket].push(frame);
  }

  // Sort each bucket (DESC - largest first)
  buckets.w.sort(compareByWidth);
  buckets.h.sort(compareByHeight);
  buckets.s.sort(compareBySize);

  return buckets;
}

/**
 * Allocates a frame to an atlas space and subdivides the space.
 */
function allocateFrameToSpace(
  frame: UnpackedFrame,
  space: AtlasSpace,
  padding: number,
): void {
  // Calculate absolute position by climbing parent tree
  const absolutePosition = calculateAbsolutePosition(space);
  frame.atlasPosition = absolutePosition;
  frame.atlasIndex = getRootIndex(space);

  // Check if perfect fit (no subdivision needed)
  const paddedSize = new Vector2D(
    frame.size.x + padding,
    frame.size.y + padding,
  );
  if (space.size.x === paddedSize.x && space.size.y === paddedSize.y) {
    space.slice = 'horizontal';
    space['0'] = frame;
    space['1'] = null;
    return;
  }

  // Determine slice direction based on frame aspect ratio
  const isWider = frame.size.x > frame.size.y;
  const canSliceVertically = space.size.x > paddedSize.x;
  const canSliceHorizontally = space.size.y > paddedSize.y;

  // Prefer even splitting
  let sliceVertically: boolean;
  if (isWider && canSliceVertically) {
    sliceVertically = true;
  } else if (!isWider && canSliceHorizontally) {
    sliceVertically = false;
  } else if (canSliceVertically) {
    sliceVertically = true;
  } else if (canSliceHorizontally) {
    sliceVertically = false;
  } else {
    // Should not happen if space was properly selected
    throw new Error('Cannot slice space for frame allocation');
  }

  if (sliceVertically) {
    // Create vertical slice (left + right)
    const leftSpace = createChildAtlasSpace(
      space,
      new Vector2D(0, 0),
      new Vector2D(paddedSize.x, space.size.y),
    );
    const rightSpace = createChildAtlasSpace(
      space,
      new Vector2D(paddedSize.x, 0),
      new Vector2D(space.size.x - paddedSize.x, space.size.y),
    );

    space.slice = 'vertical';
    space['0'] = leftSpace;
    space['1'] = rightSpace;

    // Now allocate frame to left space (may need horizontal subdivision)
    if (leftSpace.size.y === paddedSize.y) {
      // Perfect vertical fit
      leftSpace.slice = 'horizontal';
      leftSpace['0'] = frame;
      leftSpace['1'] = null;
    } else {
      // Need horizontal subdivision
      leftSpace.slice = 'horizontal';
      leftSpace['0'] = frame;
      leftSpace['1'] = createChildAtlasSpace(
        leftSpace,
        new Vector2D(0, paddedSize.y),
        new Vector2D(paddedSize.x, leftSpace.size.y - paddedSize.y),
      );
    }
  } else {
    // Create horizontal slice (top + bottom)
    const topSpace = createChildAtlasSpace(
      space,
      new Vector2D(0, 0),
      new Vector2D(space.size.x, paddedSize.y),
    );
    const bottomSpace = createChildAtlasSpace(
      space,
      new Vector2D(0, paddedSize.y),
      new Vector2D(space.size.x, space.size.y - paddedSize.y),
    );

    space.slice = 'horizontal';
    space['0'] = topSpace;
    space['1'] = bottomSpace;

    // Now allocate frame to top space (may need vertical subdivision)
    if (topSpace.size.x === paddedSize.x) {
      // Perfect horizontal fit
      topSpace.slice = 'vertical';
      topSpace['0'] = frame;
      topSpace['1'] = null;
    } else {
      // Need vertical subdivision
      topSpace.slice = 'vertical';
      topSpace['0'] = frame;
      topSpace['1'] = createChildAtlasSpace(
        topSpace,
        new Vector2D(paddedSize.x, 0),
        new Vector2D(topSpace.size.x - paddedSize.x, paddedSize.y),
      );
    }
  }
}

/**
 * Calculates absolute position by climbing parent tree.
 */
function calculateAbsolutePosition(space: AtlasSpace): Vector2D {
  let position = new Vector2D(space.position.x, space.position.y);
  let current = space.parent;

  while (current !== null) {
    position = position.add(current.position);
    current = current.parent;
  }

  return position;
}

/**
 * Gets root atlas index by climbing parent tree.
 */
function getRootIndex(space: AtlasSpace): number {
  let current: AtlasSpace = space;
  while (current.parent !== null) {
    current = current.parent;
  }
  return current.rootIndex;
}

/**
 * Collects all available (unallocated) spaces from a subdivision tree.
 * Recursively walks the tree and returns all leaf spaces that can still be used.
 *
 * @param space - The root space to collect from
 * @returns Array of available AtlasSpace objects
 */
function collectAvailableSpaces(space: AtlasSpace): AtlasSpace[] {
  const spaces: AtlasSpace[] = [];

  // If this is a leaf space (no children), it's not available (occupied by frame)
  if (!space['0'] && !space['1']) {
    return spaces;
  }

  // Check child '0' (allocated side)
  if (space['0']) {
    // Check if it's an AtlasSpace (has 'position' property) or a frame
    if (typeof space['0'] === 'object' && 'position' in space['0']) {
      // It's an AtlasSpace, recurse to find any nested remainder spaces
      spaces.push(...collectAvailableSpaces(space['0'] as AtlasSpace));
    }
    // If it's a frame (UnpackedFrame), skip it - it's allocated
  }

  // Check child '1' (remainder side)
  if (space['1']) {
    // Child '1' is always an AtlasSpace (the remainder from subdivision)
    // Add it directly as an available space
    spaces.push(space['1']);
    // Also check if child '1' has its own subdivisions
    spaces.push(...collectAvailableSpaces(space['1']));
  }

  return spaces;
}
