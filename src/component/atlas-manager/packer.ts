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

/**
 * Frame buckets for bin packing.
 * Frames are sorted into buckets based on their aspect ratio.
 */
interface FrameBuckets {
  w: UnpackedFrame[]; // Width > height
  h: UnpackedFrame[]; // Height > width
  s: UnpackedFrame[]; // Width === height (square)
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
  return {
    rootSpaces,
    spaceBuckets: {
      w: [rootSpaces[0]],
      h: [rootSpaces[0]],
      s: [rootSpaces[0]],
    },
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

  // Sort frames into buckets
  const frameBuckets = sortFramesIntoBuckets(frames);

  const packedFrames: UnpackedFrame[] = [];

  // Pack frames by rotating through buckets
  while (
    frameBuckets.h.length > 0 ||
    frameBuckets.w.length > 0 ||
    frameBuckets.s.length > 0
  ) {
    // Determine which bucket to pull from (h -> w -> s rotation)
    let frame: UnpackedFrame | undefined;
    let bucketType: FrameBucket;

    if (frameBuckets.h.length > 0) {
      frame = frameBuckets.h.shift();
      bucketType = 'h';
    } else if (frameBuckets.w.length > 0) {
      frame = frameBuckets.w.shift();
      bucketType = 'w';
    } else {
      frame = frameBuckets.s.shift();
      bucketType = 's';
    }

    if (!frame) break;

    // Find best-fit space for this frame (including padding)
    const paddedSize = new Vector2D(
      frame.size.x + padding,
      frame.size.y + padding,
    );
    const space = findBestFitSpace(spaceBuckets, paddedSize, bucketType);

    if (!space) {
      // No space found, try next atlas
      state.currentAtlasIndex++;
      if (state.currentAtlasIndex >= maxAtlases) {
        throw new Error(
          `Cannot fit frame (${frame.size.x}x${frame.size.y}) into any available atlas. ` +
            `MaxAtlases: ${maxAtlases}, AtlasSize: ${atlasSize}x${atlasSize}`,
        );
      }

      // Add next root atlas to available spaces
      const nextRoot = rootSpaces[state.currentAtlasIndex];
      spaceBuckets.w.push(nextRoot);
      spaceBuckets.h.push(nextRoot);
      spaceBuckets.s.push(nextRoot);
      sortSpaceBuckets(spaceBuckets);

      // Try again with the same frame
      frameBuckets[bucketType].unshift(frame);
      continue;
    }

    // Allocate frame to space
    allocateFrameToSpace(frame, space, padding);
    packedFrames.push(frame);

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
 * Finds the best-fit space for a frame based on bucket type.
 */
function findBestFitSpace(
  spaceBuckets: SpaceBuckets,
  size: Vector2D,
  bucketType: FrameBucket,
): AtlasSpace | null {
  let candidates: AtlasSpace[];

  // Select candidate spaces based on bucket type
  if (bucketType === 'h') {
    // For tall frames, prioritize spaces sorted by height
    candidates = spaceBuckets.h;
  } else if (bucketType === 'w') {
    // For wide frames, prioritize spaces sorted by width
    candidates = spaceBuckets.w;
  } else {
    // For square frames, use spaces sorted by total size
    candidates = spaceBuckets.s;
  }

  // First pass: look for exact fit
  for (const space of candidates) {
    if (space.size.x === size.x && space.size.y === size.y) {
      return space;
    }
  }

  // Second pass: look for smallest space that fits
  for (const space of candidates) {
    if (space.size.x >= size.x && space.size.y >= size.y) {
      return space;
    }
  }

  return null;
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
 * Sorts all space buckets.
 */
function sortSpaceBuckets(spaceBuckets: SpaceBuckets): void {
  spaceBuckets.w.sort(compareSpacesByWidth);
  spaceBuckets.h.sort(compareSpacesByHeight);
  spaceBuckets.s.sort(compareSpacesBySize);
}

/**
 * Inserts `item` into an already-sorted array at its sorted position (binary
 * search + splice), keeping the array sorted without a full re-sort. Equal
 * elements are inserted *after* existing ones, matching the previous
 * push-then-stable-sort behaviour (so packing layout is unchanged).
 */
function sortedInsert<T>(arr: T[], item: T, cmp: (a: T, b: T) => number): void {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (cmp(item, arr[mid]) < 0) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }
  arr.splice(lo, 0, item);
}

/**
 * Removes a space from all buckets in place (index + splice), avoiding the
 * whole-array rebuild a `filter` would do every allocation.
 */
function removeSpaceFromBuckets(
  spaceBuckets: SpaceBuckets,
  space: AtlasSpace,
): void {
  const wi = spaceBuckets.w.indexOf(space);
  if (wi !== -1) spaceBuckets.w.splice(wi, 1);
  const hi = spaceBuckets.h.indexOf(space);
  if (hi !== -1) spaceBuckets.h.splice(hi, 1);
  const si = spaceBuckets.s.indexOf(space);
  if (si !== -1) spaceBuckets.s.splice(si, 1);
}

/**
 * Adds a space to all buckets at its sorted position (no full re-sort of each
 * bucket every allocation — the old O(n log n)×3-per-frame cost).
 */
function addSpaceToBuckets(
  spaceBuckets: SpaceBuckets,
  space: AtlasSpace,
): void {
  sortedInsert(spaceBuckets.w, space, compareSpacesByWidth);
  sortedInsert(spaceBuckets.h, space, compareSpacesByHeight);
  sortedInsert(spaceBuckets.s, space, compareSpacesBySize);
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
