import { CellMapT } from '../../cell-map';
import { LightT } from '../../light';
import { NexusT } from '../../nexus';
import { SpriteT } from '../../sprite';
import { castTo } from '../../types';
import { CameraT } from '../data';

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

  // Recursively collect all sprites from the scene root
  const sprites = segmentedRenderOrderSort(
    sceneRoot.getComponentsByType('sprite', true) as SpriteT[],
  );

  // Recursively collect all cell maps from the scene root
  const cellMaps = sceneRoot.getComponentsByType(
    'cell-map',
    true,
  ) as CellMapT[];

  // Recursively collect all lights from the scene root
  const lights = sceneRoot.getComponentsByType('light', true) as LightT[];

  return { sprites, cellMaps, lights };
}

/**
 * Orders sprites for painter's-algorithm drawing (the sprite pass runs with the
 * depth test disabled, so sprite-on-sprite order is draw order).
 *
 * `getComponentsByType` returns a nexus's own sprites contiguously before
 * recursing into child nexuses, so all sprites of one composited entity form a
 * contiguous run. We stable-sort by `renderOrder` ONLY within each such run, so:
 *  - a multi-sprite entity's layers stack by renderOrder (low = underneath), and
 *  - the relative order of different entities is preserved exactly (existing
 *    scenes are unaffected; entities never interweave and "pass through" each
 *    other).
 */
function segmentedRenderOrderSort(sprites: SpriteT[]): SpriteT[] {
  if (sprites.length < 2) return sprites;

  const out: SpriteT[] = [];
  let runStart = 0;
  for (let i = 1; i <= sprites.length; i++) {
    // A run ends at the array end or when the parent nexus changes.
    // Compare raw `parent` identity (all sprites of a nexus share the same
    // raw parent reference) — do NOT wrap in castTo here.
    const endOfRun =
      i === sprites.length || sprites[i].parent !== sprites[runStart].parent;
    if (!endOfRun) continue;

    // Stable-sort [runStart, i) by renderOrder ascending. Decorate with the
    // original index for a guaranteed-stable tiebreak across all engines.
    const run = sprites
      .slice(runStart, i)
      .map((s, idx) => ({ s, idx }))
      .sort((a, b) =>
        a.s.renderOrder !== b.s.renderOrder
          ? a.s.renderOrder - b.s.renderOrder
          : a.idx - b.idx,
      );
    for (const e of run) out.push(e.s);
    runStart = i;
  }
  return out;
}
