import type { ComponentData, ComponentMethods } from '../types';
import type { AnimationMapT } from './data';
import type { Animation } from '../animation-controller/types';

/**
 * Methods for the `animation-map` component: a shared, read-only library of named
 * animations referenced by key (mirrors how `texture-map` is referenced by
 * `textureMapKey`). Many `animation-controller`s can point at one `animation-map`
 * so identical art doesn't duplicate its timelines per entity.
 */
export interface AnimationMapMethods extends ComponentMethods {
  type: 'animation-map';

  /** Returns the named animation, or null. */
  getAnimation: (am: AnimationMapT, name: string) => Animation | null;

  /** Whether the named animation exists. */
  hasAnimation: (am: AnimationMapT, name: string) => boolean;

  /** All animation names in this map. */
  getAnimationNames: (am: AnimationMapT) => string[];
}

export const AnimationMap: AnimationMapMethods = {
  type: 'animation-map',

  getAnimation: (am: AnimationMapT, name: string): Animation | null =>
    am.animations.get(name) ?? null,

  hasAnimation: (am: AnimationMapT, name: string): boolean =>
    am.animations.has(name),

  getAnimationNames: (am: AnimationMapT): string[] =>
    Array.from(am.animations.keys()),

  dispose: (component: ComponentData): void => {
    component._disposed = true;
  },
};
