import type {
  ComponentData,
  ComponentOptions,
  ComponentSerializer,
  ComponentInstanceMethods,
  DeserializationError,
  DeserializeResult,
} from '../types';
import { ComponentUnique } from '../types';
import type { Animation } from '../animation-controller/types';
import type { AnimationMapMethods } from './methods';

/**
 * A shared, referenceable library of named animations. Structured like
 * `texture-map`: it owns a keyed set (`animationMapKey` → `animations`) that lives
 * once in the scene tree, and `animation-controller`s reference it by key so many
 * entities of the same art set share one set of timelines instead of each
 * inlining a copy. The `animations` Map and every `Animation` in it are frozen at
 * build time, so a shared set can't be mutated out from under a referrer.
 */
export interface AnimationMapT
  extends ComponentData, ComponentInstanceMethods<AnimationMapMethods> {
  type: 'animation-map';
  unique: ComponentUnique.FALSE;

  /** Unique key for this animation set (referenced by animation-controllers). */
  animationMapKey: string;

  /** Named animations, keyed by animation name. Frozen (read-only, shared). */
  animations: Map<string, Animation>;
}

export const PROPERTY_ALLOWLIST = ['animationMapKey', 'animations'];

export interface AnimationMapOptions extends ComponentOptions {
  animationMapKey: string;
  animations?: Animation[];
}

/**
 * Deep-freezes an animation so a shared set can't be mutated in place. A direct
 * edit (e.g. `getAnimation('walk').frames.push(0)`) then throws in strict mode
 * instead of silently corrupting every entity that shares this set.
 */
function freezeAnimation(a: Animation): Animation {
  Object.freeze(a.frames);
  if (a.frameDurations) Object.freeze(a.frameDurations);
  return Object.freeze(a);
}

/**
 * Builder for AnimationMap components. Applies the same per-animation defaults the
 * animation-controller builder does, then freezes each animation.
 */
export function builder(options: AnimationMapOptions): AnimationMapT {
  const animationsMap = new Map<string, Animation>();
  if (options.animations) {
    for (const anim of options.animations) {
      const animation: Animation = {
        name: anim.name,
        frames: anim.frames,
        frameRate: anim.frameRate ?? 12,
        frameDurations: anim.frameDurations,
        loop: anim.loop ?? true,
        onComplete: anim.onComplete,
      };
      animationsMap.set(animation.name, freezeAnimation(animation));
    }
  }

  const animationMap = {
    type: 'animation-map' as const,
    name: options.name || options.animationMapKey,
    unique: ComponentUnique.FALSE,
    parent: null,
    _disposed: false,
    animationMapKey: options.animationMapKey,
    animations: animationsMap,
  };

  return animationMap as unknown as AnimationMapT;
}

/**
 * Serializes an animation-map to a plain object (Map → array), mirroring how the
 * animation-controller serializes its animations.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serialize(component: ComponentData): any {
  const am = component as AnimationMapT;
  return {
    type: 'animation-map',
    name: am.name,
    unique: ComponentUnique.FALSE,
    animationMapKey: am.animationMapKey,
    animations: Array.from(am.animations.values()),
  };
}

/**
 * Deserializes a plain object back into an animation-map component.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deserialize(data: any): DeserializeResult<AnimationMapT> {
  const errors: DeserializationError[] = [];

  if (!data || typeof data !== 'object') {
    return {
      component: null,
      errors: [
        {
          code: 'INVALID_DATA',
          message: 'animation-map deserialize received non-object data',
        },
      ],
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const { type, name, animationMapKey, animations } = data;

  if (type !== 'animation-map') {
    errors.push({
      code: 'TYPE_MISMATCH',
      message: `type ${String(type)} does not match "animation-map"`,
    });
  }
  if (!name) {
    errors.push({
      code: 'MISSING_NAME',
      message: 'animation-map requires a name',
    });
  }
  if (typeof animationMapKey !== 'string' || animationMapKey.length === 0) {
    errors.push({
      code: 'MISSING_ANIMATION_MAP_KEY',
      message: 'animation-map requires an animationMapKey',
    });
  }
  if (errors.length > 0) {
    return { component: null, errors };
  }

  const animationsArray: Animation[] = [];
  if (animations !== undefined) {
    if (!Array.isArray(animations)) {
      errors.push({
        code: 'INVALID_ANIMATIONS',
        message: `animation-map "${String(name)}" animations field is not an array; ignored`,
      });
    } else {
      for (let i = 0; i < animations.length; i += 1) {
        const anim = animations[i] as { name?: unknown } & Animation;
        if (!anim || typeof anim !== 'object') {
          errors.push({
            code: 'INVALID_ANIMATION_ENTRY',
            message: `animation-map "${String(name)}" animations[${i}] is not an object; skipped`,
          });
          continue;
        }
        if (typeof anim.name !== 'string' || anim.name.length === 0) {
          errors.push({
            code: 'MISSING_ANIMATION_NAME',
            message: `animation-map "${String(name)}" animations[${i}] missing name; skipped`,
          });
          continue;
        }
        animationsArray.push(anim);
      }
    }
  }

  return {
    component: builder({
      name: name as string,
      animationMapKey: animationMapKey as string,
      animations: animationsArray,
    }),
    errors,
  };
}

export const AnimationMapSerializer: ComponentSerializer = {
  serialize,
  deserialize,
};
