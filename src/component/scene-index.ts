/**
 * Per-frame flat scene index.
 *
 * A single scene-wide walk already runs every frame to refresh the `onScreen`
 * signal (`transform/on-screen.ts`, loop phase 3.6). That walk visits every
 * nexus and scans its `components` array, which is exactly the work any other
 * system needs in order to answer "which sprites exist, and what transform /
 * vision-source sits alongside each one". This module lets that one walk
 * publish its findings as flat parallel arrays so consumers don't each repeat
 * the traversal.
 *
 * Fog-of-war was the motivating consumer: it used to run three separate
 * recursive `getComponentsByType` walks plus two `getComponentByType` lookups
 * per sprite per frame, all duplicating a traversal that had already happened
 * earlier in the same frame.
 *
 * ## Contract
 *
 * - Entries hold the same PROXY references the scene tree holds, not raw
 *   targets. Component identity is load-bearing (`disposeComponent` detaches
 *   by `c !== component`), so an unwrapped target handed to an engine API
 *   would silently fail to detach.
 * - A sprite entry exists only if its parent nexus also has a transform --
 *   there is nothing useful a positional consumer can do without one.
 * - Nothing is filtered by `_disposed`, matching `getComponentsByType`'s
 *   semantics. Consumers reading the index on a LATER frame than it was built
 *   must guard on `_disposed` themselves.
 * - Arrays are grown to a high-water mark and never shrunk, so a warmed index
 *   allocates nothing per frame. **Read `count` / `visionSourceCount` /
 *   `cellMapCount`, never `.length`** -- entries past the count are stale
 *   references from a previous, larger frame.
 */

import type { ComponentData } from './types';
import type { NexusT } from './nexus/data';
import type { TransformT } from './transform/data';
import type { SpriteT } from './sprite/data';
import type { VisionSourceT } from './vision-source/data';
import type { CellMapT } from './cell-map/data';

/**
 * The published index. A single mutable object rather than accessor functions
 * so a hot consumer loop reads plain fields off one shape.
 */
export const sceneIndex = {
  /** Number of valid sprite entries. Entries past this are stale. */
  count: 0,
  /** Parent nexus of `sprites[i]`. */
  nexuses: [] as NexusT[],
  /** The nexus's first transform. Never null within `count`. */
  transforms: [] as TransformT[],
  sprites: [] as SpriteT[],
  /**
   * Whether `nexuses[i]` also carries a vision-source. Fog-of-war needs this
   * per sprite and it is free to collect during the same component scan.
   */
  selfLit: [] as boolean[],

  /** Number of valid entries in `visionSources`. */
  visionSourceCount: 0,
  visionSources: [] as VisionSourceT[],

  /** Number of valid entries in `cellMaps`. */
  cellMapCount: 0,
  cellMaps: [] as CellMapT[],

  /**
   * Incremented each time the index is rebuilt. Lets a consumer notice it is
   * reading an index built on an earlier frame.
   */
  generation: 0,
};

/** Resets the counts. Retains the backing arrays for reuse. */
export function beginSceneIndex(): void {
  sceneIndex.count = 0;
  sceneIndex.visionSourceCount = 0;
  sceneIndex.cellMapCount = 0;
}

/**
 * Records one sprite and the transform/vision-source alongside it. Assigns by
 * index rather than pushing so a shrinking scene reuses slots instead of
 * repeatedly growing and truncating.
 */
export function addSpriteEntry(
  nexus: NexusT,
  transform: TransformT,
  sprite: SpriteT,
  selfLit: boolean,
): void {
  const i = sceneIndex.count++;
  sceneIndex.nexuses[i] = nexus;
  sceneIndex.transforms[i] = transform;
  sceneIndex.sprites[i] = sprite;
  sceneIndex.selfLit[i] = selfLit;
}

export function addVisionSourceEntry(source: VisionSourceT): void {
  sceneIndex.visionSources[sceneIndex.visionSourceCount++] = source;
}

export function addCellMapEntry(cellMap: CellMapT): void {
  sceneIndex.cellMaps[sceneIndex.cellMapCount++] = cellMap;
}

/** Publishes the finished index. Call once, after the walk completes. */
export function endSceneIndex(): void {
  sceneIndex.generation++;
}

/**
 * Scans one nexus's components, recording every sprite in it along with that
 * nexus's first transform and first vision-source.
 *
 * Two passes over `comps` rather than one, because a sprite can appear before
 * its sibling transform in the array and an entry needs both. `comps` is a
 * handful of entries, so the second pass costs far less than the bookkeeping
 * needed to fix up entries after the fact.
 *
 * Returns the nexus's first transform (or null), which the caller needs
 * anyway for its own per-nexus work.
 */
export function indexNexusComponents(n: NexusT): TransformT | null {
  const comps = n.components;
  let transform: TransformT | null = null;
  let selfLit = false;
  let hasSprite = false;

  for (let i = 0; i < comps.length; i++) {
    const c: ComponentData = comps[i];
    const t = c.type;
    if (t === 'transform') {
      if (transform === null) transform = c as unknown as TransformT;
    } else if (t === 'sprite') {
      hasSprite = true;
    } else if (t === 'vision-source') {
      // Every one of them, matching `getComponentsByType`. `selfLit` only
      // needs to know whether there was at least one, matching the
      // `getComponentByType(..., false)` truthiness test it replaces.
      selfLit = true;
      addVisionSourceEntry(c as unknown as VisionSourceT);
    } else if (t === 'cell-map') {
      addCellMapEntry(c as unknown as CellMapT);
    }
  }

  if (hasSprite && transform !== null) {
    for (let i = 0; i < comps.length; i++) {
      const c: ComponentData = comps[i];
      if (c.type !== 'sprite') continue;
      addSpriteEntry(n, transform, c as unknown as SpriteT, selfLit);
    }
  }

  return transform;
}
