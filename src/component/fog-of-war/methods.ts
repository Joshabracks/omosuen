import {
  ComponentData,
  ComponentMethods,
  castTo,
  newComponent,
} from '../types';
import { FogOfWarT, FogOfWarStyle } from './data';
import { Vector2D, Vector3D, Vector4D } from '../../math';
import { getActiveScene } from '../../scene';
import type { NexusT } from '../nexus/data';
import type { SpriteT, SpriteOptions } from '../sprite/data';
import type { TransformT, TransformOptions } from '../transform/data';
import type { VisionSourceT } from '../vision-source/data';
import type { CellMapT } from '../cell-map/data';
import { computeSolidityMap } from '../camera/render/visibility-mask';
import { isRayBlockedTS } from '../camera/render/explored-sweep';
import { markForDisposal } from '../../loop/dispose';

/** A vision source resolved to a plain world position, once per fog-of-war update tick. */
interface ResolvedSource {
  pos: { x: number; y: number; z: number };
  radius: number;
  fadeWidth: number;
}

function resolveActiveVisionSources(scene: NexusT): ResolvedSource[] {
  const sources = scene.getComponentsByType(
    'vision-source',
    true,
  ) as VisionSourceT[];
  const resolved: ResolvedSource[] = [];
  for (const source of sources) {
    if (!source.enabled) continue;
    if (!source.parent || source.parent.type !== 'nexus') continue;
    const transform = castTo<NexusT>(source.parent).getComponentByType(
      'transform',
      false,
    ) as TransformT | null;
    if (!transform) continue;
    const pos = transform.worldPosition;
    resolved.push({
      pos: { x: pos.x, y: pos.y, z: pos.z },
      radius: source.radius,
      fadeWidth: source.fadeWidth,
    });
  }
  return resolved;
}

/**
 * Real (accurate, per-fragment-matching) visibility test for a single
 * world point: early distance-squared reject per source (cheap), then the
 * same DDA raycast the live shader path and the explored-chunk sweep both
 * use, so a tracked sprite's visible/obscured transition agrees with what
 * the per-pixel shader test would actually show.
 */
function isPositionVisible(
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
    const outer = source.radius + source.fadeWidth;
    if (dx * dx + dy * dy + dz * dz >= outer * outer) continue;

    const sourceLocalCellX =
      source.pos.x / cellSize.x - windowOriginLocalCell.x;
    const sourceLocalCellY =
      source.pos.y / cellSize.y - windowOriginLocalCell.y;
    const sourceLocalCellZ =
      source.pos.z / cellSize.z - windowOriginLocalCell.z;

    if (
      !isRayBlockedTS(
        mask,
        cellDims,
        sourceLocalCellX,
        sourceLocalCellY,
        sourceLocalCellZ,
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

      const cellMaps = scene.getComponentsByType(
        'cell-map',
        true,
      ) as CellMapT[];
      // Same "assume the first cell-map" simplification already used by
      // render-cell-maps.ts/render-sprites.ts throughout the fog-of-war
      // feature -- a scene with multiple cell-maps tests sprite visibility
      // against only the first one's solidity/window data.
      const originCellMap = cellMaps[0];
      const windowOrigin = originCellMap?.window.origin;
      if (!originCellMap || !windowOrigin) return;

      const mask = computeSolidityMap();
      const cellDims = originCellMap.mapSize;
      const cellSize = originCellMap.cellSize;
      const windowOriginLocalCell = {
        x: windowOrigin.cx * originCellMap.chunkSize.x,
        y: windowOrigin.cy * originCellMap.chunkSize.y,
        z: windowOrigin.cz * originCellMap.chunkSize.z,
      };

      const sources = resolveActiveVisionSources(scene);
      const sprites = scene.getComponentsByType('sprite', true) as SpriteT[];

      for (const sprite of sprites) {
        if (!sprite.parent || sprite.parent.type !== 'nexus') continue;
        const nexus = castTo<NexusT>(sprite.parent);
        const transform = nexus.getComponentByType(
          'transform',
          false,
        ) as TransformT | null;
        if (!transform) continue;

        // A spawned phantom: check whether vision has returned to ITS OWN
        // (frozen) position, independent of wherever the real sprite it
        // stood in for currently is.
        if (sprite._fowStatus === 'phantom') {
          const visible = isPositionVisible(
            transform.worldPosition,
            sources,
            mask,
            cellDims,
            windowOriginLocalCell,
            cellSize,
          );
          if (visible) markForDisposal(nexus);
          continue;
        }

        if (sprite.trackedByFog !== true) continue;
        // A sprite carrying its own vision-source always sees itself --
        // never obscure/phantom it (render-sprites.ts also defensively
        // forces such a sprite to draw live regardless of `_fowStatus`).
        if (nexus.getComponentByType('vision-source', false)) continue;

        const visible = isPositionVisible(
          transform.worldPosition,
          sources,
          mask,
          cellDims,
          windowOriginLocalCell,
          cellSize,
        );

        if (visible) {
          if (sprite._fowStatus === 'obscured') sprite._fowStatus = 'visible';
          continue;
        }
        if (sprite._fowStatus === 'visible') {
          sprite._fowStatus = 'obscured';
          await spawnPhantom(scene, sprite, transform);
        }
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
