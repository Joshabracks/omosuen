import {
  ComponentData,
  ComponentOptions,
  ComponentSerializer,
  ComponentUnique,
  ComponentInstanceMethods,
} from '../types';
import { Vector2D } from '../../math';
import type { TransformMethods } from './methods';

/**
 * Transform component for 2D/3D spatial transformations.
 * Stores position, rotation, and scale for rendering and physics.
 *
 * For 3D isometric rendering:
 * - position.x = world X coordinate
 * - position.y = world Z coordinate
 * - z = world Y coordinate (vertical/height)
 */
export interface TransformT
  extends ComponentData, ComponentInstanceMethods<TransformMethods> {
  type: 'transform';
  unique: ComponentUnique.FALSE;

  /**
   * Position in 2D world space (or XZ plane for 3D isometric).
   */
  position: Vector2D;

  /**
   * Z-coordinate for 3D isometric rendering (world Y / vertical height).
   * Defaults to 0 for purely 2D sprites.
   */
  z: number;

  /**
   * Rotation angle in radians.
   * Positive values rotate counter-clockwise.
   */
  rotation: number;

  /**
   * Scale factor for x and y axes.
   * (1, 1) is normal size, (2, 2) is double size, (0.5, 0.5) is half size.
   */
  scale: Vector2D;
}

export interface TransformOptions extends ComponentOptions {
  position?: Vector2D;
  z?: number;
  rotation?: number;
  scale?: Vector2D;
}

/**
 * Builder function for creating Transform components.
 */
export function builder(options: TransformOptions): TransformT {
  const transform = {
    type: 'transform' as const,
    name: options.name,
    unique: ComponentUnique.FALSE,
    parent: null,
    _disposed: false,

    position: options.position ?? new Vector2D(0, 0),
    z: options.z ?? 0,
    rotation: options.rotation ?? 0,
    scale: options.scale ?? new Vector2D(1, 1),
  };

  return transform as unknown as TransformT;
}

/**
 * Serializes a transform component to a plain object.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serialize(component: ComponentData): any {
  const t = component as TransformT;

  return {
    type: 'transform',
    name: t.name,
    unique: ComponentUnique.FALSE,
    position: {
      _vectorType: 'Vector2D',
      x: t.position.x,
      y: t.position.y,
    },
    z: t.z,
    rotation: t.rotation,
    scale: {
      _vectorType: 'Vector2D',
      x: t.scale.x,
      y: t.scale.y,
    },
  };
}

/**
 * Deserializes a plain object back into a transform component.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deserialize(data: any): TransformT {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const { type, name, position, z, rotation, scale } = data;

  const errors = [];
  if (type !== 'transform') {
    errors.push(`type ${type} does not match "transform"`);
  }
  if (!name) {
    errors.push('transform requires a name');
  }
  if (errors.length) {
    throw new Error(errors.join('\n'));
  }

  // Reconstruct Vector2D position
  let positionVec = new Vector2D(0, 0);
  if (position && typeof position === 'object') {
    if ('_vectorType' in position && position._vectorType === 'Vector2D') {
      positionVec = new Vector2D(position.x, position.y);
    }
  }

  // Reconstruct Vector2D scale
  let scaleVec = new Vector2D(1, 1);
  if (scale && typeof scale === 'object') {
    if ('_vectorType' in scale && scale._vectorType === 'Vector2D') {
      scaleVec = new Vector2D(scale.x, scale.y);
    }
  }

  return builder({
    name: name as string,
    position: positionVec,
    z: (z as number) ?? 0,
    rotation: rotation as number,
    scale: scaleVec,
  });
}

export const TransformSerializer: ComponentSerializer = {
  serialize,
  deserialize,
};

/**
 * Allowlist of transform-specific properties accessible via component Proxy.
 */
export const PROPERTY_ALLOWLIST: string[] = ['position', 'z', 'rotation', 'scale'];
