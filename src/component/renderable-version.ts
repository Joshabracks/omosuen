/**
 * Per-type version counters for renderable component types (sprite, cell-map,
 * light) -- bumped whenever one is added to or removed from the scene, so a
 * consumer (e.g. camera/collect-renderables) can cheaply detect "has
 * anything of this type changed since I last collected it" with an integer
 * compare instead of a full tree walk.
 *
 * Bumped on add from Nexus.addComponent (the only place that pushes into a
 * nexus's `components` array) and on removal from each type's own
 * `dispose()` -- the one point every disposal path (`processDisposeQueue`,
 * `addComponent`'s uniqueness branches, and `Nexus.dispose()`'s
 * whole-subtree cascade) ultimately calls, rather than a single
 * disposal-queue hook, since `Nexus.dispose()`'s cascade disposes
 * descendants directly without going through the queue.
 */
export type RenderableType = 'sprite' | 'cell-map' | 'light';

const VERSIONS: Record<RenderableType, number> = {
  sprite: 0,
  'cell-map': 0,
  light: 0,
};

export function bumpRenderableVersion(type: RenderableType): void {
  VERSIONS[type]++;
}

export function getRenderableVersion(type: RenderableType): number {
  return VERSIONS[type];
}
