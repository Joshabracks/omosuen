import {
  ComponentData,
  ComponentOptions,
  ComponentSerializer,
  ComponentUnique,
  ComponentInstanceMethods,
  DeserializationError,
  DeserializeResult,
} from '../types';
import type { VisionSourceMethods } from './methods';

/**
 * Vision-source component marking an entity as a source of fog-of-war
 * visibility (e.g. the player, an ally unit, a scouted watchtower).
 *
 * Position is NOT stored on this component -- it is resolved via a sibling
 * `transform` component at render time, the same way point/spot lights
 * resolve their position. This component only carries the vision shape/state.
 */
export interface VisionSourceT
  extends ComponentData, ComponentInstanceMethods<VisionSourceMethods> {
  type: 'vision-source';
  unique: ComponentUnique.FALSE;

  /** How far the vision source reveals, in world units. */
  radius: number;

  /** Width of the soft edge fade at the vision boundary, in world units. */
  fadeWidth: number;

  /** Whether this vision source is currently contributing to fog-of-war. */
  enabled: boolean;
}

export interface VisionSourceOptions extends ComponentOptions {
  radius?: number;
  fadeWidth?: number;
  enabled?: boolean;
}

export function builder(options: VisionSourceOptions): VisionSourceT {
  const visionSource = {
    type: 'vision-source' as const,
    name: options.name,
    unique: ComponentUnique.FALSE,
    parent: null,
    _disposed: false,

    radius: options.radius ?? 256.0,
    fadeWidth: options.fadeWidth ?? 32.0,
    enabled: options.enabled ?? true,
  };

  return visionSource as unknown as VisionSourceT;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serialize(component: ComponentData): any {
  const vs = component as VisionSourceT;

  return {
    type: 'vision-source',
    name: vs.name,
    radius: vs.radius,
    fadeWidth: vs.fadeWidth,
    enabled: vs.enabled,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deserialize(data: any): DeserializeResult<VisionSourceT> {
  const errors: DeserializationError[] = [];

  if (!data || typeof data !== 'object') {
    return {
      component: null,
      errors: [
        {
          code: 'INVALID_DATA',
          message: 'vision-source deserialize received non-object data',
        },
      ],
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const { type, name } = data;

  if (type !== 'vision-source') {
    errors.push({
      code: 'TYPE_MISMATCH',
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      message: `type ${type} does not match "vision-source"`,
    });
  }
  if (!name) {
    errors.push({
      code: 'MISSING_NAME',
      message: 'vision-source requires a name',
    });
  }
  if (errors.length > 0) {
    return { component: null, errors };
  }

  const componentName = name as string;

  return {
    component: builder({
      name: componentName,
      radius: data.radius as number,
      fadeWidth: data.fadeWidth as number,
      enabled: data.enabled as boolean,
    }),
    errors,
  };
}

export const VisionSourceSerializer: ComponentSerializer = {
  serialize,
  deserialize,
};

/**
 * Allowlist of vision-source-specific properties accessible via component Proxy.
 * These properties can be accessed directly without triggering method lookup.
 */
export const PROPERTY_ALLOWLIST: string[] = ['radius', 'fadeWidth', 'enabled'];
