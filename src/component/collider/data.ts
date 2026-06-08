import {
  ComponentData,
  ComponentOptions,
  ComponentSerializer,
  ComponentUnique,
  ComponentInstanceMethods,
  DeserializationError,
  DeserializeResult,
} from '../types';
import { Vector3D } from '../../math';
import type { ColliderMethods } from './methods';

/**
 * Collider component for collision detection.
 * Supports box (AABB/OBB) and sphere shapes.
 *
 * - size: half-extents for box shape (world units, before transform scale)
 * - radius: radius for sphere shape (world units, before transform scale)
 * - offset: local offset from transform origin
 */
export interface ColliderT
  extends ComponentData, ComponentInstanceMethods<ColliderMethods> {
  type: 'collider';
  unique: ComponentUnique.FALSE;
  shape: 'box' | 'sphere';
  size: Vector3D;
  radius: number;
  offset: Vector3D;
}

export interface ColliderOptions extends ComponentOptions {
  shape?: 'box' | 'sphere';
  size?: Vector3D;
  radius?: number;
  offset?: Vector3D;
}

/**
 * Builder function for creating Collider components.
 */
export function builder(options: ColliderOptions): ColliderT {
  const collider = {
    type: 'collider' as const,
    name: options.name,
    unique: ComponentUnique.FALSE,
    parent: null,
    _disposed: false,

    shape: options.shape ?? 'box',
    size: options.size ?? new Vector3D(0.5, 0.5, 0.5),
    radius: options.radius ?? 0.5,
    offset: options.offset ?? new Vector3D(0, 0, 0),
  };

  return collider as unknown as ColliderT;
}

/**
 * Serializes a collider component to a plain object.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serialize(component: ComponentData): any {
  const c = component as ColliderT;

  return {
    type: 'collider',
    name: c.name,
    unique: ComponentUnique.FALSE,
    shape: c.shape,
    size: {
      _vectorType: 'Vector3D',
      x: c.size.x,
      y: c.size.y,
      z: c.size.z,
    },
    radius: c.radius,
    offset: {
      _vectorType: 'Vector3D',
      x: c.offset.x,
      y: c.offset.y,
      z: c.offset.z,
    },
  };
}

/**
 * Deserializes a plain object back into a collider component.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deserialize(data: any): DeserializeResult<ColliderT> {
  const errors: DeserializationError[] = [];

  if (!data || typeof data !== 'object') {
    return {
      component: null,
      errors: [
        {
          code: 'INVALID_DATA',
          message: 'collider deserialize received non-object data',
        },
      ],
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const { type, name, shape, size, radius, offset } = data;

  if (type !== 'collider') {
    errors.push({
      code: 'TYPE_MISMATCH',
      message: `type ${type} does not match "collider"`,
    });
  }
  if (!name) {
    errors.push({
      code: 'MISSING_NAME',
      message: 'collider requires a name',
    });
  }
  if (errors.length > 0) {
    return { component: null, errors };
  }

  const componentName = name as string;

  let sizeVec = new Vector3D(0.5, 0.5, 0.5);
  if (size !== undefined) {
    if (!size || typeof size !== 'object') {
      errors.push({
        code: 'INVALID_VECTOR',
        message: `collider "${componentName}" size is not an object; defaulting`,
      });
    } else if (!('_vectorType' in size) || size._vectorType !== 'Vector3D') {
      errors.push({
        code: 'INVALID_VECTOR',
        message: `collider "${componentName}" size missing _vectorType='Vector3D' marker; defaulting`,
      });
    } else {
      sizeVec = new Vector3D(size.x, size.y, size.z);
    }
  }

  let offsetVec = new Vector3D(0, 0, 0);
  if (offset !== undefined) {
    if (!offset || typeof offset !== 'object') {
      errors.push({
        code: 'INVALID_VECTOR',
        message: `collider "${componentName}" offset is not an object; defaulting`,
      });
    } else if (
      !('_vectorType' in offset) ||
      offset._vectorType !== 'Vector3D'
    ) {
      errors.push({
        code: 'INVALID_VECTOR',
        message: `collider "${componentName}" offset missing _vectorType='Vector3D' marker; defaulting`,
      });
    } else {
      offsetVec = new Vector3D(offset.x, offset.y, offset.z);
    }
  }

  return {
    component: builder({
      name: componentName,
      shape: shape as 'box' | 'sphere',
      size: sizeVec,
      radius: typeof radius === 'number' ? radius : 0.5,
      offset: offsetVec,
    }),
    errors,
  };
}

export const ColliderSerializer: ComponentSerializer = {
  serialize,
  deserialize,
};

/**
 * Allowlist of collider-specific properties accessible via component Proxy.
 */
export const PROPERTY_ALLOWLIST: string[] = [
  'shape',
  'size',
  'radius',
  'offset',
];
