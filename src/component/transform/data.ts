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

  /**
   * Cached WORLD-space transform, composed from the ancestry chain
   * (worldPos = parentWorldPos + localPos*parentWorldScale, etc.). Derived — not
   * serialized. Refreshed once per frame by `updateWorldTransforms` (loop), before
   * render. Read these (not `position`/`rotation`/`scale`) when you need the
   * inherited world transform; they equal the local values when there is no
   * ancestor transform.
   */
  worldPosition: Vector3D;
  worldRotation: Vector3D;
  worldScale: Vector3D;
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

    // World cache — seeded from local; overwritten by updateWorldTransforms each frame.
    worldPosition: new Vector3D(0, 0, 0),
    worldRotation: new Vector3D(0, 0, 0),
    worldScale: new Vector3D(1, 1, 1),
  };
  transform.worldPosition.x = transform.position.x;
  transform.worldPosition.y = transform.position.y;
  transform.worldPosition.z = transform.position.z;
  transform.worldRotation.x = transform.rotation.x;
  transform.worldRotation.y = transform.rotation.y;
  transform.worldRotation.z = transform.rotation.z;
  transform.worldScale.x = transform.scale.x;
  transform.worldScale.y = transform.scale.y;
  transform.worldScale.z = transform.scale.z;

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
function deserialize(data: any): DeserializeResult<TransformT> {
  const errors: DeserializationError[] = [];

  if (!data || typeof data !== 'object') {
    return {
      component: null,
      errors: [
        {
          code: 'INVALID_DATA',
          message: 'transform deserialize received non-object data',
        },
      ],
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const { type, name, position, rotation, scale } = data;

  if (type !== 'transform') {
    errors.push({
      code: 'TYPE_MISMATCH',
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      message: `type ${type} does not match "transform"`,
    });
  }
  if (!name) {
    errors.push({
      code: 'MISSING_NAME',
      message: 'transform requires a name',
    });
  }
  if (errors.length > 0) {
    return { component: null, errors };
  }

  const componentName = name as string;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parseVec3 = (
    raw: unknown,
    field: string,
    fallback: Vector3D,
  ): Vector3D => {
    if (raw === undefined) {
      errors.push({
        code: 'MISSING_VECTOR',
        message: `transform "${componentName}" ${field} missing; defaulting to (${fallback.x}, ${fallback.y}, ${fallback.z})`,
      });
      return fallback;
    }
    if (!raw || typeof raw !== 'object') {
      errors.push({
        code: 'INVALID_VECTOR',
        message: `transform "${componentName}" ${field} is not an object; defaulting`,
      });
      return fallback;
    }
    const v = raw as {
      _vectorType?: unknown;
      x?: unknown;
      y?: unknown;
      z?: unknown;
    };
    if (v._vectorType !== 'Vector3D') {
      errors.push({
        code: 'INVALID_VECTOR',
        message: `transform "${componentName}" ${field} missing _vectorType='Vector3D' marker; defaulting`,
      });
      return fallback;
    }
    return new Vector3D(v.x as number, v.y as number, v.z as number);
  };

  const positionVec = parseVec3(position, 'position', new Vector3D(0, 0, 0));
  const rotationVec = parseVec3(rotation, 'rotation', new Vector3D(0, 0, 0));
  const scaleVec = parseVec3(scale, 'scale', new Vector3D(1, 1, 1));

  return {
    component: builder({
      name: componentName,
      position: positionVec,
      rotation: rotationVec,
      scale: scaleVec,
    }),
    errors,
  };
}

export const TransformSerializer: ComponentSerializer = {
  serialize,
  deserialize,
};

/**
 * Allowlist of transform-specific properties accessible via component Proxy.
 */
export const PROPERTY_ALLOWLIST: string[] = [
  'position',
  'rotation',
  'scale',
  'worldPosition',
  'worldRotation',
  'worldScale',
];
