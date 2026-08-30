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
import { sweepFogOfWar } from './sweep';
import type { ObscuredTransition, ResolvedSource } from './sweep';
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
    });
  }
  return resolved;
}

/**
 * Spawns a "phantom" nexus at the scene root: a plain clone of `sprite`'s
 * current visual state plus a transform frozen at its current world
 * position/scale/yaw, marked `_fowStatus = 'phantom'`. This is the ONLY
 * thing that stands in for `sprite` while it's obscured -- `sprite` itself
 * (its nexus, its own update/gameplay logic) is never touched. `_generated`
 * excludes the phantom nexus from scene serialization (see
 * `serializeComponentRecursive`, src/scene/loader.ts).
 */
async function spawnPhantom(
  scene: NexusT,
  sprite: SpriteT,
  transform: TransformT,
): Promise<void> {
  const phantomNexus = (await newComponent(
    'nexus',
    { name: `${sprite.name}-fow-phantom` },
    scene,
  )) as NexusT | null;
  if (!phantomNexus) return;
  phantomNexus._generated = true;

  const p = transform.worldPosition;
  const s = transform.worldScale;
  const transformOptions: TransformOptions = {
    name: `${sprite.name}-fow-phantom-transform`,
    position: new Vector3D(p.x, p.y, p.z),
    rotation: new Vector3D(0, transform.worldRotation.y, 0),
    scale: new Vector3D(s.x, s.y, s.z),
  };
  await newComponent('transform', transformOptions, phantomNexus);

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
  await newComponent('sprite', spriteOptions, phantomNexus);
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
   * Gets how many cells beyond one chunk-width still count as "near" a
   * vision source for the fine-grained terrain-memory tier.
   */
  getNearBufferCells: (fow: FogOfWarT): number => {
    return fow.nearBufferCells;
  },

  /**
   * Sets how many cells beyond one chunk-width still count as "near" a
   * vision source for the fine-grained terrain-memory tier.
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

      // TEMPORARY -- Stage 0 measurement only.
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
        markForDisposal(revealedPhantoms[i]);
      }

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
  },
};
