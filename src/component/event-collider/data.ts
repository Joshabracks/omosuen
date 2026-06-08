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
import type { ColliderT } from '../collider/data';
import type { EventColliderMethods } from './methods';

/**
 * EventCollider component for trigger-volume collision detection.
 * Extends the Collider concept with enter/exit/while event callbacks
 * that fire when tracked colliders overlap with this volume.
 */
export interface EventColliderT
  extends ComponentData, ComponentInstanceMethods<EventColliderMethods> {
  type: 'event-collider';
  unique: ComponentUnique.FALSE;

  // Collision shape fields (same as ColliderT)
  shape: 'box' | 'sphere';
  size: Vector3D;
  radius: number;
  offset: Vector3D;

  // EventCollider-specific fields
  triggers: Record<number, boolean>;
  onEnter: ((collider: ColliderT) => void) | null;
  onExit: ((collider: ColliderT) => void) | null;
  while: ((collider: ColliderT, deltaTime: number) => void) | null;
}

export interface EventColliderOptions extends ComponentOptions {
  shape?: 'box' | 'sphere';
  size?: Vector3D;
  radius?: number;
  offset?: Vector3D;
}

/**
 * Builder function for creating EventCollider components.
 */
export function builder(options: EventColliderOptions): EventColliderT {
  const eventCollider = {
    type: 'event-collider' as const,
    name: options.name,
    unique: ComponentUnique.FALSE,
    parent: null,
    _disposed: false,

    shape: options.shape ?? 'box',
    size: options.size ?? new Vector3D(0.5, 0.5, 0.5),
    radius: options.radius ?? 0.5,
    offset: options.offset ?? new Vector3D(0, 0, 0),

    triggers: {} as Record<number, boolean>,
    onEnter: null,
    onExit: null,
    while: null,
  };

  return eventCollider as unknown as EventColliderT;
}

/**
 * Serializes an event-collider component to a plain object.
 * Callbacks and triggers are omitted (runtime-only state).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serialize(component: ComponentData): any {
  const ec = component as EventColliderT;

  return {
    type: 'event-collider',
    name: ec.name,
    unique: ComponentUnique.FALSE,
    shape: ec.shape,
    size: {
      _vectorType: 'Vector3D',
      x: ec.size.x,
      y: ec.size.y,
      z: ec.size.z,
    },
    radius: ec.radius,
    offset: {
      _vectorType: 'Vector3D',
      x: ec.offset.x,
      y: ec.offset.y,
      z: ec.offset.z,
    },
  };
}

/**
 * Deserializes a plain object back into an event-collider component.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deserialize(data: any): DeserializeResult<EventColliderT> {
  const errors: DeserializationError[] = [];

  if (!data || typeof data !== 'object') {
    return {
      component: null,
      errors: [
        {
          code: 'INVALID_DATA',
          message: 'event-collider deserialize received non-object data',
        },
      ],
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const { type, name, shape, size, radius, offset } = data;

  if (type !== 'event-collider') {
    errors.push({
      code: 'TYPE_MISMATCH',
      message: `type ${type} does not match "event-collider"`,
    });
  }
  if (!name) {
    errors.push({
      code: 'MISSING_NAME',
      message: 'event-collider requires a name',
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
        message: `event-collider "${componentName}" size is not an object; defaulting`,
      });
    } else if (!('_vectorType' in size) || size._vectorType !== 'Vector3D') {
      errors.push({
        code: 'INVALID_VECTOR',
        message: `event-collider "${componentName}" size missing _vectorType='Vector3D' marker; defaulting`,
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
        message: `event-collider "${componentName}" offset is not an object; defaulting`,
      });
    } else if (
      !('_vectorType' in offset) ||
      offset._vectorType !== 'Vector3D'
    ) {
      errors.push({
        code: 'INVALID_VECTOR',
        message: `event-collider "${componentName}" offset missing _vectorType='Vector3D' marker; defaulting`,
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

export const EventColliderSerializer: ComponentSerializer = {
  serialize,
  deserialize,
};

/**
 * Allowlist of event-collider-specific properties accessible via component Proxy.
 */
export const PROPERTY_ALLOWLIST: string[] = [
  'shape',
  'size',
  'radius',
  'offset',
  'triggers',
  'onEnter',
  'onExit',
  'while',
];
