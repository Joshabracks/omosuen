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
import type { FogOfWarMethods } from './methods';

/**
 * Fog-of-war component for scene-wide vision memory styling.
 * Uses GLOBAL uniqueness - only one fog-of-war allowed per scene hierarchy.
 *
 * Controls how previously-seen-but-not-currently-visible ("memory") and
 * never-seen ("never viewed") cells are rendered, and how much active
 * light sources bleed into those areas.
 */
export interface FogOfWarStyle {
  /** Desaturation applied to the underlying color, 0-1 (0 = untouched, 1 = fully desaturated). */
  saturation: number;
  /** Overlay opacity, 0-1. */
  opacity: number;
  /** Overlay tint color (RGB, each channel 0-1). */
  tint: Vector3D;
}

export interface FogOfWarT
  extends ComponentData, ComponentInstanceMethods<FogOfWarMethods> {
  type: 'fog-of-war';
  unique: ComponentUnique.GLOBAL;

  /** Style applied to cells that have been seen before but are not currently visible. */
  memoryStyle: FogOfWarStyle;

  /** Style applied to cells that have never been visible. */
  neverViewedStyle: FogOfWarStyle;

  /** How much active light sources influence memory/never-viewed cells, 0-1. */
  lightInfluence: number;

  /**
   * Extra cells, beyond one chunk-width, that still count as "near" a vision
   * source for the fine (per-cell) memory-snapshot tier -- see the
   * near/far terrain-memory LOD design. Default 0 (near = live vision
   * radius + one chunk-width, no extra padding). Cells/chunks beyond this
   * fall back to the coarser per-chunk memory tier.
   */
  nearBufferCells: number;
}

export interface FogOfWarOptions extends ComponentOptions {
  memoryStyle?: FogOfWarStyle;
  neverViewedStyle?: FogOfWarStyle;
  lightInfluence?: number;
  nearBufferCells?: number;
}

/**
 * Builder function for fog-of-war component.
 * Creates a new fog-of-war with default memory/never-viewed styling.
 *
 * @param options - Component creation options
 * @returns A new fog-of-war component instance
 *
 * @example
 * ```typescript
 * const fogOfWar = await newComponent("fog-of-war", { name: "Fog Of War" });
 *
 * // Or with overrides
 * const fogOfWar = await newComponent("fog-of-war", {
 *   name: "Fog Of War",
 *   lightInfluence: 0.5,
 * });
 * ```
 */
export function builder(options: FogOfWarOptions): FogOfWarT {
  // Create data-only object. Methods will be added by Proxy wrapper in newComponent()
  const fogOfWar = {
    type: 'fog-of-war' as const,
    name: options.name,
    unique: ComponentUnique.GLOBAL,
    parent: null,
    _disposed: false,

    memoryStyle: options.memoryStyle ?? {
      saturation: 0,
      opacity: 1,
      tint: new Vector3D(1, 1, 1),
    },
    neverViewedStyle: options.neverViewedStyle ?? {
      saturation: 0,
      opacity: 0,
      tint: new Vector3D(0, 0, 0),
    },
    lightInfluence: options.lightInfluence ?? 0,
    nearBufferCells: options.nearBufferCells ?? 0,
  };

  return fogOfWar as unknown as FogOfWarT;
}

/**
 * Serializes a style object, converting its Vector3D tint into a
 * JSON-compatible marker object.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serializeStyle(style: FogOfWarStyle): any {
  return {
    saturation: style.saturation,
    opacity: style.opacity,
    tint: {
      _vectorType: 'Vector3D',
      x: style.tint.x,
      y: style.tint.y,
      z: style.tint.z,
    },
  };
}

/**
 * Serializes a fog-of-war component to a plain object.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serialize(component: ComponentData): any {
  const fow = component as FogOfWarT;

  return {
    type: 'fog-of-war',
    name: fow.name,
    unique: ComponentUnique.GLOBAL,
    memoryStyle: serializeStyle(fow.memoryStyle),
    neverViewedStyle: serializeStyle(fow.neverViewedStyle),
    lightInfluence: fow.lightInfluence,
    nearBufferCells: fow.nearBufferCells,
  };
}

/**
 * Deserializes a plain object back into a fog-of-war component.
 * Reconstructs Vector3D tints from their marker objects.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deserialize(data: any): DeserializeResult<FogOfWarT> {
  const errors: DeserializationError[] = [];

  if (!data || typeof data !== 'object') {
    return {
      component: null,
      errors: [
        {
          code: 'INVALID_DATA',
          message: 'fog-of-war deserialize received non-object data',
        },
      ],
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const { type, name } = data;

  if (type !== 'fog-of-war') {
    errors.push({
      code: 'TYPE_MISMATCH',

      message: `type ${type} does not match "fog-of-war"`,
    });
  }
  if (!name) {
    errors.push({
      code: 'MISSING_NAME',
      message: 'fog-of-war requires a name',
    });
  }
  if (errors.length > 0) {
    return { component: null, errors };
  }

  const componentName = name as string;

  const defaultMemoryStyle: FogOfWarStyle = {
    saturation: 0,
    opacity: 1,
    tint: new Vector3D(1, 1, 1),
  };
  const defaultNeverViewedStyle: FogOfWarStyle = {
    saturation: 0,
    opacity: 0,
    tint: new Vector3D(0, 0, 0),
  };

  const parseStyle = (
    raw: unknown,
    fieldName: string,
    fallback: FogOfWarStyle,
  ): FogOfWarStyle => {
    if (raw === undefined) {
      return fallback;
    }
    if (!raw || typeof raw !== 'object') {
      errors.push({
        code: 'INVALID_STYLE',
        message: `fog-of-war "${componentName}" ${fieldName} is not an object; defaulting`,
      });
      return fallback;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const styleObj = raw as any;
    let tint = fallback.tint;

    if (styleObj.tint !== undefined) {
      if (!styleObj.tint || typeof styleObj.tint !== 'object') {
        errors.push({
          code: 'INVALID_VECTOR',
          message: `fog-of-war "${componentName}" ${fieldName}.tint is not an object; defaulting`,
        });
      } else if (
        !('_vectorType' in styleObj.tint) ||
        styleObj.tint._vectorType !== 'Vector3D'
      ) {
        errors.push({
          code: 'INVALID_VECTOR',
          message: `fog-of-war "${componentName}" ${fieldName}.tint missing _vectorType='Vector3D' marker; defaulting`,
        });
      } else {
        tint = new Vector3D(
          styleObj.tint.x as number,
          styleObj.tint.y as number,
          styleObj.tint.z as number,
        );
      }
    }

    return {
      saturation:
        typeof styleObj.saturation === 'number'
          ? styleObj.saturation
          : fallback.saturation,
      opacity:
        typeof styleObj.opacity === 'number'
          ? styleObj.opacity
          : fallback.opacity,
      tint,
    };
  };

  const memoryStyle = parseStyle(
    data.memoryStyle,
    'memoryStyle',
    defaultMemoryStyle,
  );
  const neverViewedStyle = parseStyle(
    data.neverViewedStyle,
    'neverViewedStyle',
    defaultNeverViewedStyle,
  );

  return {
    component: builder({
      name: componentName,
      memoryStyle,
      neverViewedStyle,
      lightInfluence: data.lightInfluence as number,
      nearBufferCells: data.nearBufferCells as number | undefined,
    }),
    errors,
  };
}

export const FogOfWarSerializer: ComponentSerializer = {
  serialize,
  deserialize,
};

/**
 * Allowlist of fog-of-war-specific properties accessible via component Proxy.
 * These properties can be accessed directly without triggering method lookup.
 */
export const PROPERTY_ALLOWLIST: string[] = [
  'memoryStyle',
  'neverViewedStyle',
  'lightInfluence',
  'nearBufferCells',
];
