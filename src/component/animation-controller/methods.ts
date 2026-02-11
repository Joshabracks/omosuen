import { ComponentData, ComponentMethods } from '../types';
import { AnimationControllerT } from './data';
import type { Animation, AnimationState } from './types';
import type { ChannelType } from '../sprite/types';
import { getActiveScene } from '../../scene';
import type { NexusT } from '../nexus/data';
import type { SpriteT } from '../sprite/data';
import { MethodRegistry } from '../registry';

export interface AnimationControllerMethods extends ComponentMethods {
  init: (component: ComponentData) => Promise<void>;
  update: (component: ComponentData, deltaTime: number) => void;
  addAnimation: (controller: AnimationControllerT, animation: Animation) => void;
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
  setChannels: (controller: AnimationControllerT, channels: ChannelType[]) => void;
  getChannels: (controller: AnimationControllerT) => ChannelType[];
}

export const AnimationController: AnimationControllerMethods = {
  type: 'animation-controller',

  /**
   * Initializes the animation controller.
   * Validates that the target sprite exists.
   */
  async init(component: ComponentData): Promise<void> {
    const ac = component as AnimationControllerT;
    const scene = getActiveScene();

    if (!scene) {
      console.warn(
        `[animation-controller] Cannot initialize '${ac.name}' - no active scene`,
      );
      return;
    }

    // Validate sprite exists
    // @ts-expect-error - getComponentById exists but not in type def
    const sprite = scene.getComponentById(ac.spriteId, true) as SpriteT | null;
    if (!sprite) {
      console.warn(
        `[animation-controller] Sprite with ID ${ac.spriteId} not found for '${ac.name}'`,
      );
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

    // Calculate frame duration in milliseconds
    const frameDuration = 1000 / animation.frameRate;

    // Advance frames
    while (ac.frameTime >= frameDuration) {
      ac.frameTime -= frameDuration;
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
            const callback = MethodRegistry['animation-controller'][
              animation.onComplete
            ];
            if (callback && typeof callback === 'function') {
              callback(ac);
            } else {
              console.warn(
                `[animation-controller] Callback '${animation.onComplete}' not found for animation '${ac.currentAnimation}'`,
              );
            }
          }

          // Update sprite to final frame before exiting
          updateSpriteFrame(ac, animation.frames[ac.currentFrameIndex]);
          return;
        }
      }

      // Update sprite frame
      const frameNumber = animation.frames[ac.currentFrameIndex];
      updateSpriteFrame(ac, frameNumber);
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
  getAnimation(controller: AnimationControllerT, name: string): Animation | null {
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

      // Update sprite to first frame immediately
      const animation = controller.animations.get(name);
      if (animation && animation.frames.length > 0) {
        updateSpriteFrame(controller, animation.frames[0]);
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

    // Set sprite to first frame of current animation
    if (controller.currentAnimation) {
      const animation = controller.animations.get(controller.currentAnimation);
      if (animation && animation.frames.length > 0) {
        updateSpriteFrame(controller, animation.frames[0]);
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
   * Disposes the animation controller and cleans up resources.
   */
  dispose(c: ComponentData) {
    const ac = c as AnimationControllerT;
    ac._disposed = true;
  },
};

/**
 * Helper function to update the sprite's frame.
 */
function updateSpriteFrame(
  controller: AnimationControllerT,
  frameNumber: number,
): void {
  const scene = getActiveScene();
  if (!scene) {
    return;
  }

  // Get sprite by ID
  // @ts-expect-error - getComponentById exists but not in type def
  const sprite = scene.getComponentById(controller.spriteId, true) as
    | SpriteT
    | null;
  if (!sprite) {
    console.warn(
      `[animation-controller] Sprite with ID ${controller.spriteId} not found`,
    );
    return;
  }

  // Update sprite frame for specified channels
  // @ts-expect-error - setFrame method exists on sprite
  sprite.setFrame(frameNumber, controller.channels);
}
