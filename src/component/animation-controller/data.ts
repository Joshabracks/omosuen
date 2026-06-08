import {
  ComponentData,
  ComponentOptions,
  ComponentSerializer,
  ComponentUnique,
  ComponentInstanceMethods,
  DeserializationError,
  DeserializeResult,
} from '../types';
import type { AnimationControllerMethods } from './methods';
import type { Animation, AnimationState } from './types';
import type { ChannelType } from '../sprite/types';

/**
 * AnimationController component for managing sprite frame animations.
 * Handles animation playback, timing, and frame advancement.
 */
export interface AnimationControllerT
  extends ComponentData, ComponentInstanceMethods<AnimationControllerMethods> {
  type: 'animation-controller';
  unique: ComponentUnique.LOCAL;

  /**
   * Map of named animations.
   */
  animations: Map<string, Animation>;

  /**
   * Current playback state.
   */
  state: AnimationState;

  /**
   * Name of the currently active animation.
   */
  currentAnimation: string | null;

  /**
   * Current index within the active animation's frames array.
   */
  currentFrameIndex: number;

  /**
   * Accumulated time for the current frame in milliseconds.
   */
  frameTime: number;

  /**
   * Playback speed multiplier.
   * 1.0 = normal speed, 0.5 = half speed, 2.0 = double speed.
   */
  speed: number;

  /**
   * Which sprite channels to animate.
   * Default: ['albedo']
   */
  channels: ChannelType[];
}

export interface AnimationControllerOptions extends ComponentOptions {
  animations?: Animation[];
  channels?: ChannelType[];
  speed?: number;
}

/**
 * Builder function for creating AnimationController components.
 */
export function builder(
  options: AnimationControllerOptions,
): AnimationControllerT {
  // Build animations map from array
  const animationsMap = new Map<string, Animation>();
  if (options.animations) {
    for (const anim of options.animations) {
      // Apply defaults
      const animation: Animation = {
        name: anim.name,
        frames: anim.frames,
        frameRate: anim.frameRate ?? 12,
        loop: anim.loop ?? true,
        onComplete: anim.onComplete,
      };
      animationsMap.set(animation.name, animation);
    }
  }

  const controller = {
    type: 'animation-controller' as const,
    name: options.name,
    unique: ComponentUnique.LOCAL,
    parent: null,
    _disposed: false,

    animations: animationsMap,
    state: 'stopped' as AnimationState,
    currentAnimation: null,
    currentFrameIndex: 0,
    frameTime: 0,
    speed: options.speed ?? 1.0,
    channels: options.channels ?? ['albedo'],
  };

  return controller as unknown as AnimationControllerT;
}

/**
 * Serializes an animation controller component to a plain object.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serialize(component: ComponentData): any {
  const ac = component as AnimationControllerT;

  // Convert Map to array for serialization
  const animationsArray = Array.from(ac.animations.values());

  return {
    type: 'animation-controller',
    name: ac.name,
    unique: ComponentUnique.LOCAL,
    animations: animationsArray,
    state: ac.state,
    currentAnimation: ac.currentAnimation,
    currentFrameIndex: ac.currentFrameIndex,
    frameTime: ac.frameTime,
    speed: ac.speed,
    channels: ac.channels,
  };
}

/**
 * Deserializes a plain object back into an animation controller component.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deserialize(data: any): DeserializeResult<AnimationControllerT> {
  const errors: DeserializationError[] = [];

  if (!data || typeof data !== 'object') {
    return {
      component: null,
      errors: [
        {
          code: 'INVALID_DATA',
          message: 'animation-controller deserialize received non-object data',
        },
      ],
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const {
    type,
    name,
    animations,
    state,
    currentAnimation,
    currentFrameIndex,
    frameTime,
    speed,
    channels,
  } = data;

  if (type !== 'animation-controller') {
    errors.push({
      code: 'TYPE_MISMATCH',
      message: `type ${type} does not match "animation-controller"`,
    });
  }
  if (!name) {
    errors.push({
      code: 'MISSING_NAME',
      message: 'animation-controller requires a name',
    });
  }
  if (errors.length > 0) {
    return { component: null, errors };
  }

  const componentName = name as string;

  const animationsMap = new Map<string, Animation>();
  if (animations !== undefined) {
    if (!Array.isArray(animations)) {
      errors.push({
        code: 'INVALID_ANIMATIONS',
        message: `animation-controller "${componentName}" animations field is not an array; ignored`,
      });
    } else {
      for (let i = 0; i < animations.length; i += 1) {
        const anim = animations[i] as Animation | unknown;
        if (!anim || typeof anim !== 'object') {
          errors.push({
            code: 'INVALID_ANIMATION_ENTRY',
            message: `animation-controller "${componentName}" animations[${i}] is not an object; skipped`,
          });
          continue;
        }
        const a = anim as { name?: unknown } & Animation;
        if (typeof a.name !== 'string' || a.name.length === 0) {
          errors.push({
            code: 'MISSING_ANIMATION_NAME',
            message: `animation-controller "${componentName}" animations[${i}] missing name; skipped`,
          });
          continue;
        }
        animationsMap.set(a.name, a);
      }
    }
  }

  const controller = {
    type: 'animation-controller' as const,
    name: componentName,
    unique: ComponentUnique.LOCAL,
    parent: null,
    _disposed: false,

    animations: animationsMap,
    state: (state as AnimationState) ?? 'stopped',
    currentAnimation: (currentAnimation as string | null) ?? null,
    currentFrameIndex: (currentFrameIndex as number) ?? 0,
    frameTime: (frameTime as number) ?? 0,
    speed: (speed as number) ?? 1.0,
    channels: (channels as ChannelType[]) ?? ['albedo'],
  };

  return {
    component: controller as unknown as AnimationControllerT,
    errors,
  };
}

export const AnimationControllerSerializer: ComponentSerializer = {
  serialize,
  deserialize,
};

/**
 * Allowlist of animation-controller-specific properties accessible via component Proxy.
 */
export const PROPERTY_ALLOWLIST: string[] = [
  'animations',
  'state',
  'currentAnimation',
  'currentFrameIndex',
  'frameTime',
  'speed',
  'channels',
];
