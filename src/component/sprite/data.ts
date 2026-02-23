import {
  ComponentData,
  ComponentOptions,
  ComponentSerializer,
  ComponentUnique,
  ComponentInstanceMethods,
} from '../types';
import { Vector2D, Vector4D } from '../../math';
import type { SpriteMethods } from './methods';

/**
 * Sprite component for multi-channel texture rendering.
 * Stores references to texture maps and visual appearance properties.
 */
export interface SpriteT
  extends ComponentData, ComponentInstanceMethods<SpriteMethods> {
  type: 'sprite';
  unique: ComponentUnique.FALSE;

  /**
   * Texture map keys for different rendering channels.
   * Each channel references a TextureMap component by its textureMapKey.
   */
  textureMapKeys: {
    albedo: string; // Base color texture
    normal: string; // Normal map for lighting
    material: string; // Material properties (roughness, metallic, etc.)
    emission: string; // Emissive/glow map
  };

  /**
   * Current frame index for each channel.
   * Allows independent frame selection per channel.
   */
  frame: {
    albedo: number;
    normal: number;
    emission: number;
    material: number;
  };

  /**
   * Anchor point in pixels (offset from top-left of sprite).
   * Used for positioning and rotation pivot.
   */
  anchor: Vector2D;

  /**
   * Color tint applied to the sprite (RGBA, 0-1 range).
   * Multiplied with texture color during rendering.
   */
  tint: Vector4D;

  /**
   * Opacity/alpha transparency (0-1 range).
   * 0 = fully transparent, 1 = fully opaque.
   */
  opacity: number;

  /**
   * When true, renders a flat-color silhouette when the sprite is
   * occluded by cell geometry instead of discarding the fragment.
   */
  showSilhouette: boolean;

  /**
   * Color of the silhouette (RGBA, 0-1 range).
   * Only used when showSilhouette is true.
   */
  silhouetteColor: Vector4D;
}

export interface SpriteOptions extends ComponentOptions {
  textureMapKeys?: {
    albedo?: string;
    normal?: string;
    material?: string;
    emission?: string;
  };
  frame?: {
    albedo?: number;
    normal?: number;
    emission?: number;
    material?: number;
  };
  anchor?: Vector2D;
  tint?: Vector4D;
  opacity?: number;
  showSilhouette?: boolean;
  silhouetteColor?: Vector4D;
}

/**
 * Builder function for creating Sprite components.
 */
export function builder(options: SpriteOptions): SpriteT {
  const sprite = {
    type: 'sprite' as const,
    name: options.name,
    unique: ComponentUnique.FALSE,
    parent: null,
    _disposed: false,

    textureMapKeys: {
      albedo: options.textureMapKeys?.albedo ?? '',
      normal: options.textureMapKeys?.normal ?? '',
      material: options.textureMapKeys?.material ?? '',
      emission: options.textureMapKeys?.emission ?? '',
    },

    frame: {
      albedo: options.frame?.albedo ?? 0,
      normal: options.frame?.normal ?? 0,
      emission: options.frame?.emission ?? 0,
      material: options.frame?.material ?? 0,
    },

    anchor: options.anchor ?? new Vector2D(0, 0),
    tint: options.tint ?? new Vector4D(1, 1, 1, 1),
    opacity: options.opacity ?? 1.0,
    showSilhouette: options.showSilhouette ?? false,
    silhouetteColor: options.silhouetteColor ?? new Vector4D(0.2, 0.4, 0.8, 0.5),
  };

  return sprite as unknown as SpriteT;
}

/**
 * Serializes a sprite component to a plain object.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serialize(component: ComponentData): any {
  const s = component as SpriteT;

  return {
    type: 'sprite',
    name: s.name,
    unique: ComponentUnique.FALSE,
    textureMapKeys: {
      albedo: s.textureMapKeys.albedo,
      normal: s.textureMapKeys.normal,
      material: s.textureMapKeys.material,
      emission: s.textureMapKeys.emission,
    },
    frame: {
      albedo: s.frame.albedo,
      normal: s.frame.normal,
      emission: s.frame.emission,
      material: s.frame.material,
    },
    anchor: {
      _vectorType: 'Vector2D',
      x: s.anchor.x,
      y: s.anchor.y,
    },
    tint: {
      _vectorType: 'Vector4D',
      x: s.tint.x,
      y: s.tint.y,
      z: s.tint.z,
      w: s.tint.w,
    },
    opacity: s.opacity,
    showSilhouette: s.showSilhouette,
    silhouetteColor: {
      _vectorType: 'Vector4D',
      x: s.silhouetteColor.x,
      y: s.silhouetteColor.y,
      z: s.silhouetteColor.z,
      w: s.silhouetteColor.w,
    },
  };
}

/**
 * Deserializes a plain object back into a sprite component.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deserialize(data: any): SpriteT {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const { type, name, textureMapKeys, frame, anchor, tint, opacity, showSilhouette, silhouetteColor } = data;

  const errors = [];
  if (type !== 'sprite') {
    errors.push(`type ${type} does not match "sprite"`);
  }
  if (!name) {
    errors.push('sprite requires a name');
  }
  if (errors.length) {
    throw new Error(errors.join('\n'));
  }

  // Reconstruct Vector2D anchor
  let anchorVec = new Vector2D(0, 0);
  if (anchor && typeof anchor === 'object') {
    if ('_vectorType' in anchor && anchor._vectorType === 'Vector2D') {
      anchorVec = new Vector2D(anchor.x, anchor.y);
    }
  }

  // Reconstruct Vector4D tint
  let tintVec = new Vector4D(1, 1, 1, 1);
  if (tint && typeof tint === 'object') {
    if ('_vectorType' in tint && tint._vectorType === 'Vector4D') {
      tintVec = new Vector4D(tint.x, tint.y, tint.z, tint.w);
    }
  }

  // Reconstruct Vector4D silhouetteColor
  let silhouetteColorVec: Vector4D | undefined;
  if (silhouetteColor && typeof silhouetteColor === 'object') {
    if ('_vectorType' in silhouetteColor && silhouetteColor._vectorType === 'Vector4D') {
      silhouetteColorVec = new Vector4D(silhouetteColor.x, silhouetteColor.y, silhouetteColor.z, silhouetteColor.w);
    }
  }

  return builder({
    name: name as string,
    textureMapKeys: textureMapKeys as SpriteOptions['textureMapKeys'],
    frame: frame as SpriteOptions['frame'],
    anchor: anchorVec,
    tint: tintVec,
    opacity: opacity as number,
    showSilhouette: showSilhouette as boolean | undefined,
    silhouetteColor: silhouetteColorVec,
  });
}

export const SpriteSerializer: ComponentSerializer = {
  serialize,
  deserialize,
};

/**
 * Allowlist of sprite-specific properties accessible via component Proxy.
 */
export const PROPERTY_ALLOWLIST: string[] = [
  'textureMapKeys',
  'frame',
  'anchor',
  'tint',
  'opacity',
  'showSilhouette',
  'silhouetteColor',
];
