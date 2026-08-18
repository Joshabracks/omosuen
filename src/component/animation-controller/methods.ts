import { ComponentData, ComponentMethods, castTo } from '../types';
import { AnimationControllerT } from './data';
import type { Animation, AnimationLayer, AnimationState } from './types';
import type { ChannelType } from '../sprite/types';
import type { NexusT } from '../nexus/data';
import type { SpriteT } from '../sprite/data';
import type { TransformT } from '../transform';
import type { AnimationMapT } from '../animation-map/data';
import { MethodRegistry } from '../registry';

export interface AnimationControllerMethods extends ComponentMethods {
  init: (component: ComponentData) => Promise<void>;
  update: (component: ComponentData, deltaTime: number) => void;
  addAnimation: (
    controller: AnimationControllerT,
    animation: Animation,
  ) => void;
  removeAnimation: (controller: AnimationControllerT, name: string) => void;
  hasAnimation: (controller: AnimationControllerT, name: string) => boolean;
  getAnimation: (
    controller: AnimationControllerT,
    name: string,
  ) => Animation | null;
  play: (
    controller: AnimationControllerT,
    name: string,
    restart?: boolean,
  ) => void;
  pause: (controller: AnimationControllerT) => void;
  resume: (controller: AnimationControllerT) => void;
  stop: (controller: AnimationControllerT) => void;
  getState: (controller: AnimationControllerT) => AnimationState;
  isPlaying: (controller: AnimationControllerT) => boolean;
  getCurrentAnimation: (controller: AnimationControllerT) => string | null;
  getCurrentFrame: (controller: AnimationControllerT) => number;
  setSpeed: (controller: AnimationControllerT, speed: number) => void;
  getSpeed: (controller: AnimationControllerT) => number;
  setChannels: (
    controller: AnimationControllerT,
    channels: ChannelType[],
  ) => void;
  getChannels: (controller: AnimationControllerT) => ChannelType[];
  setLayerVisible: (
    controller: AnimationControllerT,
    layerName: string,
    visible: boolean,
  ) => void;
  addLayer: (controller: AnimationControllerT, layer: AnimationLayer) => void;
  getLayer: (
    controller: AnimationControllerT,
    layerName: string,
  ) => AnimationLayer | null;
  getLayers: (controller: AnimationControllerT) => AnimationLayer[];
}

export const AnimationController: AnimationControllerMethods = {
  type: 'animation-controller',

  /**
   * Initializes the animation controller. Binds its layers to the sibling
   * sprites in the parent nexus and applies their initial visibility.
   *
   * If `layers` is empty, auto-binds one layer per sibling sprite (keyed by
   * sprite name) — preserving the classic single-sprite behavior.
   */
  async init(component: ComponentData): Promise<void> {
    const ac = component as AnimationControllerT;
    if (!ac.parent) {
      console.warn(
        `[animation-controller] Cannot initialize '${ac.name}' - no parent nexus`,
      );
      return;
    }
    // parent is stored raw; wrap it to reach the nexus's proxy methods.
    const parent = castTo<NexusT>(ac.parent);

    // Resolve a shared animation-map reference: share its (frozen) animations Map
    // by reference. Missing key errors like a missing texture-map.
    if (ac.animationMapRef) {
      const map = findAnimationMapByKey(parent, ac.animationMapRef);
      if (map) {
        ac.animations = map.animations;
      } else {
        console.error(
          `[animation-controller] '${ac.name}' references animation-map '${ac.animationMapRef}' but none was found in the scene`,
        );
      }
    }

    // Only sprites in THIS nexus (non-recursive) are layers of this entity.
    const sprites = parent.getComponentsByType('sprite') as SpriteT[];
    if (sprites.length === 0) {
      console.warn(
        `[animation-controller] No sibling sprite found for '${ac.name}'`,
      );
      return;
    }

    // Auto-bind one layer per sibling sprite when none were configured.
    if (ac.layers.length === 0) {
      ac.layers = sprites.map((s) => ({
        name: s.name,
        spriteName: s.name,
        visible: s.visible !== false,
      }));
    }

    // Resolve + cache each layer's sprite once, then apply visibility from it
    // (cache parallels `layers`).
    const layerSprites = resolveLayerSprites(ac);
    for (let i = 0; i < ac.layers.length; i++) {
      const sprite = layerSprites[i];
      if (sprite) sprite.visible = ac.layers[i].visible;
    }
  },

  /**
   * Updates the animation controller each frame.
   * Advances animation frames based on deltaTime.
   */
  update(component: ComponentData, deltaTime: number) {
    const ac = component as AnimationControllerT;

    // Only update if playing
    if (ac.state !== 'playing') {
      return;
    }

    // Get current animation
    if (!ac.currentAnimation) {
      return;
    }

    const animation = ac.animations.get(ac.currentAnimation);
    if (!animation) {
      console.warn(
        `[animation-controller] Animation '${ac.currentAnimation}' not found in '${ac.name}'`,
      );
      ac.state = 'stopped';
      return;
    }

    // Validate frames array
    if (!animation.frames || animation.frames.length === 0) {
      console.warn(
        `[animation-controller] Animation '${ac.currentAnimation}' has no frames in '${ac.name}'`,
      );
      ac.state = 'stopped';
      return;
    }

    // Timing/state-machine logic below always runs, regardless of visibility
    // -- only the sprite-array write is gated on it. Resolved once per call
    // (cheap, cached after the first) rather than per frame-boundary crossing
    // in the loop below. See
    // .design/spike_scene-graph-traversal/04-presentation-layer-visibility-skip/02-animation-controller-onscreen-consumption.md
    // for why: freezing frameTime/currentFrameIndex/onComplete timing would
    // save nothing (the O(1) state math was never the cost problem) while
    // making animation state depend on visibility for every consumer.
    const transform = resolveControllerTransform(ac);
    const shouldWriteSprites = !transform || transform.onScreen !== false;

    if (shouldWriteSprites) {
      if (ac._spriteFramesStale) {
        // Just came back on-screen after the gate skipped one or more
        // writes -- catch up immediately with the CURRENT frame (from
        // before this tick's own advancement below) rather than waiting for
        // the next frame-boundary crossing, which could be up to one full
        // animation-frame's duration away and would show a stale frame in
        // the meantime.
        updateSpriteFrames(ac, animation.frames[ac.currentFrameIndex]);
        ac._spriteFramesStale = false;
      }
    } else {
      ac._spriteFramesStale = true;
    }

    // Accumulate frame time
    ac.frameTime += deltaTime * ac.speed;

    // Advance frames. The threshold is the duration of the frame currently
    // being shown (the one we're leaving), which may vary per frame. `guard`
    // backstops a pathological near-zero duration that could spin the loop.
    let guard = 0;
    while (ac.frameTime >= frameDurationFor(animation, ac.currentFrameIndex)) {
      ac.frameTime -= frameDurationFor(animation, ac.currentFrameIndex);
      ac.currentFrameIndex++;

      // Check if reached end of animation
      if (ac.currentFrameIndex >= animation.frames.length) {
        if (animation.loop) {
          // Loop back to start
          ac.currentFrameIndex = 0;
        } else {
          // Stop animation
          ac.currentFrameIndex = animation.frames.length - 1;
          ac.state = 'stopped';
          ac.frameTime = 0;

          // Call onComplete callback if defined
          if (animation.onComplete) {
            const callback =
              MethodRegistry['animation-controller'][animation.onComplete];
            if (callback && typeof callback === 'function') {
              callback(ac);
            } else {
              console.warn(
                `[animation-controller] Callback '${animation.onComplete}' not found for animation '${ac.currentAnimation}'`,
              );
            }
          }

          // Update sprites to final frame before exiting
          if (shouldWriteSprites) {
            updateSpriteFrames(ac, animation.frames[ac.currentFrameIndex]);
          }
          return;
        }
      }

      // Update sprite frame
      const frameNumber = animation.frames[ac.currentFrameIndex];
      if (shouldWriteSprites) {
        updateSpriteFrames(ac, frameNumber);
      }

      if (++guard > 1024) {
        ac.frameTime = 0;
        break;
      }
    }
  },

  /**
   * Adds an animation to the controller.
   */
  addAnimation(controller: AnimationControllerT, animation: Animation) {
    if (!animation.frames || animation.frames.length === 0) {
      console.error(
        `[animation-controller] Cannot add animation '${animation.name}' - frames array is empty`,
      );
      return;
    }

    // Apply defaults
    const anim: Animation = {
      name: animation.name,
      frames: animation.frames,
      frameRate: animation.frameRate ?? 12,
      frameDurations: animation.frameDurations,
      loop: animation.loop ?? true,
      onComplete: animation.onComplete,
    };

    detachAnimationsForWrite(controller);
    controller.animations.set(anim.name, anim);
  },

  /**
   * Removes an animation from the controller.
   */
  removeAnimation(controller: AnimationControllerT, name: string) {
    detachAnimationsForWrite(controller);
    controller.animations.delete(name);

    // Stop if removing current animation
    if (controller.currentAnimation === name) {
      AnimationController.stop(controller);
    }
  },

  /**
   * Checks if an animation exists.
   */
  hasAnimation(controller: AnimationControllerT, name: string): boolean {
    return controller.animations.has(name);
  },

  /**
   * Gets an animation by name.
   */
  getAnimation(
    controller: AnimationControllerT,
    name: string,
  ): Animation | null {
    return controller.animations.get(name) ?? null;
  },

  /**
   * Plays an animation.
   */
  play(controller: AnimationControllerT, name: string, restart = false) {
    if (!controller.animations.has(name)) {
      console.error(
        `[animation-controller] Cannot play animation '${name}' - not found in '${controller.name}'`,
      );
      return;
    }

    const isDifferentAnimation = controller.currentAnimation !== name;

    // Reset if restart requested or switching animations
    if (restart || isDifferentAnimation) {
      controller.currentFrameIndex = 0;
      controller.frameTime = 0;

      // Update sprites to first frame immediately -- unconditional (not
      // gated by on-screen), since this is a rare user-triggered call, not
      // the per-frame hot path the gate exists for.
      const animation = controller.animations.get(name);
      if (animation && animation.frames.length > 0) {
        updateSpriteFrames(controller, animation.frames[0]);
        controller._spriteFramesStale = false;
      }
    }

    controller.currentAnimation = name;
    controller.state = 'playing';
  },

  /**
   * Pauses the current animation.
   */
  pause(controller: AnimationControllerT) {
    if (controller.state === 'playing') {
      controller.state = 'paused';
    }
  },

  /**
   * Resumes a paused animation.
   */
  resume(controller: AnimationControllerT) {
    if (controller.state === 'paused') {
      controller.state = 'playing';
    }
  },

  /**
   * Stops the current animation.
   */
  stop(controller: AnimationControllerT) {
    controller.state = 'stopped';
    controller.currentFrameIndex = 0;
    controller.frameTime = 0;

    // Set sprites to first frame of current animation -- unconditional (not
    // gated by on-screen), same reasoning as play().
    if (controller.currentAnimation) {
      const animation = controller.animations.get(controller.currentAnimation);
      if (animation && animation.frames.length > 0) {
        updateSpriteFrames(controller, animation.frames[0]);
        controller._spriteFramesStale = false;
      }
    }
  },

  /**
   * Gets the current playback state.
   */
  getState(controller: AnimationControllerT): AnimationState {
    return controller.state;
  },

  /**
   * Checks if an animation is currently playing.
   */
  isPlaying(controller: AnimationControllerT): boolean {
    return controller.state === 'playing';
  },

  /**
   * Gets the current animation name.
   */
  getCurrentAnimation(controller: AnimationControllerT): string | null {
    return controller.currentAnimation;
  },

  /**
   * Gets the current frame index within the animation's frames array.
   */
  getCurrentFrame(controller: AnimationControllerT): number {
    return controller.currentFrameIndex;
  },

  /**
   * Sets the playback speed multiplier.
   */
  setSpeed(controller: AnimationControllerT, speed: number) {
    controller.speed = Math.max(0, speed); // Prevent negative speed
  },

  /**
   * Gets the current playback speed.
   */
  getSpeed(controller: AnimationControllerT): number {
    return controller.speed;
  },

  /**
   * Sets which sprite channels to animate.
   */
  setChannels(controller: AnimationControllerT, channels: ChannelType[]) {
    controller.channels = channels;
  },

  /**
   * Gets the current channels array.
   */
  getChannels(controller: AnimationControllerT): ChannelType[] {
    return controller.channels;
  },

  /**
   * Toggles a layer's visibility, mirroring it onto the bound sibling sprite.
   * If the layer has a `slot`, showing it hides the other layers in that slot
   * (mutually-exclusive swap, e.g. hair A/B/C).
   */
  setLayerVisible(
    controller: AnimationControllerT,
    layerName: string,
    visible: boolean,
  ) {
    const layer = controller.layers.find((l) => l.name === layerName);
    if (!layer) {
      console.warn(
        `[animation-controller] setLayerVisible: no layer '${layerName}' in '${controller.name}'`,
      );
      return;
    }

    // Mutually-exclusive slot: hide other layers sharing the slot.
    if (visible && layer.slot) {
      for (const other of controller.layers) {
        if (other.slot === layer.slot && other.name !== layerName) {
          other.visible = false;
        }
      }
    }
    layer.visible = visible;

    // Sync all layers' visibility onto their sprites (so a slot-hide applies),
    // using the resolved-sprite cache (parallel to `layers`). A layer that's
    // just become visible gets its sprite stamped with the controller's
    // current frame immediately -- while hidden, updateSpriteFrames (above)
    // skips writing to it, so its frame index can be stale by however many
    // frames elapsed since it was hidden; waiting for the next natural
    // updateSpriteFrames call would show that stale frame for up to one tick.
    const currentFrameNumber = currentFrameNumberFor(controller);
    const layerSprites = layerSpritesFor(controller);
    for (let i = 0; i < controller.layers.length; i++) {
      const sprite = layerSprites[i];
      if (!sprite) continue;
      const wasVisible = sprite.visible !== false;
      const nowVisible = controller.layers[i].visible;
      sprite.visible = nowVisible;
      if (!wasVisible && nowVisible && currentFrameNumber !== undefined) {
        sprite.setFrame(currentFrameNumber, controller.channels);
      }
    }
  },

  /**
   * Adds (or replaces, by name) a layer binding.
   */
  addLayer(controller: AnimationControllerT, layer: AnimationLayer) {
    const existing = controller.layers.findIndex((l) => l.name === layer.name);
    if (existing !== -1) {
      controller.layers[existing] = layer;
    } else {
      controller.layers.push(layer);
    }
    // Invalidate the resolved-sprite cache; rebuilt on next use.
    controller._layerSprites = undefined;
  },

  /**
   * Gets a layer by name, or null if not found.
   */
  getLayer(
    controller: AnimationControllerT,
    layerName: string,
  ): AnimationLayer | null {
    return controller.layers.find((l) => l.name === layerName) ?? null;
  },

  /**
   * Gets all layer bindings.
   */
  getLayers(controller: AnimationControllerT): AnimationLayer[] {
    return controller.layers;
  },

  /**
   * Disposes the animation controller and cleans up resources.
   */
  dispose(c: ComponentData) {
    const ac = c as AnimationControllerT;
    ac.layers = [];
    ac._layerSprites = undefined;
    ac._transformRef = undefined;
    ac._spriteFramesStale = undefined;
    ac._disposed = true;
  },
};

/**
 * Returns the duration (ms) of the frame at `frameIndex` (position within the
 * animation's `frames` array): the per-frame override when present and > 0,
 * else the uniform 1000/frameRate fallback.
 */
function frameDurationFor(animation: Animation, frameIndex: number): number {
  const d = animation.frameDurations?.[frameIndex];
  return d !== undefined && d > 0 ? d : 1000 / animation.frameRate;
}

/**
 * Resolves the sprite bound to each layer ONCE and caches it on the controller
 * (parallel to `layers`; null where a layer's sprite isn't found). With no
 * configured layers, caches all sibling sprites (auto-bound single-sprite case).
 * Walking the nexus + searching by name happens here, not per frame.
 */
/**
 * Finds the `animation-map` with the given key, searching the whole scene tree
 * from the root (shared animation-maps live at the scene root, not the entity
 * nexus). Mirrors sprite's `findTextureMapByKey`.
 */
function findAnimationMapByKey(
  fromNexus: NexusT,
  key: string,
): AnimationMapT | null {
  // Walk up to the scene root so the search covers the whole tree.
  let root: NexusT = fromNexus;
  while (root.parent && root.parent.type === 'nexus') {
    root = castTo<NexusT>(root.parent);
  }
  const maps = root.getComponentsByType('animation-map', true) as
    | AnimationMapT[]
    | undefined;
  if (!maps) return null;
  for (const m of maps) {
    if (m.animationMapKey === key) return m;
  }
  return null;
}

/**
 * If this controller's `animations` are shared from an animation-map (frozen),
 * clone them into an owned, mutable Map and detach — so a per-entity edit never
 * mutates the shared set. No-op once the controller owns its Map.
 */
function detachAnimationsForWrite(controller: AnimationControllerT): void {
  if (!controller.animationMapRef) return;
  const owned = new Map<string, Animation>();
  for (const [name, anim] of controller.animations) {
    // Copy each (frozen) animation so the owned entries are mutable.
    owned.set(name, { ...anim, frames: anim.frames.slice() });
  }
  controller.animations = owned;
  controller.animationMapRef = undefined;
}

function resolveLayerSprites(
  controller: AnimationControllerT,
): (SpriteT | null)[] {
  if (!controller.parent) {
    controller._layerSprites = [];
    return controller._layerSprites;
  }
  // parent is stored raw; wrap it to reach the nexus's proxy methods.
  const parent = castTo<NexusT>(controller.parent);
  const sprites = parent.getComponentsByType('sprite') as SpriteT[];

  const resolved: (SpriteT | null)[] =
    controller.layers.length === 0
      ? sprites
      : controller.layers.map(
          (layer) => sprites.find((s) => s.name === layer.spriteName) ?? null,
        );

  controller._layerSprites = resolved;
  return resolved;
}

/** Returns the cached layer sprites, building the cache on first use. */
function layerSpritesFor(controller: AnimationControllerT): (SpriteT | null)[] {
  return controller._layerSprites ?? resolveLayerSprites(controller);
}

/**
 * Resolves the sibling transform consulted for the on-screen write-gate,
 * caching the result on first use (`_transformRef`) -- never re-resolved
 * afterward, since reparenting isn't a real, exercised operation in this
 * engine (04a-component-lookup-registries.md's confirmed finding). `null`
 * (no parent, or no sibling transform found) is cached just as much as a
 * found transform, so a controller with no transform doesn't pay the lookup
 * cost every frame either.
 */
function resolveControllerTransform(
  controller: AnimationControllerT,
): TransformT | null {
  if (controller._transformRef !== undefined) return controller._transformRef;
  if (!controller.parent) {
    controller._transformRef = null;
    return null;
  }
  // parent is stored raw; wrap it to reach the nexus's proxy methods.
  const parent = castTo<NexusT>(controller.parent);
  const transform =
    (parent.getComponentByType('transform', false) as TransformT | null) ??
    null;
  controller._transformRef = transform;
  return transform;
}

/**
 * The frame number the controller is currently showing, or `undefined` if
 * there's no current animation (or it's since been removed).
 */
function currentFrameNumberFor(
  controller: AnimationControllerT,
): number | undefined {
  if (!controller.currentAnimation) return undefined;
  const animation = controller.animations.get(controller.currentAnimation);
  return animation?.frames[controller.currentFrameIndex];
}

/**
 * Sets the given frame on EVERY layer sprite driven by this controller, in
 * lockstep, using the resolved-sprite cache (no per-tick nexus walk or name
 * search). All layers share one frame timeline, so a single frame index applies
 * to every layer's texture-map.
 */
function updateSpriteFrames(
  controller: AnimationControllerT,
  frameNumber: number,
): void {
  const sprites = layerSpritesFor(controller);
  for (const sprite of sprites) {
    // `=== false` (not a truthy check) so a legacy sprite lacking the field
    // still gets written, matching the fail-open idiom used elsewhere for
    // this field (e.g. render-sprites.ts's own `sprite.visible === false`
    // skip).
    if (sprite && !sprite._disposed && sprite.visible !== false) {
      sprite.setFrame(frameNumber, controller.channels);
    }
  }
}
