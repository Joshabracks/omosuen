import { CellMapT } from '../../cell-map';
import { LightT } from '../../light';
import { VisionSourceT } from '../../vision-source';
import { VisibilityVolumeT } from '../../visibility-volume';
import { NexusT } from '../../nexus';
import { SpriteT } from '../../sprite';
import { TransformT } from '../../transform';
import { ComponentData, castTo, rawOf } from '../../types';
import { getRenderableVersion } from '../../renderable-version';
import { CameraT } from '../data';

/**
 * What the sprite pass needs per collected sprite, resolved once per
 * collection instead of once per sprite per frame. Three arrays parallel to
 * `sprites`.
 *
 * Everything here is the RAW data object (see `rawOf`), not the Proxy: the
 * draw loop reads a few dozen fields per sprite per frame, and each read
 * through the Proxy is a trap. Read-only by contract -- writes must still go
 * through the Proxy.
 */
export interface SpriteDrawData {
  /** `rawOf(sprites[i])`. */
  rawSprites: SpriteT[];
  /**
   * The first transform on the sprite's own nexus (what
   * `getComponentByType('transform', false)` would return), raw; null when the
   * sprite has no nexus parent or that nexus has no transform.
   */
  transforms: (TransformT | null)[];
  /** Whether the sprite's nexus carries its own vision-source. */
  selfLit: boolean[];
}

export interface Renderables {
  sprites: SpriteT[];
  spriteDraw: SpriteDrawData;
  cellMaps: CellMapT[];
  lights: LightT[];
  visionSources: VisionSourceT[];
  visibilityVolumes: VisibilityVolumeT[];
}

// Per-camera renderables cache -- each entry remembers the per-type version
// (see renderable-version.ts) it was collected at, alongside the results.
// Each of the arrays is independently re-collected only when its own
// type's version has changed since this camera last collected it -- a light
// being added doesn't force sprites/cell-maps to re-walk too.
interface RenderablesCacheEntry extends Renderables {
  spriteVersion: number;
  cellMapVersion: number;
  lightVersion: number;
  visionSourceVersion: number;
  visibilityVolumeVersion: number;
  /** Versions `spriteDraw` was resolved at (it also follows `sprites`). */
  spriteDrawTransformVersion: number;
  spriteDrawVisionSourceVersion: number;
}

const RENDERABLES_CACHE = new Map<number, RenderablesCacheEntry>();

export function clearRenderablesCache(cameraId: number): void {
  RENDERABLES_CACHE.delete(cameraId);
}

/**
 * Fills `out` for `sprites`. Sprites of one nexus are contiguous (see
 * `segmentedRenderOrderSort`), so the nexus scan is shared across a run.
 */
function resolveSpriteDrawData(sprites: SpriteT[], out: SpriteDrawData): void {
  const n = sprites.length;
  out.rawSprites.length = n;
  out.transforms.length = n;
  out.selfLit.length = n;

  let lastParent: ComponentData | null = null;
  let transform: TransformT | null = null;
  let selfLit = false;
  for (let i = 0; i < n; i++) {
    const raw = rawOf(sprites[i]);
    out.rawSprites[i] = raw;
    const parent = raw.parent ? rawOf(raw.parent) : null;
    if (i === 0 || parent !== lastParent) {
      lastParent = parent;
      transform = null;
      selfLit = false;
      if (parent && parent.type === 'nexus') {
        const components = (parent as NexusT).components;
        for (let j = 0; j < components.length; j++) {
          const type = components[j].type;
          if (type === 'transform') {
            if (!transform) transform = rawOf(components[j]) as TransformT;
          } else if (type === 'vision-source') {
            selfLit = true;
          }
        }
      }
    }
    out.transforms[i] = transform;
    out.selfLit[i] = selfLit;
  }
}

/**
 * Collects all renderable components (sprites, cell maps, and lights) from the render tree.
 *
 * The returned object is this camera's cache entry, reused across frames: read
 * it, don't keep or mutate it.
 *
 * @param camera - The camera component
 * @returns Object containing arrays of sprites, cell maps, and lights
 */
export function collectRenderables(camera: CameraT): Renderables {
  if (!camera.parent || camera.parent.type !== 'nexus') {
    return {
      sprites: [],
      spriteDraw: { rawSprites: [], transforms: [], selfLit: [] },
      cellMaps: [],
      lights: [],
      visionSources: [],
      visibilityVolumes: [],
    };
  }

  const parentNexus = castTo<NexusT>(camera.parent!);

  // Search from scene root to find ALL components in the entire scene tree
  // This allows the camera to find components in sibling branches, not just children
  const sceneRoot = castTo<NexusT>(parentNexus.parent!);

  const spriteVersion = getRenderableVersion('sprite');
  const cellMapVersion = getRenderableVersion('cell-map');
  const lightVersion = getRenderableVersion('light');
  const visionSourceVersion = getRenderableVersion('vision-source');
  const visibilityVolumeVersion = getRenderableVersion('visibility-volume');
  const cached = RENDERABLES_CACHE.get(camera.id!);

  // Recursively collect all sprites from the scene root, unless nothing of
  // type sprite has changed since this camera last collected them. Hidden
  // sprites (visible === false) are filtered out here -- safe to cache,
  // since the Proxy `set` trap (types.ts) bumps `spriteVersion` on every
  // write that can change the answer (Sprite.setVisible(), and
  // AnimationController's direct visible writes). Camera-relative off-screen
  // filtering is deliberately NOT done here -- see
  // 04-presentation-layer-visibility-skip/03-render-collection-visibility-split.md
  // for why that's a draw-time-only concern (render-sprites.ts), not safe to
  // fold into this add/remove/visible-toggle-keyed cache.
  const sprites =
    cached && cached.spriteVersion === spriteVersion
      ? cached.sprites
      : segmentedRenderOrderSort(
          (sceneRoot.getComponentsByType('sprite', true) as SpriteT[]).filter(
            (s) => s.visible !== false,
          ),
        );

  // Recursively collect all cell maps from the scene root, unless nothing of
  // type cell-map has changed since this camera last collected them.
  const cellMaps =
    cached && cached.cellMapVersion === cellMapVersion
      ? cached.cellMaps
      : (sceneRoot.getComponentsByType('cell-map', true) as CellMapT[]);

  // Recursively collect all lights from the scene root, unless nothing of
  // type light has changed since this camera last collected them.
  const lights =
    cached && cached.lightVersion === lightVersion
      ? cached.lights
      : (sceneRoot.getComponentsByType('light', true) as LightT[]);

  // Recursively collect all vision sources from the scene root, unless
  // nothing of type vision-source has changed since this camera last
  // collected them.
  const visionSources =
    cached && cached.visionSourceVersion === visionSourceVersion
      ? cached.visionSources
      : (sceneRoot.getComponentsByType(
          'vision-source',
          true,
        ) as VisionSourceT[]);

  // Same again for visibility-volumes, which share the vision sources' shape
  // store downstream (camera/render/visibility-uniforms.ts).
  const visibilityVolumes =
    cached && cached.visibilityVolumeVersion === visibilityVolumeVersion
      ? cached.visibilityVolumes
      : (sceneRoot.getComponentsByType(
          'visibility-volume',
          true,
        ) as VisibilityVolumeT[]);

  // Each sprite's transform and self-lit flag. Stale when the sprite list was
  // re-collected, or when a transform / vision-source was added or removed
  // anywhere (either can change the answer for a sprite that did not move).
  const transformVersion = getRenderableVersion('transform');
  const spriteDraw = cached
    ? cached.spriteDraw
    : { rawSprites: [], transforms: [], selfLit: [] };
  if (
    !cached ||
    cached.sprites !== sprites ||
    cached.spriteDrawTransformVersion !== transformVersion ||
    cached.spriteDrawVisionSourceVersion !== visionSourceVersion
  ) {
    resolveSpriteDrawData(sprites, spriteDraw);
  }

  // Update the entry in place: this runs every frame for every camera, and a
  // fresh object per call was pure garbage on the (usual) all-hit frame.
  if (cached) {
    cached.spriteVersion = spriteVersion;
    cached.cellMapVersion = cellMapVersion;
    cached.lightVersion = lightVersion;
    cached.visionSourceVersion = visionSourceVersion;
    cached.visibilityVolumeVersion = visibilityVolumeVersion;
    cached.spriteDrawTransformVersion = transformVersion;
    cached.spriteDrawVisionSourceVersion = visionSourceVersion;
    cached.sprites = sprites;
    cached.cellMaps = cellMaps;
    cached.lights = lights;
    cached.visionSources = visionSources;
    cached.visibilityVolumes = visibilityVolumes;
    return cached;
  }

  const entry: RenderablesCacheEntry = {
    spriteVersion,
    cellMapVersion,
    lightVersion,
    visionSourceVersion,
    visibilityVolumeVersion,
    spriteDrawTransformVersion: transformVersion,
    spriteDrawVisionSourceVersion: visionSourceVersion,
    sprites,
    spriteDraw,
    cellMaps,
    lights,
    visionSources,
    visibilityVolumes,
  };
  RENDERABLES_CACHE.set(camera.id!, entry);
  return entry;
}

/**
 * Orders the sprites of each composited entity by `renderOrder` (within-entity
 * layering). Cross-entity ordering is handled later, in `renderSprites`, which
 * stable-sorts the whole list back-to-front by depth — so this pass only needs to
 * establish each entity's internal layer order, which that stable depth sort then
 * preserves (a composited entity's layers share one transform → equal depth).
 *
 * `getComponentsByType` returns a nexus's own sprites contiguously before recursing
 * into child nexuses, so all sprites of one composited entity form a contiguous run.
 * We stable-sort by `renderOrder` ONLY within each such run (low = underneath); the
 * fast path returns the array untouched when every entity is single-sprite.
 */
function segmentedRenderOrderSort(sprites: SpriteT[]): SpriteT[] {
  const n = sprites.length;
  if (n < 2) return sprites;

  // Fast path: if no two adjacent sprites share a parent nexus, every entity is
  // single-sprite and there is nothing to reorder — return the array untouched
  // (no allocation). This is the common case, run every frame.
  let hasMultiSpriteRun = false;
  for (let i = 1; i < n; i++) {
    // Compare raw `parent` identity (all sprites of a nexus share the same raw
    // parent reference) — do NOT wrap in castTo here.
    if (sprites[i].parent === sprites[i - 1].parent) {
      hasMultiSpriteRun = true;
      break;
    }
  }
  if (!hasMultiSpriteRun) return sprites;

  const out: SpriteT[] = [];
  let runStart = 0;
  for (let i = 1; i <= n; i++) {
    const endOfRun = i === n || sprites[i].parent !== sprites[runStart].parent;
    if (!endOfRun) continue;

    if (i - runStart === 1) {
      // Single-sprite run — nothing to sort.
      out.push(sprites[runStart]);
    } else {
      // Stable-sort the run by renderOrder ascending. Array.sort is stable
      // (ES2019+), so equal renderOrder preserves original collection order.
      const run = sprites
        .slice(runStart, i)
        .sort((a, b) => a.renderOrder - b.renderOrder);
      for (let j = 0; j < run.length; j++) out.push(run[j]);
    }
    runStart = i;
  }
  return out;
}
