import {
  ComponentData,
  ComponentOptions,
  ComponentSerializer,
  ComponentUnique,
  ComponentInstanceMethods,
} from '../types';
import { Vector3D } from '../../math';
import type { TransformMethods } from './methods';

/**
 * Transform component for 3D spatial transformations.
 * Stores position, rotation, and scale for rendering and physics.
 *
 * Coordinate convention (matches shader world-space):
 * - x = width (horizontal)
 * - y = height (vertical)
 * - z = depth
 */
export interface TransformT
  extends ComponentData, ComponentInstanceMethods<TransformMethods> {
  type: 'transform';
  unique: ComponentUnique.FALSE;

  /**
   * Position in 3D world space.
   * x = width, y = height, z = depth
   */
  position: Vector3D;

  /**
   * Rotation as Euler angles in radians.
   * x = pitch, y = yaw, z = roll
   */
  rotation: Vector3D;

  /**
   * Scale factor for each axis.
   * (1, 1, 1) is normal size, (2, 2, 2) is double size.
   */
  scale: Vector3D;
}

export interface TransformOptions extends ComponentOptions {
  position?: Vector3D;
  rotation?: Vector3D;
  scale?: Vector3D;
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

    position: options.position ?? new Vector3D(0, 0, 0),
    rotation: options.rotation ?? new Vector3D(0, 0, 0),
    scale: options.scale ?? new Vector3D(1, 1, 1),
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
      _vectorType: 'Vector3D',
      x: t.position.x,
      y: t.position.y,
      z: t.position.z,
    },
    rotation: {
      _vectorType: 'Vector3D',
      x: t.rotation.x,
      y: t.rotation.y,
      z: t.rotation.z,
    },
    scale: {
      _vectorType: 'Vector3D',
      x: t.scale.x,
      y: t.scale.y,
      z: t.scale.z,
    },
  };
}

/**
 * Deserializes a plain object back into a transform component.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deserialize(data: any): TransformT {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const { type, name, position, rotation, scale } = data;

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

  // Reconstruct Vector3D position
  let positionVec = new Vector3D(0, 0, 0);
  if (position && typeof position === 'object') {
    if ('_vectorType' in position && position._vectorType === 'Vector3D') {
      positionVec = new Vector3D(position.x, position.y, position.z);
    }
  }

  // Reconstruct Vector3D rotation
  let rotationVec = new Vector3D(0, 0, 0);
  if (rotation && typeof rotation === 'object') {
    if ('_vectorType' in rotation && rotation._vectorType === 'Vector3D') {
      rotationVec = new Vector3D(rotation.x, rotation.y, rotation.z);
    }
  }

  // Reconstruct Vector3D scale
  let scaleVec = new Vector3D(1, 1, 1);
  if (scale && typeof scale === 'object') {
    if ('_vectorType' in scale && scale._vectorType === 'Vector3D') {
      scaleVec = new Vector3D(scale.x, scale.y, scale.z);
    }
  }

  return builder({
    name: name as string,
    position: positionVec,
    rotation: rotationVec,
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
export const PROPERTY_ALLOWLIST: string[] = ['position', 'rotation', 'scale'];
