// Retain-mode atlas space reclamation. A leaf module (packer + types only) so it
// can be exercised headlessly by `npm run test:atlas-reclaim`; methods.ts pulls
// in the component registry and can't be.

import { freeFrameSlot } from './packer';
import type { AtlasDirtyRegion, PackedRegion, PackerState } from './types';
import type { Vector2D } from '../../math';

/**
 * Frees every packed region whose frame key is no longer referenced by any
 * registered texture-map, returning its rect to the packer's free space so the
 * next `packFramesInto` can reuse it for a frame of the same or smaller size.
 *
 * Driven purely by the live set — no reference counts to drift: a key is live
 * iff some registered texture-map's `originalFrames` maps to it this compile.
 * Disposing a texture-map, or trimming its `originalFrames`, is therefore all a
 * caller does to release atlas space.
 *
 * Regions without a `slot` (none are created that way today) are dropped from
 * the map but their space can't be reclaimed.
 *
 * @returns How many regions were released.
 */
export function reclaimUnreferenced(
  packState: PackerState,
  packedByKey: Map<string, PackedRegion>,
  liveKeys: ReadonlySet<string>,
): number {
  let released = 0;
  // Deleting the current entry during Map iteration is well-defined in JS.
  for (const [key, region] of packedByKey) {
    if (liveKeys.has(key)) continue;
    if (region.slot) freeFrameSlot(packState, region.slot);
    packedByKey.delete(key);
    released++;
  }
  return released;
}

/**
 * The atlas rect a newly-blitted frame owns: its size plus the trailing
 * padding gutter, clamped to the atlas bounds (texSubImage2D rejects a rect
 * that overruns the texture). Used both to clear a possibly-reused slot before
 * the blit and as the dirty region uploaded to the GPU, so stale pixels from a
 * previous occupant never survive in the gutter either.
 */
export function paddedRect(
  atlasIndex: number,
  position: Vector2D,
  size: Vector2D,
  padding: number,
  atlasSize: number,
): Omit<AtlasDirtyRegion, 'version'> {
  const x = position.x;
  const y = position.y;
  return {
    atlasIndex,
    x,
    y,
    w: Math.min(size.x + padding, atlasSize - x),
    h: Math.min(size.y + padding, atlasSize - y),
  };
}
