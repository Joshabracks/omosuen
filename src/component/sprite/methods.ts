import { ComponentData, ComponentMethods } from '../types';
import { SpriteT } from './data';
import { getActiveScene } from '../../scene';
import type { NexusT } from '../nexus/data';
import type { TextureMapT } from '../texture-map/data';

export type ChannelType = 'albedo' | 'normal' | 'material' | 'emission';

export interface SpriteMethods extends ComponentMethods {
  init: (component: ComponentData) => Promise<void>;
  setFrame: (
    sprite: SpriteT,
    index: number,
    channels?: ChannelType | ChannelType[],
  ) => void;
  setTint: (
    sprite: SpriteT,
    r: number,
    g: number,
    b: number,
    a: number,
  ) => void;
  setOpacity: (sprite: SpriteT, alpha: number) => void;
}

export const Sprite: SpriteMethods = {
  type: 'sprite',

  /**
   * Initializes the sprite component.
   * Validates that referenced texture maps exist in the scene.
   */
  async init(component: ComponentData): Promise<void> {
    const s = component as SpriteT;
    const scene = getActiveScene();

    if (!scene) {
      console.warn(`[sprite] Cannot initialize '${s.name}' - no active scene`);
      return;
    }

    // Validate texture map references
    const channels: ChannelType[] = [
      'albedo',
      'normal',
      'material',
      'emission',
    ];
    for (const channel of channels) {
      const key = s.textureMapKeys[channel];
      if (key) {
        // Try to find the texture map in the scene
        const textureMap = findTextureMapByKey(scene, key);
        if (!textureMap) {
          console.warn(
            `[sprite] Texture map '${key}' not found for ${channel} channel in sprite '${s.name}'`,
          );
        }
      }
    }
  },

  /**
   * Sets the frame index for one or more channels.
   *
   * @param sprite - The sprite component
   * @param index - Frame index to set
   * @param channels - Channel(s) to update. If undefined, updates all channels.
   *
   * @example
   * // Set all channels to frame 5
   * sprite.setFrame(5);
   *
   * // Set only albedo channel
   * sprite.setFrame(3, 'albedo');
   *
   * // Set albedo and emission channels
   * sprite.setFrame(7, ['albedo', 'emission']);
   */
  setFrame(
    sprite: SpriteT,
    index: number,
    channels?: ChannelType | ChannelType[],
  ) {
    // If no channels specified, update all channels
    if (channels === undefined) {
      sprite.frame.albedo = index;
      sprite.frame.normal = index;
      sprite.frame.material = index;
      sprite.frame.emission = index;
      return;
    }

    // If single channel specified
    if (typeof channels === 'string') {
      sprite.frame[channels] = index;
      return;
    }

    // If array of channels specified
    for (const channel of channels) {
      sprite.frame[channel] = index;
    }
  },

  /**
   * Sets the color tint for the sprite.
   *
   * @param sprite - The sprite component
   * @param r - Red component (0-1)
   * @param g - Green component (0-1)
   * @param b - Blue component (0-1)
   * @param a - Alpha component (0-1)
   */
  setTint(sprite: SpriteT, r: number, g: number, b: number, a: number) {
    sprite.tint.x = r;
    sprite.tint.y = g;
    sprite.tint.z = b;
    sprite.tint.w = a;
  },

  /**
   * Sets the opacity/alpha transparency of the sprite.
   *
   * @param sprite - The sprite component
   * @param alpha - Opacity value (0-1, where 0 is transparent and 1 is opaque)
   */
  setOpacity(sprite: SpriteT, alpha: number) {
    sprite.opacity = Math.max(0, Math.min(1, alpha)); // Clamp to 0-1
  },

  /**
   * Disposes the sprite component and cleans up resources.
   */
  dispose(c: ComponentData) {
    const s = c as SpriteT;
    s._disposed = true;
  },
};

/**
 * Helper function to find a TextureMap by its textureMapKey in the scene.
 */
function findTextureMapByKey(
  scene: NexusT,
  textureMapKey: string,
): TextureMapT | null {
  // Get all texture maps in the scene
  const textureMaps = scene.getComponentsByType('texture-map') as
    | TextureMapT[]
    | undefined;

  if (!textureMaps) {
    return null;
  }

  // Find the one with matching textureMapKey
  for (const tm of textureMaps) {
    if (tm.textureMapKey === textureMapKey) {
      return tm;
    }
  }

  return null;
}
