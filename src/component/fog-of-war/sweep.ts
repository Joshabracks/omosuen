/**
 * The fog-of-war sweep proper: the per-frame decision about which tracked
 * sprites are currently visible.
 *
 * A leaf module -- its only runtime import is the DDA raycast, everything
 * else is `import type` and therefore erased. That is deliberate: it keeps
 * this loadable standalone (see test/fog-of-war-sweep.test.ts) without the
 * component registry, which transitively pulls in camera/init's raw
 * .vert/.frag shader imports. Same split, and same reason, as
 * camera/screen-pick/projection-math.ts.
 *
 * Consequently the sweep DECIDES but never ACTS: phantoms to spawn and
 * phantoms to dispose are reported through out-parameters and the caller
 * (methods.ts) performs the actual `newComponent` / `markForDisposal`.
 * That split is load-bearing for a second reason -- see `sweepFogOfWar`.
 */

import { isRayBlockedTS } from '../camera/render/ray-blocked';
import type { NexusT } from '../nexus/data';
import type { SpriteT } from '../sprite/data';
import type { TransformT } from '../transform/data';

/** A vision source resolved to a plain world position, once per fog-of-war update tick. */
export interface ResolvedSource {
  pos: { x: number; y: number; z: number };
  /**
   * `pos` expressed in window-local cell space -- the form `isRayBlockedTS`
   * actually wants. Depends only on the source, so it's computed once per
   * frame rather than re-derived per (sprite x source) inside
   * `isPositionVisible`.
   */
  localCell: { x: number; y: number; z: number };
  /** `(radius + fadeWidth)^2`, pre-squared for the distance reject. */
  outerSq: number;
}

/** A `visible` -> not-visible transition found by the sweep. */
export interface ObscuredTransition {
  sprite: SpriteT;
  transform: TransformT;
}

/**
 * The subset of `sceneIndex` (scene-index.ts) the sweep reads. Declared
 * structurally so a test can hand it fabricated arrays without standing up a
 * scene tree.
 */
export interface FogSweepIndex {
  count: number;
  nexuses: NexusT[];
  transforms: TransformT[];
  sprites: SpriteT[];
  selfLit: boolean[];
}

/**
 * Real (accurate, per-fragment-matching) visibility test for a single
 * world point: early distance-squared reject per source (cheap), then the
 * same DDA raycast the live shader path and the explored-chunk sweep both
 * use, so a tracked sprite's visible/obscured transition agrees with what
 * the per-pixel shader test would actually show.
 */
export function isPositionVisible(
  pos: { x: number; y: number; z: number },
  sources: ResolvedSource[],
  mask: Uint8Array,
  cellDims: { x: number; y: number; z: number },
  windowOriginLocalCell: { x: number; y: number; z: number },
  cellSize: { x: number; y: number; z: number },
): boolean {
  const localCellX = pos.x / cellSize.x - windowOriginLocalCell.x;
  const localCellY = pos.y / cellSize.y - windowOriginLocalCell.y;
  const localCellZ = pos.z / cellSize.z - windowOriginLocalCell.z;

  for (const source of sources) {
    const dx = pos.x - source.pos.x;
    const dy = pos.y - source.pos.y;
    const dz = pos.z - source.pos.z;
    if (dx * dx + dy * dy + dz * dz >= source.outerSq) continue;

    if (
      !isRayBlockedTS(
        mask,
        cellDims,
        source.localCell.x,
        source.localCell.y,
        source.localCell.z,
        localCellX,
        localCellY,
        localCellZ,
      )
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Transitions every indexed sprite's `_fowStatus`, reporting the
 * `visible` -> not-visible edges via `newlyObscured` and the phantoms whose
 * frozen positions are visible again via `revealedPhantoms`. Both are
 * out-parameters, so the caller owns the arrays and the sweep allocates
 * nothing.
 *
 * PURELY SYNCHRONOUS, and must stay that way. `mask` is a view straight over
 * WASM linear memory which the next `solidity_run()` rewrites and a WASM
 * memory growth can DETACH. Awaiting anywhere in here would resume holding a
 * possibly-detached view, where every `mask[i]` reads `undefined`,
 * `undefined > 127` is false, so every cell looks non-solid and every
 * remaining sprite reads as visible -- occlusion silently failing open, with
 * no error and no crash. That is why the caller acts on these arrays only
 * after the sweep has returned.
 *
 * Note there is NO zero-source guard here: sweeping with no sources obscures
 * every visible sprite at once. The caller must bail before reaching this.
 */
export function sweepFogOfWar(
  index: FogSweepIndex,
  sources: ResolvedSource[],
  mask: Uint8Array,
  cellDims: { x: number; y: number; z: number },
  windowOriginLocalCell: { x: number; y: number; z: number },
  cellSize: { x: number; y: number; z: number },
  newlyObscured: ObscuredTransition[],
  revealedPhantoms: NexusT[],
): void {
  const { nexuses, transforms, sprites, selfLit } = index;

  for (let i = 0; i < index.count; i++) {
    const sprite = sprites[i];
    // The index is built during the previous frame's on-screen pass, so an
    // entry can name a sprite disposed since. Skipping it also keeps a
    // phantom from being spawned for something that no longer exists.
    if (sprite._disposed === true) continue;

    const status = sprite._fowStatus;

    // A spawned phantom: check whether vision has returned to ITS OWN
    // (frozen) position, independent of wherever the real sprite it
    // stood in for currently is.
    if (status === 'phantom') {
      if (
        isPositionVisible(
          transforms[i].worldPosition,
          sources,
          mask,
          cellDims,
          windowOriginLocalCell,
          cellSize,
        )
      ) {
        revealedPhantoms.push(nexuses[i]);
      }
      continue;
    }

    // Cheapest rejects first: both of these are plain field reads, whereas
    // everything below reaches into the transform and the solidity mask.
    if (sprite.trackedByFog !== true) continue;
    // A sprite carrying its own vision-source always sees itself -- never
    // obscure/phantom it (render-sprites.ts also defensively forces such a
    // sprite to draw live regardless of `_fowStatus`). Resolved during the
    // scene-index walk rather than by a per-sprite `getComponentByType`.
    if (selfLit[i]) continue;

    const transform = transforms[i];

    if (
      isPositionVisible(
        transform.worldPosition,
        sources,
        mask,
        cellDims,
        windowOriginLocalCell,
        cellSize,
      )
    ) {
      // Covers both 'unseen' -> 'visible' (first-ever sighting) and
      // 'obscured' -> 'visible' (seen again after going out of sight).
      if (status !== 'visible') sprite._fowStatus = 'visible';
      continue;
    }
    // Phantom-spawning is gated strictly on the 'visible' -> not-visible
    // edge -- an 'unseen' sprite that's simply never been seen stays
    // 'unseen' forever here, exactly like terrain's "never explored"
    // stays hidden. Spawning a phantom for a never-seen sprite was the
    // actual bug: every off-screen sprite (trackedByFog defaults true)
    // would otherwise get a permanent phantom the instant fog-of-war
    // first evaluated it, regardless of whether it had ever really been
    // observed -- see the Colony Forever perf report this fixed.
    if (status === 'visible') {
      sprite._fowStatus = 'obscured';
      newlyObscured.push({ sprite, transform });
    }
  }
}
