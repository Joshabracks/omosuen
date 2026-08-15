import { CellMapT } from '../../cell-map';
import { LightT } from '../../light';
import { NexusT } from '../../nexus';
import { SpriteT } from '../../sprite';
import { castTo } from '../../types';
import { getRenderableVersion } from '../../renderable-version';
import { CameraT } from '../data';

// Per-camera renderables cache -- each entry remembers the per-type version
// (see renderable-version.ts) it was collected at, alongside the results.
// Each of the three arrays is independently re-collected only when its own
// type's version has changed since this camera last collected it -- a light
// being added doesn't force sprites/cell-maps to re-walk too.
interface RenderablesCacheEntry {
  spriteVersion: number;
  cellMapVersion: number;
  lightVersion: number;
  sprites: SpriteT[];
  cellMaps: CellMapT[];
  lights: LightT[];
}

const RENDERABLES_CACHE = new Map<number, RenderablesCacheEntry>();

export function clearRenderablesCache(cameraId: number): void {
  RENDERABLES_CACHE.delete(cameraId);
}

/**
 * Collects all renderable components (sprites, cell maps, and lights) from the render tree.
 *
 * @param camera - The camera component
 * @returns Object containing arrays of sprites, cell maps, and lights
 */
export function collectRenderables(camera: CameraT): {
  sprites: SpriteT[];
  cellMaps: CellMapT[];
  lights: LightT[];
} {
  if (!camera.parent || camera.parent.type !== 'nexus') {
    return { sprites: [], cellMaps: [], lights: [] };
  }

  const parentNexus = castTo<NexusT>(camera.parent!);

  // Search from scene root to find ALL components in the entire scene tree
  // This allows the camera to find components in sibling branches, not just children
  const sceneRoot = castTo<NexusT>(parentNexus.parent!);

  const spriteVersion = getRenderableVersion('sprite');
  const cellMapVersion = getRenderableVersion('cell-map');
  const lightVersion = getRenderableVersion('light');
  const cached = RENDERABLES_CACHE.get(camera.id!);

  // Recursively collect all sprites from the scene root, unless nothing of
  // type sprite has changed since this camera last collected them.
  const sprites =
    cached && cached.spriteVersion === spriteVersion
      ? cached.sprites
      : segmentedRenderOrderSort(
          sceneRoot.getComponentsByType('sprite', true) as SpriteT[],
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

  RENDERABLES_CACHE.set(camera.id!, {
    spriteVersion,
    cellMapVersion,
    lightVersion,
    sprites,
    cellMaps,
    lights,
  });

  return { sprites, cellMaps, lights };
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
