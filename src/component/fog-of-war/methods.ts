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
  isPositionVisible,
  phantomSupersededBySprite,
  sweepFogOfWar,
} from './sweep';
import type { ObscuredTransition, ResolvedSource } from './sweep';
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
 * The live phantom standing in for each obscured sprite, keyed by that
 * sprite's id.
 *
 * Needed because a phantom and its `'visible'` sprite now COEXIST for the
 * duration of the shader's cross-fade (the phantom is disposed only at full
 * visibility, see `sweepFogOfWar`). A sprite hovering around the edge of
 * vision therefore re-crosses the `visible -> obscured` edge while its
 * previous phantom is still alive, and without this guard each crossing would
 * strand another one at the same spot.
 *
 * It also closes a race that was previously only accidentally impossible:
 * `spawnPhantom` is async and `markForDisposal` defers to the end-of-frame
 * dispose queue, so "spawned" and "disposed" were never actually atomic with
 * respect to each other.
 */
interface LivePhantom {
  /** `null` while the spawn is still in flight (see `spawnPhantom`). */
  nexus: NexusT | null;
  /** The sprite this stands in for, and its transform, for the check below. */
  sprite: SpriteT;
  transform: TransformT;
  /** Where the phantom was frozen -- `phantomSupersededBySprite`'s reference. */
  spawnPos: { x: number; y: number; z: number };
}

const livePhantoms = new Map<number, LivePhantom>();

/** Reverse of `livePhantoms`: phantom nexus id -> the sprite id it stands in for. */
const phantomOwner = new Map<number, number>();

/**
 * Phantom nexus ids whose own sprite is currently drawing on top of them, and
 * which must therefore render at CONSTANT memory opacity rather than fading.
 *
 * A phantom is the opaque backdrop its sprite fades back in over; fading both
 * of them leaks the background through the middle of the transition. Read by
 * render-sprites.ts via `isPhantomCoveredBySprite`. Refreshed once per sweep
 * rather than recomputed per draw call.
 */
const coveredPhantoms = new Set<number>();

/**
 * Whether this phantom has its own sprite drawing over it this frame -- see
 * `coveredPhantoms`. False for anything fog-of-war isn't tracking, so an
 * unknown phantom simply fades as normal.
 */
export function isPhantomCoveredBySprite(phantomNexusId: number): boolean {
  return coveredPhantoms.has(phantomNexusId);
}

/**
 * Recomputes `coveredPhantoms`. Run after the sweep, so it sees the
 * `_fowStatus` the sweep just wrote.
 */
function refreshCoveredPhantoms(): void {
  coveredPhantoms.clear();
  if (livePhantoms.size === 0) return;
  for (const entry of livePhantoms.values()) {
    const nexus = entry.nexus;
    if (!nexus || nexus.id === undefined || nexus._disposed === true) continue;
    if (
      phantomSupersededBySprite(entry.sprite, entry.transform, entry.spawnPos)
    ) {
      coveredPhantoms.add(nexus.id);
    }
  }
}

/**
 * Drops a phantom's registry entries, freeing its sprite to be given a new one
 * next time it goes out of sight.
 */
function forgetPhantom(phantomNexus: NexusT): void {
  const phantomId = phantomNexus.id;
  if (phantomId === undefined) return;
  const spriteId = phantomOwner.get(phantomId);
  if (spriteId !== undefined) {
    phantomOwner.delete(phantomId);
    livePhantoms.delete(spriteId);
  }
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
 * A no-op if `sprite` already has a live phantom (see `livePhantoms`).
 */
async function spawnPhantom(
  scene: NexusT,
  sprite: SpriteT,
  transform: TransformT,
): Promise<void> {
  const spriteId = sprite.id;
  if (spriteId === undefined) return;

  const existingEntry = livePhantoms.get(spriteId);
  if (existingEntry) {
    const existing = existingEntry.nexus;
    // `null` means a spawn is already in flight for this sprite.
    if (existing === null || existing._disposed !== true) return;
    // The phantom went away by a path other than our own reveal (scene
    // teardown, an external markForDisposal). Self-heal rather than blocking
    // this sprite from ever getting another one.
    forgetPhantom(existing);
  }

  const frozenPos = {
    x: transform.worldPosition.x,
    y: transform.worldPosition.y,
    z: transform.worldPosition.z,
  };
  // Claim the slot BEFORE the first await: two obscure edges on consecutive
  // frames would otherwise both pass the check above while the first spawn is
  // still resolving. `nexus` is filled in once it exists.
  livePhantoms.set(spriteId, {
    nexus: null,
    sprite,
    transform,
    spawnPos: frozenPos,
  });

  const phantomNexus = (await newComponent(
    'nexus',
    { name: `${sprite.name}-fow-phantom` },
    scene,
  )) as NexusT | null;
  if (!phantomNexus) {
    livePhantoms.delete(spriteId);
    return;
  }
  livePhantoms.set(spriteId, {
    nexus: phantomNexus,
    sprite,
    transform,
    spawnPos: frozenPos,
  });
  if (phantomNexus.id !== undefined) {
    phantomOwner.set(phantomNexus.id, spriteId);
  }
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
  if (phantomTransform && sprite._disposed !== true) {
    const now = transform.worldPosition;
    phantomTransform.position = new Vector3D(now.x, now.y, now.z);
    phantomTransform.rotation = new Vector3D(0, transform.worldRotation.y, 0);
    const nowScale = transform.worldScale;
    phantomTransform.scale = new Vector3D(nowScale.x, nowScale.y, nowScale.z);
    // Animation only ever writes `frame` (see animation-controller), so this
    // is all that can have gone stale visually.
    if (phantomSprite) phantomSprite.frame = { ...sprite.frame };

    const entry = livePhantoms.get(spriteId);
    if (entry) entry.spawnPos = { x: now.x, y: now.y, z: now.z };
  }
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
} | null = null;

/**
 * "Can the player see this world cell right now?" -- installed into cell-map's
 * deferred-presentation module so a terrain write can decide whether to show
 * itself. Uses exactly the same test as the sprite sweep, so what counts as
 * seen for terrain, for sprites and for the shader all agree.
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
  return isPositionVisible(
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
  update: (_component: ComponentData, _deltaTime: number): void => {
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
      );

      // Safe to act on while `mask` is still live: `markForDisposal` only sets
      // a flag and queues an id, it never awaits.
      for (let i = 0; i < revealedPhantoms.length; i++) {
        forgetPhantom(revealedPhantoms[i]);
        markForDisposal(revealedPhantoms[i]);
      }
      // Reads `_fowStatus` as the sweep just left it, so a sprite that started
      // fading back in this pass has its phantom pinned opaque for the draw
      // that follows -- which is what its fade-in is composited over.
      refreshCoveredPhantoms();

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
    // the scene; only this bookkeeping is ours to clear.
    livePhantoms.clear();
    phantomOwner.clear();
  },
};
