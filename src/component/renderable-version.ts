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
 *
 * `transform` is versioned for a narrower reason: it is not collected itself,
 * but collect-renderables caches each sprite's transform alongside the sprite,
 * and a transform added to (or removed from) a nexus after its sprite must
 * invalidate that pairing.
 */
export type RenderableType =
  | 'sprite'
  | 'cell-map'
  | 'light'
  | 'vision-source'
  | 'visibility-volume'
  | 'transform';

const VERSIONS: Record<RenderableType, number> = {
  sprite: 0,
  'cell-map': 0,
  light: 0,
  'vision-source': 0,
  'visibility-volume': 0,
  transform: 0,
};

export function bumpRenderableVersion(type: RenderableType): void {
  VERSIONS[type]++;
}

export function getRenderableVersion(type: RenderableType): number {
  return VERSIONS[type];
}
