import { ComponentData, ComponentMethods, castTo } from '../types';
import { AnimationControllerT } from './data';
import type { Animation, AnimationLayer, AnimationState } from './types';
import type { ChannelType } from '../sprite/types';
import type { NexusT } from '../nexus/data';
import type { SpriteT } from '../sprite/data';
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

    // Apply each layer's visibility intent onto its bound sprite.
    for (const layer of ac.layers) {
      const sprite = sprites.find((s) => s.name === layer.spriteName);
      if (sprite) sprite.visible = layer.visible;
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
          updateSpriteFrames(ac, animation.frames[ac.currentFrameIndex]);
          return;
        }
      }

      // Update sprite frame
      const frameNumber = animation.frames[ac.currentFrameIndex];
      updateSpriteFrames(ac, frameNumber);

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

    controller.animations.set(anim.name, anim);
  },

  /**
   * Removes an animation from the controller.
   */
  removeAnimation(controller: AnimationControllerT, name: string) {
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

      // Update sprites to first frame immediately
      const animation = controller.animations.get(name);
      if (animation && animation.frames.length > 0) {
        updateSpriteFrames(controller, animation.frames[0]);
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

    // Set sprites to first frame of current animation
    if (controller.currentAnimation) {
      const animation = controller.animations.get(controller.currentAnimation);
      if (animation && animation.frames.length > 0) {
        updateSpriteFrames(controller, animation.frames[0]);
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

    // Sync all layers' visibility onto their sprites (so a slot-hide applies).
    if (!controller.parent) return;
    const parent = castTo<NexusT>(controller.parent);
    const sprites = parent.getComponentsByType('sprite') as SpriteT[];
    for (const l of controller.layers) {
      const sprite = sprites.find((s) => s.name === l.spriteName);
      if (sprite) sprite.visible = l.visible;
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
 * Sets the given frame on EVERY layer sprite driven by this controller, in
 * lockstep. With no configured layers, drives all sibling sprites (covers the
 * auto-bound single-sprite case). All layers share one frame timeline, so a
 * single frame index applies to every layer's texture-map.
 */
function updateSpriteFrames(
  controller: AnimationControllerT,
  frameNumber: number,
): void {
  if (!controller.parent) {
    return;
  }
  // parent is stored raw; wrap it to reach the nexus's proxy methods.
  const parent = castTo<NexusT>(controller.parent);

  const sprites = parent.getComponentsByType('sprite') as SpriteT[];
  if (sprites.length === 0) {
    return;
  }

  if (controller.layers.length === 0) {
    for (const sprite of sprites) {
      sprite.setFrame(frameNumber, controller.channels);
    }
    return;
  }

  for (const layer of controller.layers) {
    const sprite = sprites.find((s) => s.name === layer.spriteName);
    if (sprite) sprite.setFrame(frameNumber, controller.channels);
  }
}
