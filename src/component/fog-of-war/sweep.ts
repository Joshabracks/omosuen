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
  /** Inner radius -- full visibility at or inside it. */
  radius: number;
  /** Falloff width beyond `radius`; visibility reaches 0 at `radius + fadeWidth`. */
  fadeWidth: number;
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
 * Number of jittered line-of-sight rays per source, and the golden-angle disk
 * offsets they use -- a direct mirror of unified.frag's
 * `VISION_SCATTER_SAMPLES` / `visionSourceVisibility`. Derived here rather
 * than hardcoded as literals so the two stay in step if the constant changes.
 *
 * Note that NONE of the eight offsets is zero (the smallest magnitude is
 * `sqrt(0.5/8) * 0.75` = 0.1875 cells). A single un-jittered centre ray is
 * therefore not a member of this set, and can disagree with all eight of them
 * wherever a sight line threads a narrow aperture -- which is exactly the
 * mismatch this function exists to eliminate.
 */
const VISION_SCATTER_SAMPLES = 8;
const scatterOffsetX = new Float64Array(VISION_SCATTER_SAMPLES);
const scatterOffsetZ = new Float64Array(VISION_SCATTER_SAMPLES);
for (let i = 0; i < VISION_SCATTER_SAMPLES; i++) {
  const fi = i + 0.5;
  const a = fi * 2.39996323; // golden angle
  const mag = Math.sqrt(fi / VISION_SCATTER_SAMPLES) * 0.75;
  scatterOffsetX[i] = Math.cos(a) * mag;
  scatterOffsetZ[i] = Math.sin(a) * mag;
}

/** GLSL `smoothstep`. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Live fog-of-war visibility at a world point, 0..1 -- a deliberate mirror of
 * unified.frag's `visionSourceVisibility` + `computeVisibility`: a radial
 * smoothstep falloff from `radius` to `radius + fadeWidth`, times the fraction
 * of eight golden-angle-jittered rays that reach the point, maximised over
 * every source.
 *
 * This is the SINGLE source of truth for whether a sprite is visible. It used
 * to be computed twice -- once here (as a one-ray boolean) to drive
 * `_fowStatus` and phantom disposal, and again per fragment in the shader with
 * eight jittered rays to decide whether to draw. Those two disagreed wherever
 * the centre ray threaded a gap that the jittered ones did not, which left a
 * phantom disposed and its real sprite discarded: a hole where the entity
 * should be. `render-sprites.ts` now uploads this value as `u_spriteVisibility`
 * and the shader consumes it instead of recomputing, so a disagreement is no
 * longer expressible.
 *
 * The `u_fogLightInfluence` boost is deliberately NOT applied here -- it needs
 * a light-level walk but no raycasts, so it stays per-fragment in the shader
 * where it is cheap. This returns the pure-geometry term the shader boosts.
 */
export function computeSpriteVisibility(
  pos: { x: number; y: number; z: number },
  sources: ResolvedSource[],
  mask: Uint8Array,
  cellDims: { x: number; y: number; z: number },
  windowOriginLocalCell: { x: number; y: number; z: number },
  cellSize: { x: number; y: number; z: number },
): number {
  const localCellX = pos.x / cellSize.x - windowOriginLocalCell.x;
  const localCellY = pos.y / cellSize.y - windowOriginLocalCell.y;
  const localCellZ = pos.z / cellSize.z - windowOriginLocalCell.z;

  let best = 0;
  for (const source of sources) {
    const dx = pos.x - source.pos.x;
    const dy = pos.y - source.pos.y;
    const dz = pos.z - source.pos.z;
    const distSq = dx * dx + dy * dy + dz * dz;
    // Matches the shader's `if(dist >= outer) return 0.0` exactly.
    if (distSq >= source.outerSq) continue;

    const outer = source.radius + source.fadeWidth;
    // GLSL leaves smoothstep undefined when edge0 == edge1; a zero fadeWidth
    // is a hard-edged source, fully visible right up to `outer`.
    const radial =
      outer > source.radius
        ? 1 - smoothstep(source.radius, outer, Math.sqrt(distSq))
        : 1;
    if (radial <= best) continue; // can't beat the running max even at full LOS

    let hits = 0;
    for (let i = 0; i < VISION_SCATTER_SAMPLES; i++) {
      // The jitter is applied to the SOURCE, horizontally, in cell space --
      // same as `visionRaySample`. `isRayBlockedTS` already short-circuits
      // when origin and destination share a cell, which is what the shader's
      // explicit `floor(jitteredSource) == floor(fragCellPos)` check does.
      if (
        !isRayBlockedTS(
          mask,
          cellDims,
          source.localCell.x + scatterOffsetX[i],
          source.localCell.y,
          source.localCell.z + scatterOffsetZ[i],
          localCellX,
          localCellY,
          localCellZ,
        )
      ) {
        hits++;
      }
    }
    if (hits === 0) continue;

    const v = radial * (hits / VISION_SCATTER_SAMPLES);
    if (v > best) best = v;
    if (best >= 1) break;
  }
  return best;
}

/**
 * Cheap single-ray "can the player see this point" test: a distance reject per
 * source, then ONE un-jittered DDA ray.
 *
 * Deliberately NOT the same test as `computeSpriteVisibility` above, and
 * deliberately not "fixed" to match it. This is what terrain deferred
 * presentation uses (cell-map/deferred-presentation.ts) to decide whether a
 * cell write is observed, and it runs on every cell write plus once per
 * deferred cell per frame -- eight times the raycasts there would be a real
 * cost for no visible benefit, because terrain observation is a binary
 * bookkeeping decision with no cross-fading counterpart to stay in step with.
 * Sprites are the case that needs exactness, and they use the function above.
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
    //
    // Disposed only at FULL visibility, not the moment visibility becomes
    // non-zero. The shader cross-fades the pair -- real sprite at alpha
    // `vis`, phantom at `1 - vis` -- so the phantom has to outlive the fade
    // band or the two alphas stop summing to one and a hole opens up in the
    // middle of it. That hole is the bug this whole arrangement fixes.
    if (status === 'phantom') {
      if (
        computeSpriteVisibility(
          transforms[i].worldPosition,
          sources,
          mask,
          cellDims,
          windowOriginLocalCell,
          cellSize,
        ) >= 1
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

    // `> 0`, matching the shader's `discard` threshold exactly: a sprite
    // starts drawing as soon as it is even faintly visible, and the shader
    // fades it in from there. Any other threshold here would reintroduce a
    // band where the CPU and the GPU disagree about whether it should draw.
    if (
      computeSpriteVisibility(
        transform.worldPosition,
        sources,
        mask,
        cellDims,
        windowOriginLocalCell,
        cellSize,
      ) > 0
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
