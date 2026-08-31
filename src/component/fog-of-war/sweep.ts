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

/**
 * How far a sprite may drift from where its phantom was spawned and still
 * count as "standing in the same place". Generous enough to absorb float
 * noise in a composed world transform, tight enough that a unit taking even
 * one step reads as having moved on.
 */
const PHANTOM_COINCIDENCE_EPSILON = 0.01;

/**
 * How much of a look it takes before a memory starts dissolving.
 *
 * A phantom is frozen at the point visibility hit exactly ZERO -- the outer edge
 * of the falloff -- so a `> 0` bar has no hysteresis at all against the very
 * edge that created it. Worse, the sweep reads a scene index and world
 * transforms one to two frames stale (a phantom is not even indexed until the
 * frame after it spawns), so a source drifting a fraction of a cell inward
 * re-revealed a phantom within a frame or two of its birth and latched a
 * dissolve that never runs backwards. The unit vanished, its memory flickered
 * and died, and nothing was left behind.
 *
 * Above this bar the source has had to genuinely close on the spot rather than
 * merely graze it, which is what "you looked and nothing was there" should
 * mean. A tunable starting default, same status as `EDGE_PAD_PX` /
 * `EDGE_PAD_WORLD`.
 */
export const PHANTOM_REVEAL_VISIBILITY = 0.35;

/**
 * How far a new freeze point may sit from an existing phantom's and still count
 * as "the same place", in world units.
 *
 * A sprite may hold SEVERAL memories -- one per place it was last seen before
 * being lost -- and each stands until vision reaches it. But a unit milling
 * about on the vision boundary re-crosses it in essentially one spot, and
 * without this those crossings would stack a pile of coincident memories. Far
 * looser than `PHANTOM_COINCIDENCE_EPSILON`, which asks the much stricter
 * question of whether a sprite is standing EXACTLY on its own phantom.
 */
export const PHANTOM_RESPAWN_RADIUS = 0.75;

/** Whether two world points are close enough to share one memory. */
export function isSamePhantomPlace(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): boolean {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return (
    dx * dx + dy * dy + dz * dz <=
    PHANTOM_RESPAWN_RADIUS * PHANTOM_RESPAWN_RADIUS
  );
}

/**
 * Whether a phantom currently has its own sprite drawing on top of it -- in
 * which case it must NOT fade.
 *
 * A phantom is the opaque backdrop its sprite fades back in over. Two stacked
 * draws only cross-dissolve cleanly while the lower one stays solid: with the
 * phantom at constant memory opacity and only the sprite's alpha ramping, the
 * composite is exactly `L*v + M*(1-v)`. Fade them BOTH and the background
 * leaks through the middle instead (`a(1-a)`, up to 25% at the midpoint).
 *
 * `spawnPos` is where the phantom was frozen. A sprite that has since moved on
 * is not standing over it, so nothing is covering that phantom and it fades
 * out normally -- looking at an abandoned spot should dissolve the memory away
 * rather than blink it out.
 *
 * Either way the phantom is disposed at full visibility (`sweepFogOfWar`); by
 * then a coincident sprite is completely opaque, so its removal cannot show.
 */
export function phantomSupersededBySprite(
  sprite: SpriteT | null | undefined,
  transform: TransformT | null | undefined,
  spawnPos: { x: number; y: number; z: number },
): boolean {
  if (!sprite || !transform) return false;
  if (sprite._disposed === true) return false;
  // Both of these are SKIP states -- render-sprites submits neither, so nothing
  // is covering the phantom and it must stay. Keep this list in step with the
  // `'skip'` cases of `fogDrawKind`: a phantom pinned solid by a sprite that
  // never draws would never be disposed.
  if (sprite._fowStatus === 'obscured' || sprite._fowStatus === 'unseen') {
    return false;
  }

  const p = transform.worldPosition;
  return (
    Math.abs(p.x - spawnPos.x) <= PHANTOM_COINCIDENCE_EPSILON &&
    Math.abs(p.y - spawnPos.y) <= PHANTOM_COINCIDENCE_EPSILON &&
    Math.abs(p.z - spawnPos.z) <= PHANTOM_COINCIDENCE_EPSILON
  );
}

/**
 * Which way a sprite should be drawn, given its fog state. Mirrors the branch
 * structure of unified.frag's sprite path exactly.
 *
 * - `'skip'` -- not submitted at all; its phantom draws instead.
 * - `'memory'` -- the fog memory look, fading out only as vision returns.
 *   Discards at FULL visibility.
 * - `'live'` -- colour blended from the memory look toward live by DISTANCE,
 *   at an opacity supplied separately by the presence ramp. Never discards.
 *
 * There is deliberately no separate "revealing" kind. Colour is a pure
 * function of distance for every live sprite, entering or leaving, so nothing
 * here needs to know which direction a sprite is travelling -- which is what
 * let the `vis >= 1` latch that broke partial reveals go away. Opacity carries
 * the direction instead, on a timer.
 *
 * `'unseen'` -- never observed at all -- is a SKIP, matching terrain's
 * never-explored cells. It has to be decided here rather than in the shader:
 * the shader only knows `fogVis`, which cannot tell "never seen" from "leaving
 * vision", and discarding a live sprite at zero visibility blanked one frame off
 * every exit (the sweep runs a phase earlier, off a stale index). So the live
 * branch never discards and this hides never-seen sprites instead. Letting them
 * fall through to `'live'` is what left every unexplored prop drawn in the
 * memory look -- and every unexplored ANIMAL visibly walking around inside the
 * fog, which is how the regression was spotted.
 */
export type FogDrawKind = 'skip' | 'memory' | 'live';

export function fogDrawKind(
  status: SpriteT['_fowStatus'],
  hasOwnVisionSource: boolean,
  trackedByFog: boolean,
  fogActive: boolean,
): FogDrawKind {
  // FIRST, before the opt-out below: a phantom is itself `trackedByFog: false`
  // (see `spawnPhantom`), so answering that guard first would draw every memory
  // as a live sprite.
  if (status === 'phantom') return 'memory';
  // A sprite carrying its own vision source always sees itself, so fog never
  // restyles or hides it (render-time half of the guarantee `sweepFogOfWar`
  // already makes by never obscuring such a sprite).
  //
  // The other two guards are what keep the `'unseen'` skip below from blanking
  // the screen. A `trackedByFog: false` sprite is skipped by the sweep and so
  // stays `'unseen'` forever; so does EVERY sprite in a scene with no fog-of-war
  // component or no enabled vision source. `fogActive` mirrors the conditions
  // under which `FogOfWar.update` bails without sweeping at all, so the renderer
  // and the sweep agree on when fog governs anything.
  if (hasOwnVisionSource || !trackedByFog || !fogActive) return 'live';
  switch (status) {
    case 'unseen':
      // Never seen at all, so there is nothing to remember and nothing to show.
      return 'skip';
    case 'obscured':
      return 'skip';
    case 'obscuring':
      // No phantom yet -- for these frames this sprite IS the memory, and must
      // take the same branch the phantom will so the swap is invisible.
      return 'memory';
    case 'visible':
      return 'live';
  }
}

/**
 * Whether unified.frag's sprite path discards this draw outright, given its
 * branch and visibility. A mirror of the discard guards in that shader.
 *
 * Exists because these thresholds have twice produced a silently blank sprite
 * that no CPU-side test could see:
 *
 *   - `'memory'` discards at FULL visibility. Routing `'obscuring'` (which
 *     sits at zero) to the live branch made its hold draw nothing.
 *   - The live branch used to discard at ZERO. The sweep runs a phase earlier
 *     than the renderer, off last frame's transforms, so on the frame a sprite
 *     crosses zero the renderer sees 0 while the sweep still has it 'visible'
 *     -- and that one-frame disagreement became a blank frame every time a
 *     sprite left vision. It no longer discards: a live sprite at zero renders
 *     its memory look, identical to the hold that follows.
 *
 * It has no runtime caller: the shader is the only thing that actually
 * discards. It exists so those thresholds are written down somewhere a test
 * can reach them, and it must be kept in step with unified.frag by hand -- the
 * two blank-frame bugs above were both invisible to this suite precisely
 * because the rule lived only in GLSL.
 */
export function fogDiscards(kind: FogDrawKind, vis: number): boolean {
  switch (kind) {
    case 'skip':
      return true;
    case 'memory':
      return vis >= 1;
    case 'live':
      // Never. See above.
      return false;
  }
}

/**
 * How long a sprite takes to fade in, and a phantom to dissolve away.
 *
 * Time rather than distance because a distance-driven fade is only as
 * monotonic as the thing driving it: a source that stops closing leaves the
 * animation stalled part-way, and one that retreats runs it backwards. A timer
 * always completes. Colour stays distance-driven -- that part SHOULD track the
 * source, and reversing it reads correctly.
 */
export const FOG_FADE_SECONDS = 0.25;

/** Fraction of a full fade covered by `deltaTimeMs` (the loop's own unit). */
export function fogFadeStep(deltaTimeMs: number): number {
  return Math.max(0, deltaTimeMs) / 1000 / FOG_FADE_SECONDS;
}

/** Advances a 0..1 fade by `step`, clamped. Never runs backwards. */
export function advanceFade(current: number, step: number): number {
  return Math.min(1, Math.max(0, current) + Math.max(0, step));
}

/**
 * Opacity multiplier for a phantom draw, 0..1.
 *
 * A COVERED phantom holds at 1 and does not fade at all. It is the backdrop its
 * sprite fades in over, and the two are stacked draws, not summed ones: the
 * composite is `a_sprite + a_phantom * (1 - a_sprite)`. Ramping the phantom down
 * to `1 - presence` while the sprite ramps up to `presence` looks complementary
 * written out, but composites to `p + (1-p)^2` -- a 25% hole at the midpoint
 * that the lit background shows through. That was the reveal "flash", and it hit
 * only STATIONARY sprites because only they are ever coincident enough to count
 * as covering (`phantomSupersededBySprite`).
 *
 * Held constant instead, the composite runs `memoryOpacity -> 1` monotonically
 * for any memory opacity, which is the cross-dissolve this always wanted.
 * Disposal cannot key off this reaching zero any more -- see `phantomIsSpent`.
 *
 * With no sprite over it, a phantom runs its own dissolve as before.
 */
export function phantomAlpha(covered: boolean, dissolve: number): number {
  if (covered) return 1;
  return Math.max(0, 1 - dissolve);
}

/**
 * Whether a phantom has finished its job and can be disposed.
 *
 * A covered phantom never fades (see `phantomAlpha`), so "alpha reached zero" no
 * longer answers this. It is spent once the sprite standing over it is fully
 * opaque, at which point removing the backdrop underneath cannot be seen.
 * Uncovered, it is spent when its own dissolve completes.
 */
export function phantomIsSpent(
  covered: boolean,
  ownerPresence: number,
  dissolve: number,
): boolean {
  return covered ? ownerPresence >= 1 : dissolve >= 1;
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

    // A spawned phantom: has vision returned to ITS OWN (frozen) position,
    // independent of wherever the real sprite it stood in for currently is?
    //
    // Reported once the look is a solid one (`PHANTOM_REVEAL_VISIBILITY`, see
    // there for why any-non-zero was a hair trigger), and it STARTS the
    // dissolve rather than ending the phantom. Disposal is by the dissolve
    // completing on a timer (methods.ts), because tying it to full visibility
    // meant a phantom only glimpsed from a distance would dissolve part-way and
    // then fade back in as the source retreated -- or stall for good at
    // whatever fraction the source stopped at.
    if (status === 'phantom') {
      if (
        computeSpriteVisibility(
          transforms[i].worldPosition,
          sources,
          mask,
          cellDims,
          windowOriginLocalCell,
          cellSize,
        ) >= PHANTOM_REVEAL_VISIBILITY
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
    const vis = computeSpriteVisibility(
      transform.worldPosition,
      sources,
      mask,
      cellDims,
      windowOriginLocalCell,
      cellSize,
    );

    // `'visible'` means "has been seen at all, and so deserves a memory when
    // it leaves". It latches at ANY non-zero visibility, not at full.
    //
    // It used to require `vis >= 1`, to let the renderer tell a fade-in from a
    // fade-out. But visibility is `radial * (hits/8)` and `radial` is strictly
    // below 1 anywhere in the fade band, so a sprite that never reached the
    // inner radius could never qualify -- it would fade in, fade back out, and
    // leave nothing behind. Colour is now a pure function of distance and
    // opacity carries the direction, so no threshold has to encode it.
    if (vis > 0) {
      if (status === 'obscured' || status === 'unseen') {
        sprite._fowStatus = 'visible';
      } else if (status === 'obscuring') {
        // Vision returned before its phantom landed; it is simply on its way
        // out again rather than starting over.
        sprite._fowStatus = 'visible';
      }
      continue;
    }

    // Fully out of sight. Phantom-spawning is still gated strictly on the
    // `'visible'` -> not-visible edge -- an `'unseen'` sprite, meaning one
    // never seen AT ALL, stays `'unseen'` here, exactly like terrain's "never
    // explored" stays hidden. Spawning a phantom for a never-seen sprite was
    // the actual bug: every off-screen sprite (trackedByFog defaults true)
    // would otherwise get a permanent phantom the instant fog-of-war first
    // evaluated it, regardless of whether it had ever really been observed --
    // see the Colony Forever perf report this fixed. That invariant is intact;
    // only the bar for "seen" moved from fully-revealed to seen-at-all.
    //
    // `'obscuring'`, not `'obscured'`: the sprite keeps drawing (holding the
    // memory look its dissolve already renders at zero visibility) until
    // `spawnPhantom` has actually attached the stand-in, then that flips it.
    // Going straight to `'obscured'` here is what left a gap, since the spawn
    // is async and lands a frame or more later.
    if (status === 'visible') {
      sprite._fowStatus = 'obscuring';
      newlyObscured.push({ sprite, transform });
    }
  }
}
