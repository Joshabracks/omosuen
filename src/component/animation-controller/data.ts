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
import type { Animation, AnimationLayer, AnimationState } from './types';
import type { ChannelType } from '../sprite/types';
import type { SpriteT } from '../sprite/data';
import type { TransformT } from '../transform';

/**
 * AnimationController component for managing sprite frame animations.
 * Handles animation playback, timing, and frame advancement.
 */
export interface AnimationControllerT
  extends ComponentData, ComponentInstanceMethods<AnimationControllerMethods> {
  type: 'animation-controller';
  unique: ComponentUnique.LOCAL;

  /**
   * Map of named animations. Either owned by this controller (built from an
   * inline `animations` array) or shared by reference from an `animation-map`
   * component (when `animationMapRef` is set) — resolved at init.
   */
  animations: Map<string, Animation>;

  /**
   * If set, the `animationMapKey` of a shared `animation-map` component this
   * controller pulls its animations from (resolved at init). Mutating methods
   * (addAnimation/removeAnimation/setChannels) copy-on-write into an owned Map
   * and clear this, so a per-entity edit never touches the shared (frozen) set.
   */
  animationMapRef?: string;

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

  /**
   * Logical layers driven by this controller. Each binds a sibling sprite by
   * name; the controller sets the current frame on all of them in lockstep.
   * When empty, `init` auto-binds one layer per sibling sprite (which keeps the
   * classic single-sprite behavior working unchanged).
   */
  layers: AnimationLayer[];

  /**
   * Transient cache of the resolved sprite for each layer (parallel to
   * `layers`; null where a layer's sprite isn't currently found). Built once at
   * init and on layer changes so the per-frame update path neither re-walks the
   * nexus nor searches by name. Rebuilt on demand; never serialized.
   */
  _layerSprites?: (SpriteT | null)[];

  /**
   * Transient cache of the sibling transform consulted for the on-screen
   * write-gate. `undefined` = not yet resolved; `null` = resolved, no sibling
   * transform found. Resolved once and never invalidated post-construction
   * (reparenting isn't a real, exercised operation in this engine). Never
   * serialized.
   */
  _transformRef?: TransformT | null;

  /**
   * True while a sprite-frame write has been skipped by the on-screen gate
   * since the last successful write -- i.e. the sprites' displayed frame may be stale
   * relative to `currentFrameIndex`. Consulted on the next `update()` call
   * where the gate opens again, to write the current frame immediately
   * rather than waiting for the next natural frame-boundary crossing (which
   * could be up to one full animation-frame's duration away, showing a
   * stale/incorrect frame in the meantime). Never serialized.
   */
  _spriteFramesStale?: boolean;
}

export interface AnimationControllerOptions extends ComponentOptions {
  /**
   * Inline animation data, OR a string `animationMapKey` referencing a shared
   * `animation-map` component (resolved at init). A string lets many controllers
   * share one set of timelines instead of each inlining a copy.
   */
  animations?: Animation[] | string;
  channels?: ChannelType[];
  speed?: number;
  layers?: AnimationLayer[];
}

/**
 * Builder function for creating AnimationController components.
 */
export function builder(
  options: AnimationControllerOptions,
): AnimationControllerT {
  // `animations` may be an array (own the timelines) or a string key (share them
  // from an animation-map, resolved at init).
  const animationMapRef =
    typeof options.animations === 'string' ? options.animations : undefined;

  // Build animations map from array (empty when referencing an animation-map).
  const animationsMap = new Map<string, Animation>();
  if (Array.isArray(options.animations)) {
    for (const anim of options.animations) {
      // Apply defaults
      const animation: Animation = {
        name: anim.name,
        frames: anim.frames,
        frameRate: anim.frameRate ?? 12,
        frameDurations: anim.frameDurations,
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
    animationMapRef,
    state: 'stopped' as AnimationState,
    currentAnimation: null,
    currentFrameIndex: 0,
    frameTime: 0,
    speed: options.speed ?? 1.0,
    channels: options.channels ?? ['albedo'],
    layers: options.layers ?? [],
  };

  return controller as unknown as AnimationControllerT;
}

/**
 * Serializes an animation controller component to a plain object.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serialize(component: ComponentData): any {
  const ac = component as AnimationControllerT;

  // Referencing a shared animation-map → persist just the key (a string).
  // Otherwise convert the owned Map to an array.
  const animations = ac.animationMapRef
    ? ac.animationMapRef
    : Array.from(ac.animations.values());

  return {
    type: 'animation-controller',
    name: ac.name,
    unique: ComponentUnique.LOCAL,
    animations,
    state: ac.state,
    currentAnimation: ac.currentAnimation,
    currentFrameIndex: ac.currentFrameIndex,
    frameTime: ac.frameTime,
    speed: ac.speed,
    channels: ac.channels,
    layers: ac.layers,
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
    layers,
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

  // A string `animations` is an animation-map reference — round-trip it straight
  // through the builder's string path.
  if (typeof animations === 'string') {
    return {
      component: builder({
        name: componentName,
        animations,
        speed: (speed as number) ?? 1.0,
        channels: (channels as ChannelType[]) ?? ['albedo'],
        layers: layers as AnimationLayer[] | undefined,
      }) as AnimationControllerT,
      errors,
    };
  }

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

  // Reconstruct layers (each: name, spriteName, optional slot, visible).
  const layersArray: AnimationLayer[] = [];
  if (layers !== undefined) {
    if (!Array.isArray(layers)) {
      errors.push({
        code: 'INVALID_LAYERS',
        message: `animation-controller "${componentName}" layers field is not an array; ignored`,
      });
    } else {
      for (let i = 0; i < layers.length; i += 1) {
        const l = layers[i] as Partial<AnimationLayer> | unknown;
        if (!l || typeof l !== 'object') {
          errors.push({
            code: 'INVALID_LAYER_ENTRY',
            message: `animation-controller "${componentName}" layers[${i}] is not an object; skipped`,
          });
          continue;
        }
        const layer = l as Partial<AnimationLayer>;
        if (
          typeof layer.name !== 'string' ||
          typeof layer.spriteName !== 'string'
        ) {
          errors.push({
            code: 'INVALID_LAYER',
            message: `animation-controller "${componentName}" layers[${i}] missing name/spriteName; skipped`,
          });
          continue;
        }
        layersArray.push({
          name: layer.name,
          spriteName: layer.spriteName,
          slot: typeof layer.slot === 'string' ? layer.slot : undefined,
          visible: layer.visible !== false,
        });
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
    layers: layersArray,
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
  'animationMapRef',
  'state',
  'currentAnimation',
  'currentFrameIndex',
  'frameTime',
  'speed',
  'channels',
  'layers',
  '_layerSprites',
  '_transformRef',
  '_spriteFramesStale',
];
