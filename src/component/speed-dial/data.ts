import {
  ComponentData,
  ComponentOptions,
  ComponentSerializer,
  ComponentUnique,
  ComponentInstanceMethods,
  DeserializationError,
  DeserializeResult,
} from '../types';
import type { SpeedDialMethods } from './methods';

/**
 * A passive time-scale "dial". Dropped under a nexus, it multiplies the
 * `deltaTime` fed to that nexus's ENTIRE subtree (the nexus itself, its siblings,
 * and all descendants) — read by the update traversal, not by an update method of
 * its own. Ancestors / up-tree nodes are unaffected, so placement depth sets the
 * scope: near the scene root = global-like, deep = granular. Multiple/nested dials
 * compose multiplicatively.
 *
 * `speed` >= 0: 1 = normal, 2 = double, 0.5 = half, 0 = time frozen (the subtree
 * still renders and non-time logic still runs, unlike `nexus.paused` which skips
 * updates entirely).
 *
 * Note: audio playback runs on the WebAudio hardware clock, not `deltaTime`, so it
 * is NOT affected by a dial.
 */
export interface SpeedDialT
  extends ComponentData,
    ComponentInstanceMethods<SpeedDialMethods> {
  type: 'speed-dial';
  unique: ComponentUnique.FALSE;

  /** Time-scale multiplier applied to the parent-nexus subtree (>= 0). */
  speed: number;
}

export interface SpeedDialOptions extends ComponentOptions {
  speed?: number;
}

export function builder(options: SpeedDialOptions): SpeedDialT {
  const dial = {
    type: 'speed-dial' as const,
    name: options.name,
    unique: ComponentUnique.FALSE,
    parent: null,
    _disposed: false,

    speed: Math.max(0, options.speed ?? 1),
  };

  return dial as unknown as SpeedDialT;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serialize(component: ComponentData): any {
  const d = component as SpeedDialT;
  return {
    type: 'speed-dial',
    name: d.name,
    speed: d.speed,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deserialize(data: any): DeserializeResult<SpeedDialT> {
  const errors: DeserializationError[] = [];

  if (!data || typeof data !== 'object') {
    return {
      component: null,
      errors: [
        {
          code: 'INVALID_DATA',
          message: 'speed-dial deserialize received non-object data',
        },
      ],
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const { type, name } = data;

  if (type !== 'speed-dial') {
    errors.push({
      code: 'TYPE_MISMATCH',
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      message: `type ${type} does not match "speed-dial"`,
    });
  }
  if (!name) {
    errors.push({
      code: 'MISSING_NAME',
      message: 'speed-dial requires a name',
    });
  }
  if (errors.length > 0) {
    return { component: null, errors };
  }

  return {
    component: builder({
      name: name as string,
      speed: data.speed as number,
    }),
    errors,
  };
}

export const SpeedDialSerializer: ComponentSerializer = {
  serialize,
  deserialize,
};

export const PROPERTY_ALLOWLIST: string[] = ['speed'];
