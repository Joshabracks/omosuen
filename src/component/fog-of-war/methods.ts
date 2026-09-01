import {
  ComponentData,
  ComponentMethods,
  castTo,
  newComponent,
} from '../types';
import { FogOfWarT, FogOfWarStyle } from './data';
import { Vector2D, Vector3D, Vector4D } from '../../math';
import { getActiveScene } from '../../scene';
import { sceneIndex } from '../scene-index';
import type { NexusT } from '../nexus/data';
import type { SpriteT, SpriteOptions } from '../sprite/data';
import type { TransformT, TransformOptions } from '../transform/data';
import type { VisionSourceT } from '../vision-source/data';
import { computeSolidityMap } from '../camera/render/visibility-mask';
import {
  advanceFade,
  fogFadeStep,
  isVisibleFrom,
  isSamePhantomPlace,
  phantomAlpha,
  phantomIsSpent,
  phantomSupersededBySprite,
  sweepFogOfWar,
} from './sweep';
import type {
  FogSweepIndex,
  ObscuredTransition,
  ResolvedSource,
} from './sweep';
import {
  clearDeferredCells,
  revealObservedCells,
  setCellObservationPredicate,
} from '../cell-map/deferred-presentation';
import { markForDisposal } from '../../loop/dispose';

/**
 * Resolves each source's CURRENT world position from its sibling transform --
 * called fresh every frame regardless of whether `sources` itself came from
 * the scene index, since a source's position (unlike the component list)
 * moves every frame even when nothing was added/removed.
 *
 * `count` is the index's valid-entry count; `sources` is grown to a high-water
 * mark and entries past `count` are stale (see scene-index.ts).
 */
function resolveActiveVisionSources(
  sources: VisionSourceT[],
  count: number,
  windowOriginLocalCell: { x: number; y: number; z: number },
  cellSize: { x: number; y: number; z: number },
): ResolvedSource[] {
  const resolved: ResolvedSource[] = [];
  for (let i = 0; i < count; i++) {
    const source = sources[i];
    // The index is a frame old, so an entry can name something disposed since.
    if (source._disposed === true) continue;
    if (!source.enabled) continue;
    if (!source.parent || source.parent.type !== 'nexus') continue;
    const transform = castTo<NexusT>(source.parent).getComponentByType(
      'transform',
      false,
    ) as TransformT | null;
    if (!transform) continue;
    const pos = transform.worldPosition;
    const outer = source.radius + source.fadeWidth;
    resolved.push({
      pos: { x: pos.x, y: pos.y, z: pos.z },
      localCell: {
        x: pos.x / cellSize.x - windowOriginLocalCell.x,
        y: pos.y / cellSize.y - windowOriginLocalCell.y,
        z: pos.z / cellSize.z - windowOriginLocalCell.z,
      },
      outerSq: outer * outer,
      radius: source.radius,
      fadeWidth: source.fadeWidth,
    });
  }
  return resolved;
}

/**
 * One live phantom: a frozen stand-in left where a sprite was last seen.
 *
 * A sprite may own SEVERAL of these at once, and that is load-bearing. A memory
 * stands until vision actually reaches ITS OWN spot -- seeing the unit
 * somewhere else does not retire it -- so a unit that goes dark at A, is seen
 * again at B and goes dark there leaves memories at both. Keying this map by
 * sprite id (one memory per sprite) is what made the second one
 * unrepresentable, and `spawnPhantom` answered that by silently refusing to
 * spawn -- leaving the sprite stuck in `'obscuring'`, which renders as an
 * opaque memory-look sprite at its LIVE position: a ghost that walks. Keyed by
 * phantom nexus id instead, that case is simply a second entry.
 */
interface LivePhantom {
  /** The phantom's own nexus, and the two components hanging off it. */
  nexus: NexusT;
  phantomTransform: TransformT | null;
  phantomSprite: SpriteT | null;
  /**
   * The sprite this stands in for, and its transform. The OWNER's, not the
   * phantom's -- `phantomSupersededBySprite` asks where the real sprite is now.
   */
  ownerSprite: SpriteT;
  ownerTransform: TransformT;
  /** Where the phantom was frozen -- `phantomSupersededBySprite`'s reference. */
  spawnPos: { x: number; y: number; z: number };
  /** Monotonic spawn order, so the oldest memory can be found (see the cap). */
  seq: number;
  /**
   * Dissolve progress, 0..1, for a phantom with NO sprite standing over it --
   * the spot has been abandoned and the memory is being confirmed empty.
   * Latches once vision reaches it and then runs to completion on a timer,
   * because a distance-driven dissolve stalls or reverses whenever the source
   * stops closing. A covered phantom ignores this and derives its opacity from
   * its owner's presence instead (see `phantomAlpha`).
   */
  dissolve: number;
}

/** Every live phantom, keyed by its OWN nexus id. */
const livePhantoms = new Map<number, LivePhantom>();

/** Phantom nexus id -> the sprite id it stands in for. */
const phantomOwner = new Map<number, number>();

/**
 * Sprite ids with a `spawnPhantom` currently in flight.
 *
 * `spawnPhantom` awaits three `newComponent` calls, so "this sprite is already
 * being handled" needs its own marker -- it used to be encoded as a `null`
 * nexus in `livePhantoms`, which conflated "in flight" with "has a memory" and
 * is what forced the one-memory-per-sprite keying above. Claimed before the
 * first await and released in a `finally`.
 */
const pendingPhantoms = new Set<number>();

/**
 * Upper bound on live memories per sprite; beyond it the OLDEST starts
 * dissolving.
 *
 * A deliberate deviation from "a memory stands until you look at it": a unit
 * patrolling the vision boundary crosses it over and over, and without a cap
 * would accumulate memories without bound. `Infinity` restores strict
 * honest-memory. Note `isSamePhantomPlace` already collapses repeat crossings
 * in ONE spot into a single refreshed memory, so reaching this cap means the
 * sprite really was lost in four distinct places.
 */
const MAX_PHANTOMS_PER_SPRITE = 4;

/** Spawn counter backing `LivePhantom.seq`. */
let phantomSeq = 0;

/**
 * Scratch: sprite ids the sweep just moved into `'obscuring'` this frame.
 *
 * Unlike `newlyObscured` (deliberately a fresh array per frame, since the spawn
 * loop awaits and a shared buffer could be cleared out from under it) this one
 * is safe to reuse -- it is filled and read entirely within the synchronous
 * stretch of `update`, before the first await.
 */
const justObscured = new Set<number>();

/**
 * Phantom nexus ids whose own sprite is currently drawing on top of them, and
 * which must therefore render at CONSTANT memory opacity rather than fading.
 *
 * A phantom is the opaque backdrop its sprite fades back in over; fading both
 * of them leaks the background through the middle of the transition. Reaches
 * the renderer through `phantomFogAlpha`, which folds it into the one opacity
 * number that draw call needs. Refreshed once per sweep rather than recomputed
 * per draw call.
 */
const coveredPhantoms = new Set<number>();

/**
 * Fade-in progress per sprite id, 0..1.
 *
 * ABSENT MEANS 1, not 0. The sweep only walks sprites in the scene index that
 * are tracked and not self-lit; everything else -- untracked sprites, self-lit
 * ones, anything the index has not caught up with -- must render normally. A
 * missing entry defaulting to 0 would hide arbitrary sprites outright, so this
 * fails visible on purpose.
 */
const spritePresence = new Map<number, number>();

/** Fade-in progress for a sprite, 1 when untracked. See `spritePresence`. */
export function spriteFogPresence(spriteId: number | undefined): number {
  if (spriteId === undefined) return 1;
  return spritePresence.get(spriteId) ?? 1;
}

/**
 * Opacity multiplier for a phantom draw, 0..1.
 *
 * A phantom with its own sprite drawing over it holds SOLID at 1 -- it is the
 * backdrop that sprite fades in over, and fading both leaks the background
 * through the middle. See `phantomAlpha`. With no sprite over it, it runs its
 * own dissolve.
 */
export function phantomFogAlpha(phantomNexusId: number): number {
  const entry = livePhantoms.get(phantomNexusId);
  if (!entry) return 1;
  return phantomAlpha(coveredPhantoms.has(phantomNexusId), entry.dissolve);
}

/**
 * Whether this phantom has its own sprite drawing over it this frame -- see
 * `coveredPhantoms`. False for anything fog-of-war isn't tracking, so an
 * unknown phantom simply fades as normal.
 *
 * Read by render-sprites.ts, which feeds a covered phantom `u_spriteVisibility
 * = 0` so the shader's `u_spriteFogMemory && fogVis >= 1.0` discard cannot fire
 * on it. A covered phantom must stay drawn until its sprite has fully faded in;
 * without this it is discarded outright the moment its spot reaches full
 * vision, which on a fast approach is well before the sprite is opaque.
 */
export function isPhantomCoveredBySprite(phantomNexusId: number): boolean {
  return coveredPhantoms.has(phantomNexusId);
}

/**
 * Advances the fade timers. Run after the sweep, so it reads the `_fowStatus`
 * and `coveredPhantoms` state this frame just produced.
 *
 * `deltaTime` is milliseconds (the loop's own unit). A paused fog-of-war nexus
 * is skipped by the update traversal entirely, so timers freeze with the rest
 * of the simulation rather than running on underneath it.
 */
function advanceFogTimers(index: FogSweepIndex, deltaTimeMs: number): void {
  const step = fogFadeStep(deltaTimeMs);

  for (let i = 0; i < index.count; i++) {
    const sprite = index.sprites[i];
    const spriteId = sprite.id;
    if (spriteId === undefined || sprite._disposed === true) continue;
    const status = sprite._fowStatus;
    if (status === 'phantom') continue;

    if (status === 'obscured' || status === 'unseen') {
      // Not drawn at all (both are `fogDrawKind` skips), so its next arrival
      // should fade in from nothing. Without `'unseen'` here a never-seen
      // sprite's presence ramps to 1 while it is hidden, and it pops in at full
      // opacity the instant vision first reaches it instead of fading.
      spritePresence.delete(spriteId);
      continue;
    }
    if (sprite.trackedByFog !== true) continue;
    const current = spritePresence.get(spriteId) ?? 0;
    spritePresence.set(spriteId, advanceFade(current, step));
  }

  // A phantom nobody is standing over dissolves on its own clock, but only
  // once vision has actually reached the spot -- and never runs backwards
  // afterwards, which is the reversal this replaced.
  for (const [phantomId, entry] of livePhantoms) {
    if (entry.nexus._disposed === true) continue;
    if (coveredPhantoms.has(phantomId)) continue;
    if (entry.dissolve <= 0 && !dissolvingPhantoms.has(phantomId)) continue;
    entry.dissolve = advanceFade(entry.dissolve, step);
  }
}

/** Phantom nexus ids whose dissolve has been triggered by vision reaching them. */
const dissolvingPhantoms = new Set<number>();

/**
 * Disposes every phantom whose fade has reached zero -- either its own
 * dissolve completed, or the sprite standing over it finished fading in and
 * has fully replaced it. Both are guaranteed to arrive, which is the point of
 * putting them on a clock.
 */
function disposeFadedPhantoms(): void {
  if (livePhantoms.size === 0) return;
  let faded: number[] | null = null;
  for (const [phantomId, entry] of livePhantoms) {
    // Torn down by something other than us (scene teardown, an external
    // markForDisposal). Reap the bookkeeping here rather than leaving the entry
    // to sit in the map forever -- it is no longer `spawnPhantom`'s job to
    // notice, now that a live phantom never blocks a spawn.
    if (entry.nexus._disposed === true) {
      (faded ??= []).push(phantomId);
      continue;
    }
    // Not "alpha reached zero" -- a COVERED phantom now holds solid at 1 and
    // would never qualify. It is spent when the sprite over it is fully opaque.
    const ownerId = phantomOwner.get(phantomId);
    if (
      phantomIsSpent(
        coveredPhantoms.has(phantomId),
        ownerId === undefined ? 1 : spriteFogPresence(ownerId),
        entry.dissolve,
      )
    ) {
      (faded ??= []).push(phantomId);
    }
  }
  if (!faded) return;
  for (const phantomId of faded) {
    const entry = livePhantoms.get(phantomId);
    dissolvingPhantoms.delete(phantomId);
    forgetPhantom(phantomId);
    if (entry && entry.nexus._disposed !== true) markForDisposal(entry.nexus);
  }
}

/**
 * Recomputes `coveredPhantoms`. Run after the sweep, so it sees the
 * `_fowStatus` the sweep just wrote.
 */
function refreshCoveredPhantoms(): void {
  coveredPhantoms.clear();
  if (livePhantoms.size === 0) return;
  for (const [phantomId, entry] of livePhantoms) {
    if (entry.nexus._disposed === true) continue;
    if (
      phantomSupersededBySprite(
        entry.ownerSprite,
        entry.ownerTransform,
        entry.spawnPos,
      )
    ) {
      coveredPhantoms.add(phantomId);
    }
  }
}

/** Drops one phantom's registry entries. */
function forgetPhantom(phantomId: number): void {
  phantomOwner.delete(phantomId);
  livePhantoms.delete(phantomId);
}

/**
 * Every live phantom currently standing in for `spriteId`, oldest first.
 *
 * Walks `livePhantoms` rather than keeping a third index: a sprite holds at
 * most `MAX_PHANTOMS_PER_SPRITE` memories and this runs only on the
 * `visible -> obscured` edge, not per frame.
 */
function phantomsForSprite(spriteId: number): LivePhantom[] {
  const found: LivePhantom[] = [];
  for (const [phantomId, entry] of livePhantoms) {
    if (entry.nexus._disposed === true) continue;
    if (phantomOwner.get(phantomId) === spriteId) found.push(entry);
  }
  found.sort((a, b) => a.seq - b.seq);
  return found;
}

/**
 * Re-freezes a phantom onto its sprite's state RIGHT NOW, and restarts its
 * memory clock.
 *
 * Shared by the tail of a fresh spawn (where everything above it was async, so
 * the sprite has kept moving and animating since the freeze point was taken)
 * and by the same-place refresh (where an existing memory is being reused for a
 * new crossing instead of stacking a second one on top of it).
 */
function freezePhantomTo(
  entry: LivePhantom,
  sprite: SpriteT,
  transform: TransformT,
): void {
  const now = transform.worldPosition;
  const nowScale = transform.worldScale;
  if (entry.phantomTransform) {
    entry.phantomTransform.position = new Vector3D(now.x, now.y, now.z);
    entry.phantomTransform.rotation = new Vector3D(
      0,
      transform.worldRotation.y,
      0,
    );
    entry.phantomTransform.scale = new Vector3D(
      nowScale.x,
      nowScale.y,
      nowScale.z,
    );
  }
  // Animation only ever writes `frame` (see animation-controller), so this is
  // all that can have gone stale visually.
  if (entry.phantomSprite) entry.phantomSprite.frame = { ...sprite.frame };
  entry.spawnPos = { x: now.x, y: now.y, z: now.z };
  entry.dissolve = 0;
  if (entry.nexus.id !== undefined) dissolvingPhantoms.delete(entry.nexus.id);
}

/**
 * Spawns a "phantom" nexus at the scene root: a plain clone of `sprite`'s
 * current visual state plus a transform frozen at its current world
 * position/scale/yaw, marked `_fowStatus = 'phantom'`. This is the ONLY
 * thing that stands in for `sprite` while it's obscured -- `sprite` itself
 * (its nexus, its own update/gameplay logic) is never touched. `_generated`
 * excludes the phantom nexus from scene serialization (see
 * `serializeComponentRecursive`, src/scene/loader.ts).
 *
 * A sprite may hold SEVERAL phantoms at once -- one per place it was last seen
 * before being lost -- since a memory stands until vision reaches its own spot.
 * Two guards keep that from running away: a spawn already in flight for this
 * sprite is a no-op (`pendingPhantoms`), and a freeze point landing on top of an
 * existing memory refreshes that one instead of stacking a second
 * (`isSamePhantomPlace`).
 */
async function spawnPhantom(
  scene: NexusT,
  sprite: SpriteT,
  transform: TransformT,
): Promise<void> {
  const spriteId = sprite.id;
  if (spriteId === undefined) return;
  // The same obscure edge being processed twice -- the in-flight spawn will
  // flip this sprite to 'obscured' when it lands.
  if (pendingPhantoms.has(spriteId)) return;

  const frozenPos = {
    x: transform.worldPosition.x,
    y: transform.worldPosition.y,
    z: transform.worldPosition.z,
  };

  // Lost in a place we already remember losing it: reuse that memory rather
  // than piling a second one on the same spot. Synchronous, so the sprite is
  // handed over on this frame with no `'obscuring'` interval at all.
  const existing = phantomsForSprite(spriteId);
  for (const entry of existing) {
    if (!isSamePhantomPlace(entry.spawnPos, frozenPos)) continue;
    freezePhantomTo(entry, sprite, transform);
    if (sprite._fowStatus === 'obscuring') sprite._fowStatus = 'obscured';
    return;
  }
  // Cap reached: the oldest memory starts dissolving to make room. See
  // MAX_PHANTOMS_PER_SPRITE for why this bound exists at all.
  for (let i = 0; i <= existing.length - MAX_PHANTOMS_PER_SPRITE; i++) {
    const id = existing[i].nexus.id;
    if (id !== undefined) dissolvingPhantoms.add(id);
  }

  // Claim the sprite BEFORE the first await: two obscure edges on consecutive
  // frames would otherwise both get this far while the first spawn is still
  // resolving.
  pendingPhantoms.add(spriteId);
  try {
    await spawnPhantomNexus(scene, sprite, transform, spriteId, frozenPos);
  } finally {
    pendingPhantoms.delete(spriteId);
  }
}

/**
 * The allocating half of `spawnPhantom`, split out so the `pendingPhantoms`
 * claim above can be released in a `finally` no matter how this exits.
 */
async function spawnPhantomNexus(
  scene: NexusT,
  sprite: SpriteT,
  transform: TransformT,
  spriteId: number,
  frozenPos: { x: number; y: number; z: number },
): Promise<void> {
  const phantomNexus = (await newComponent(
    'nexus',
    { name: `${sprite.name}-fow-phantom` },
    scene,
  )) as NexusT | null;
  // Nothing to flip the sprite out of `'obscuring'` with -- the repair pass in
  // `update` will re-report it next frame rather than leaving it drawing the
  // memory look at its live position forever.
  if (!phantomNexus || phantomNexus.id === undefined) return;
  phantomNexus._generated = true;

  const p = transform.worldPosition;
  const s = transform.worldScale;
  const transformOptions: TransformOptions = {
    name: `${sprite.name}-fow-phantom-transform`,
    position: new Vector3D(p.x, p.y, p.z),
    rotation: new Vector3D(0, transform.worldRotation.y, 0),
    scale: new Vector3D(s.x, s.y, s.z),
  };
  const phantomTransform = (await newComponent(
    'transform',
    transformOptions,
    phantomNexus,
  )) as TransformT | null;

  const spriteOptions: SpriteOptions = {
    name: `${sprite.name}-fow-phantom-sprite`,
    textureMapKeys: { ...sprite.textureMapKeys },
    frame: { ...sprite.frame },
    anchor: new Vector2D(sprite.anchor.x, sprite.anchor.y),
    tint: new Vector4D(
      sprite.tint.x,
      sprite.tint.y,
      sprite.tint.z,
      sprite.tint.w,
    ),
    opacity: sprite.opacity,
    showSilhouette: sprite.showSilhouette,
    silhouetteColor: new Vector4D(
      sprite.silhouetteColor.x,
      sprite.silhouetteColor.y,
      sprite.silhouetteColor.z,
      sprite.silhouetteColor.w,
    ),
    renderOrder: sprite.renderOrder,
    emissionIntensity: sprite.emissionIntensity,
    emissionColor: new Vector3D(
      sprite.emissionColor.x,
      sprite.emissionColor.y,
      sprite.emissionColor.z,
    ),
    trackedByFog: false,
    _fowStatus: 'phantom',
  };
  const phantomSprite = (await newComponent(
    'sprite',
    spriteOptions,
    phantomNexus,
  )) as SpriteT | null;

  // THE HANDOVER. Everything above is async, so the source sprite has kept
  // running for a frame or more since it went out of sight -- it may have
  // moved, and it may have animated. Re-sync from its state RIGHT NOW, then
  // hand over, both before returning to the caller.
  //
  // The source sprite has been holding its own memory look this whole time
  // ('obscuring', see SpriteT._fowStatus), so it is still drawing and the two
  // are momentarily identical. Flipping it to 'obscured' here means the
  // phantom appears and the sprite stops on the SAME frame. Setting
  // 'obscured' back in the sweep instead is what left a gap: the sprite
  // vanished immediately and the phantom arrived a frame or more later.
  const entry: LivePhantom = {
    nexus: phantomNexus,
    phantomTransform,
    phantomSprite,
    ownerSprite: sprite,
    ownerTransform: transform,
    spawnPos: frozenPos,
    seq: phantomSeq++,
    dissolve: 0,
  };
  livePhantoms.set(phantomNexus.id, entry);
  phantomOwner.set(phantomNexus.id, spriteId);

  if (sprite._disposed !== true) freezePhantomTo(entry, sprite, transform);
  // Only ever flip a sprite that is still waiting on this spawn -- if vision
  // returned mid-spawn the sweep will have put it back to 'visible', and
  // hiding it here would blink out a unit the player can see.
  if (sprite._fowStatus === 'obscuring') sprite._fowStatus = 'obscured';
}

/**
 * Window origin as of the last sweep, so a shift can be detected and the
 * deferred-presentation overlay dropped (see the check in `update`).
 */
let lastWindowOrigin: { cx: number; cy: number; cz: number } | null = null;

/**
 * Everything the observation predicate needs, snapshotted at the end of each
 * fog update. Terrain writes happen at arbitrary points in the frame (gameplay
 * code, not the render pass), so the predicate cannot recompute vision sources
 * on demand -- it answers from the most recent sweep, which is at most one
 * frame stale. That matches the staleness `_fowStatus` already carries.
 *
 * The solidity mask is deliberately NOT cached here: it is a live view over
 * WASM linear memory that a growth can detach, so the predicate re-fetches it
 * (a cached flag read WASM-side on almost every call) at the moment of use.
 */
let observationContext: {
  sources: ResolvedSource[];
  cellDims: { x: number; y: number; z: number };
  cellSize: { x: number; y: number; z: number };
  windowOriginLocalCell: { x: number; y: number; z: number };
  /** `FogOfWarT.visionMode`, snapshotted with the rest. */
  useLineOfSight: boolean;
} | null = null;

/**
 * "Can the player see this world cell right now?" -- installed into cell-map's
 * deferred-presentation module so a terrain write can decide whether to show
 * itself. Uses `isVisibleFrom`, the same predicate behind the sprite sweep and
 * explored marking, so what counts as seen for terrain, for sprites and for the
 * shader all agree. It used to be a single un-jittered ray -- a genuinely
 * different test, since none of the eight scatter offsets is zero.
 *
 * Fails OPEN (returns true, meaning "visible, don't defer") whenever it cannot
 * answer: no sweep has run yet, or vision is momentarily off. Deferring on a
 * bad answer would hide terrain changes indefinitely; showing them is the safe
 * direction.
 */
function isWorldCellObserved(
  worldX: number,
  worldY: number,
  worldZ: number,
): boolean {
  const ctx = observationContext;
  if (!ctx || ctx.sources.length === 0) return true;

  const { cellSize } = ctx;
  return isVisibleFrom(
    {
      x: (worldX + 0.5) * cellSize.x,
      y: (worldY + 0.5) * cellSize.y,
      z: (worldZ + 0.5) * cellSize.z,
    },
    ctx.sources,
    computeSolidityMap(),
    ctx.cellDims,
    ctx.windowOriginLocalCell,
    cellSize,
    ctx.useLineOfSight,
  );
}

/**
 * Methods interface for fog-of-war component.
 * Provides type-safe method signatures for the $ Proxy.
 */
export interface FogOfWarMethods extends ComponentMethods {
  type: 'fog-of-war';
  getMemoryStyle: (fow: FogOfWarT) => FogOfWarStyle;
  setMemoryStyle: (fow: FogOfWarT, style: FogOfWarStyle) => void;
  getNeverViewedStyle: (fow: FogOfWarT) => FogOfWarStyle;
  setNeverViewedStyle: (fow: FogOfWarT, style: FogOfWarStyle) => void;
  getLightInfluence: (fow: FogOfWarT) => number;
  setLightInfluence: (fow: FogOfWarT, lightInfluence: number) => void;
  getNearBufferCells: (fow: FogOfWarT) => number;
  setNearBufferCells: (fow: FogOfWarT, nearBufferCells: number) => void;
  update: (component: ComponentData, deltaTime: number) => void;
  dispose: (component: ComponentData) => void;
}

/**
 * Static methods object for fog-of-war component.
 * Provides accessors for scene-wide fog-of-war styling.
 *
 * @example
 * ```typescript
 * const fogOfWar = await newComponent("fog-of-war", { name: "Fog Of War" });
 *
 * FogOfWar.setLightInfluence(fogOfWar, 0.5);
 * const influence = FogOfWar.getLightInfluence(fogOfWar);
 *
 * // Or use via $ Proxy
 * $.setLightInfluence(fogOfWar, 0.5);
 * ```
 */
export const FogOfWar: FogOfWarMethods = {
  type: 'fog-of-war',

  /**
   * Gets the style applied to cells that have been seen before but are
   * not currently visible.
   */
  getMemoryStyle: (fow: FogOfWarT): FogOfWarStyle => {
    return fow.memoryStyle;
  },

  /**
   * Sets the style applied to cells that have been seen before but are
   * not currently visible.
   */
  setMemoryStyle: (fow: FogOfWarT, style: FogOfWarStyle): void => {
    fow.memoryStyle = style;
  },

  /**
   * Gets the style applied to cells that have never been visible.
   */
  getNeverViewedStyle: (fow: FogOfWarT): FogOfWarStyle => {
    return fow.neverViewedStyle;
  },

  /**
   * Sets the style applied to cells that have never been visible.
   */
  setNeverViewedStyle: (fow: FogOfWarT, style: FogOfWarStyle): void => {
    fow.neverViewedStyle = style;
  },

  /**
   * Gets how much active light sources influence memory/never-viewed cells.
   */
  getLightInfluence: (fow: FogOfWarT): number => {
    return fow.lightInfluence;
  },

  /**
   * Sets how much active light sources influence memory/never-viewed cells.
   */
  setLightInfluence: (fow: FogOfWarT, lightInfluence: number): void => {
    fow.lightInfluence = lightInfluence;
  },

  /**
   * Gets `nearBufferCells`.
   *
   * @deprecated No longer has any effect. It tuned the near/far terrain-memory
   * LOD, which tiered how much detail a flat per-material colour snapshot
   * carried. Remembered terrain is now the real geometry, deferred rather
   * than repainted (see cell-map/deferred-presentation.ts), so there are no
   * tiers left to tune. Retained so existing scenes and saves still load.
   */
  getNearBufferCells: (fow: FogOfWarT): number => {
    return fow.nearBufferCells;
  },

  /**
   * Sets `nearBufferCells`.
   *
   * @deprecated No longer has any effect. It tuned the near/far terrain-memory
   * LOD, which tiered how much detail a flat per-material colour snapshot
   * carried. Remembered terrain is now the real geometry, deferred rather
   * than repainted (see cell-map/deferred-presentation.ts), so there are no
   * tiers left to tune. Retained so existing scenes and saves still load.
   */
  setNearBufferCells: (fow: FogOfWarT, nearBufferCells: number): void => {
    fow.nearBufferCells = nearBufferCells;
  },

  /**
   * The actual fog-of-war driver, once per frame: resolves every active
   * vision source, then walks every `trackedByFog` sprite in the scene and
   * transitions its `_fowStatus` between 'visible'/'obscured', spawning a
   * phantom stand-in on the visible->obscured edge and disposing a phantom
   * once vision returns to its own (frozen) position. See `SpriteT`'s
   * `_fowStatus`/`trackedByFog` doc comments and `spawnPhantom` above for
   * the full design -- notably, this never touches the real tracked
   * sprite's own nexus/pause state, only its `_fowStatus` field, so its
   * own update/gameplay logic is completely unaffected by fog-of-war.
   *
   * Async (fire-and-forget from `traverseAndUpdate`'s point of view, which
   * never awaits `update()`): `newComponent` is itself async, so a phantom
   * spawned this frame finishes attaching over the next microtask/frame,
   * not synchronously within this call -- an imperceptible one-frame delay,
   * consistent with this engine's existing frame-budgeted init elsewhere.
   */
  update: (component: ComponentData, deltaTime: number): void => {
    // One switch drives the sweep, the observation predicate and the shader
    // alike (see FogOfWarT.visionMode). Reading it per frame rather than
    // caching it keeps a mid-session change live.
    const useLineOfSight = (component as FogOfWarT).visionMode !== 'distance';
    // Installed here rather than at module load so a scene with no
    // fog-of-war component never defers terrain writes. Idempotent, and
    // cleared in `dispose` below.
    setCellObservationPredicate(isWorldCellObserved);

    void (async () => {
      const scene = getActiveScene();
      if (!scene) return;

      // Everything this sweep needs about "which components exist" comes from
      // the shared scene index, published by the on-screen pass's walk of the
      // tree (scene-index.ts). That walk runs at loop phase 3.6 and this runs
      // at phase 2, so the index in hand was built LAST frame -- the same
      // staleness `transform.worldPosition` already has here, since world
      // transforms are refreshed at phase 3.5. Entries are guarded on
      // `_disposed` where it matters rather than filtered up front.
      //
      // This replaced three recursive `getComponentsByType` walks plus two
      // `getComponentByType` lookups per sprite per frame, all of which
      // re-derived what that one walk had already established. The gather
      // cache they sat behind was also self-defeating: spawning or disposing
      // a phantom bumps the `sprite` renderable version, so every frame with
      // a visibility transition forced a full scene re-walk on the next one.
      const index = sceneIndex;

      // Same "assume the first cell-map" simplification already used by
      // render-cell-maps.ts/render-sprites.ts throughout the fog-of-war
      // feature -- a scene with multiple cell-maps tests sprite visibility
      // against only the first one's solidity/window data.
      const originCellMap = index.cellMapCount > 0 ? index.cellMaps[0] : null;
      const windowOrigin = originCellMap?.window.origin;
      if (!originCellMap || !windowOrigin) return;

      const cellDims = originCellMap.mapSize;
      const cellSize = originCellMap.cellSize;
      const windowOriginLocalCell = {
        x: windowOrigin.cx * originCellMap.chunkSize.x,
        y: windowOrigin.cy * originCellMap.chunkSize.y,
        z: windowOrigin.cz * originCellMap.chunkSize.z,
      };

      const sources = resolveActiveVisionSources(
        index.visionSources,
        index.visionSourceCount,
        windowOriginLocalCell,
        cellSize,
      );
      // No enabled vision source means fog is inactive for this frame --
      // render-cell-maps.ts gates its own solidity work on the same condition
      // (`fogActive`/`needSolidity`). Bail BEFORE computeSolidityMap() rather
      // than after, and leave every `_fowStatus` untouched: running the sweep
      // with zero sources would mark every visible sprite obscured at once and
      // spawn a phantom for each, which is not what "vision is momentarily
      // off" should mean.
      if (sources.length === 0) return;

      // A window shift leaves every retained cell in its toroidal slot but
      // evicts the rest, and an evicted cell's slot is later reused by a
      // different world cell -- a surviving overlay entry would then paint
      // remembered terrain onto that unrelated cell. Dropping the whole
      // overlay on a shift is the documented limitation: revisiting a
      // long-abandoned area shows its current state rather than your memory
      // of it.
      if (
        lastWindowOrigin === null ||
        lastWindowOrigin.cx !== windowOrigin.cx ||
        lastWindowOrigin.cy !== windowOrigin.cy ||
        lastWindowOrigin.cz !== windowOrigin.cz
      ) {
        lastWindowOrigin = {
          cx: windowOrigin.cx,
          cy: windowOrigin.cy,
          cz: windowOrigin.cz,
        };
        clearDeferredCells(originCellMap);
      }

      // Publish what the observation predicate answers from, before anything
      // can write terrain this frame.
      observationContext = {
        sources,
        cellDims,
        cellSize,
        windowOriginLocalCell,
        useLineOfSight,
      };

      // Held only for the synchronous loop below -- see the phantom-spawn note
      // after it.
      const mask = computeSolidityMap();

      // `'visible' -> obscured` transitions found this pass. Collected rather
      // than acted on inline because spawning a phantom is async, and `mask` is
      // a view straight over WASM linear memory that the next solidity_run()
      // rewrites and a WASM memory growth can DETACH (see visibility-mask.ts:
      // "consume it before the next call"). Awaiting mid-loop would resume with
      // a possibly-detached view, where every `mask[i]` reads `undefined`,
      // `undefined > 127` is false, so every cell looks non-solid and every
      // remaining sprite reads as visible -- occlusion silently failing open.
      //
      // Deliberately a fresh array per frame, not a reused module-level one:
      // the spawn loop below awaits, so a shared buffer could be cleared by
      // the NEXT frame's sweep while this one is still draining it.
      const newlyObscured: ObscuredTransition[] = [];
      const revealedPhantoms: NexusT[] = [];

      sweepFogOfWar(
        index,
        sources,
        mask,
        cellDims,
        windowOriginLocalCell,
        cellSize,
        newlyObscured,
        revealedPhantoms,
        useLineOfSight,
      );

      // REPAIR. An `'obscuring'` sprite is one waiting on a spawn to flip it to
      // `'obscured'`; with no spawn in flight, nothing ever will. Until this
      // pass existed that was terminal, and a terminal `'obscuring'` draws the
      // memory look at the sprite's LIVE position at full opacity -- a ghost
      // that walks around, indistinguishable from a correct memory except that
      // it moves. Re-report it so the spawn is simply retried next frame.
      //
      // The refusal that used to cause this is gone (a live phantom no longer
      // blocks a second one), so this is a net for the remaining ways a spawn
      // can be lost: `newComponent` returning null, an id-less sprite, a scene
      // swapped out mid-spawn.
      //
      // Sprites the sweep itself just moved into `'obscuring'` are already in
      // `newlyObscured` and must not be queued twice.
      justObscured.clear();
      for (let i = 0; i < newlyObscured.length; i++) {
        const id = newlyObscured[i].sprite.id;
        if (id !== undefined) justObscured.add(id);
      }
      for (let i = 0; i < index.count; i++) {
        const s = index.sprites[i];
        if (s._disposed === true || s._fowStatus !== 'obscuring') continue;
        const id = s.id;
        if (id === undefined) continue;
        if (pendingPhantoms.has(id) || justObscured.has(id)) continue;
        // Opted out of fog, or gained a vision-source, while it was waiting on
        // its spawn. The sweep guards on both before it ever obscures anything;
        // finishing the handover now would hide a sprite fog no longer governs
        // (untracked), or leave a phantom drawing alongside one that renders
        // live regardless of status (self-lit). Fail visible instead, the same
        // direction `spritePresence` and `isWorldCellObserved` fail.
        if (s.trackedByFog !== true || index.selfLit[i]) {
          s._fowStatus = 'visible';
          continue;
        }
        newlyObscured.push({ sprite: s, transform: index.transforms[i] });
      }

      // Safe to act on while `mask` is still live: `markForDisposal` only sets
      // a flag and queues an id, it never awaits.
      // Vision has reached these phantoms. That STARTS their dissolve; it
      // does not end them. Disposal is by the fade reaching zero below, so a
      // phantom only half-seen still finishes disappearing instead of fading
      // back in when the source turns away.
      for (let i = 0; i < revealedPhantoms.length; i++) {
        const id = revealedPhantoms[i].id;
        if (id !== undefined) dissolvingPhantoms.add(id);
      }
      // Reads `_fowStatus` as the sweep just left it, so a sprite that started
      // fading back in this pass has its phantom pinned opaque for the draw
      // that follows -- which is what its fade-in is composited over.
      refreshCoveredPhantoms();
      advanceFogTimers(index, deltaTime);
      disposeFadedPhantoms();

      // Past this point `mask` is DEAD -- `revealObservedCells` writes to WASM
      // (clearing overlay entries), and a memory growth there can detach the
      // view. Nothing below may read it. Same discipline as the phantom spawns
      // further down, and the same silent fail-open if it is broken: a
      // detached view reads `undefined`, `undefined > 127` is false, so every
      // cell looks non-solid and everything reads as visible.
      //
      // Terrain hidden while unobserved that the player can now see: drop the
      // overlay entry and dirty the chunk so the normal remesh path catches up.
      revealObservedCells(originCellMap);

      // Past this point `mask` is dead -- nothing below may read it. Spawning
      // after the loop also keeps the whole sweep in one synchronous run
      // instead of suspending it once per transition.
      for (const { sprite, transform } of newlyObscured) {
        await spawnPhantom(scene, sprite, transform);
      }
    })();
  },

  /**
   * Disposes the fog-of-war component.
   * Marks the component as disposed.
   *
   * @param component - The component to dispose
   */
  dispose: (component: ComponentData): void => {
    const fow = component as FogOfWarT;
    fow._disposed = true;
    // Stop deferring terrain writes, and reveal anything currently hidden --
    // with fog gone there is nothing to hide it from, and leaving the overlay
    // in place would freeze that terrain's appearance permanently.
    setCellObservationPredicate(null);
    clearDeferredCells();
    observationContext = null;
    lastWindowOrigin = null;
    // Phantoms themselves are ordinary scene nexuses and are torn down with
    // the scene; only this bookkeeping is ours to clear. ALL of it -- these are
    // module-level maps that otherwise outlive the scene, and a stale
    // `spritePresence` entry in particular would hand a later sprite that
    // reuses the id a presence of 1 and skip its fade-in.
    livePhantoms.clear();
    phantomOwner.clear();
    pendingPhantoms.clear();
    coveredPhantoms.clear();
    dissolvingPhantoms.clear();
    spritePresence.clear();
    justObscured.clear();
  },
};
