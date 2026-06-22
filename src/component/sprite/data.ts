import {
  ComponentData,
  ComponentOptions,
  ComponentSerializer,
  ComponentUnique,
  ComponentInstanceMethods,
  DeserializationError,
  DeserializeResult,
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
  // FALSE (not LOCAL): a single nexus may hold multiple sprites — e.g. the
  // stacked layers (body/outline/hair/armor/weapon) of one composited entity,
  // all sharing the nexus's single transform/position.
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

  /**
   * Whether the sprite is rendered. When false, the renderer skips it entirely
   * (no draw call) — distinct from opacity 0, which still submits a transparent
   * quad. Used to toggle composited layers on/off at runtime.
   */
  visible: boolean;

  /**
   * Draw order among sprites that share the same parent nexus (a composited
   * entity's layers). Lower draws first (underneath); higher draws on top.
   * Sprites in different nexuses are unaffected (see collect-renderables'
   * segmented sort). Default 0.
   */
  renderOrder: number;
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
  visible?: boolean;
  renderOrder?: number;
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
    silhouetteColor:
      options.silhouetteColor ?? new Vector4D(0.2, 0.4, 0.8, 0.5),
    visible: options.visible ?? true,
    renderOrder: options.renderOrder ?? 0,
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
    visible: s.visible,
    renderOrder: s.renderOrder,
  };
}

/**
 * Deserializes a plain object back into a sprite component.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deserialize(data: any): DeserializeResult<SpriteT> {
  const errors: DeserializationError[] = [];

  if (!data || typeof data !== 'object') {
    return {
      component: null,
      errors: [
        {
          code: 'INVALID_DATA',
          message: 'sprite deserialize received non-object data',
        },
      ],
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const {
    type,
    name,
    textureMapKeys,
    frame,
    anchor,
    tint,
    opacity,
    showSilhouette,
    silhouetteColor,
    visible,
    renderOrder,
  } = data;

  if (type !== 'sprite') {
    errors.push({
      code: 'TYPE_MISMATCH',
      message: `type ${type} does not match "sprite"`,
    });
  }
  if (!name) {
    errors.push({
      code: 'MISSING_NAME',
      message: 'sprite requires a name',
    });
  }
  if (errors.length > 0) {
    return { component: null, errors };
  }

  const componentName = name as string;

  let anchorVec = new Vector2D(0, 0);
  if (anchor !== undefined) {
    if (!anchor || typeof anchor !== 'object') {
      errors.push({
        code: 'INVALID_VECTOR',
        message: `sprite "${componentName}" anchor is not an object; defaulting to (0, 0)`,
      });
    } else if (
      !('_vectorType' in anchor) ||
      anchor._vectorType !== 'Vector2D'
    ) {
      errors.push({
        code: 'INVALID_VECTOR',
        message: `sprite "${componentName}" anchor missing _vectorType='Vector2D' marker; defaulting`,
      });
    } else {
      anchorVec = new Vector2D(anchor.x, anchor.y);
    }
  }

  let tintVec = new Vector4D(1, 1, 1, 1);
  if (tint !== undefined) {
    if (!tint || typeof tint !== 'object') {
      errors.push({
        code: 'INVALID_VECTOR',
        message: `sprite "${componentName}" tint is not an object; defaulting to (1, 1, 1, 1)`,
      });
    } else if (!('_vectorType' in tint) || tint._vectorType !== 'Vector4D') {
      errors.push({
        code: 'INVALID_VECTOR',
        message: `sprite "${componentName}" tint missing _vectorType='Vector4D' marker; defaulting`,
      });
    } else {
      tintVec = new Vector4D(tint.x, tint.y, tint.z, tint.w);
    }
  }

  let silhouetteColorVec: Vector4D | undefined;
  if (silhouetteColor !== undefined) {
    if (!silhouetteColor || typeof silhouetteColor !== 'object') {
      errors.push({
        code: 'INVALID_VECTOR',
        message: `sprite "${componentName}" silhouetteColor is not an object; defaulting`,
      });
    } else if (
      !('_vectorType' in silhouetteColor) ||
      silhouetteColor._vectorType !== 'Vector4D'
    ) {
      errors.push({
        code: 'INVALID_VECTOR',
        message: `sprite "${componentName}" silhouetteColor missing _vectorType='Vector4D' marker; defaulting`,
      });
    } else {
      silhouetteColorVec = new Vector4D(
        silhouetteColor.x,
        silhouetteColor.y,
        silhouetteColor.z,
        silhouetteColor.w,
      );
    }
  }

  return {
    component: builder({
      name: componentName,
      textureMapKeys: textureMapKeys as SpriteOptions['textureMapKeys'],
      frame: frame as SpriteOptions['frame'],
      anchor: anchorVec,
      tint: tintVec,
      opacity: opacity as number,
      showSilhouette: showSilhouette as boolean | undefined,
      silhouetteColor: silhouetteColorVec,
      visible: visible as boolean | undefined,
      renderOrder: renderOrder as number | undefined,
    }),
    errors,
  };
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
  'visible',
  'renderOrder',
];
