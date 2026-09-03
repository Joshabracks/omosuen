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
 * How a vision source decides what it can see. See `FogOfWarT.visionMode`.
 */
export type FogVisionMode = 'line-of-sight' | 'distance';

/**
 * How much history fog-of-war keeps. See `FogOfWarT.memory`.
 *
 * A scene with vision sources but NO fog-of-war component behaves as `'none'`
 * with default styles -- that is what the component's absence means, rather
 * than a special case bolted on beside it.
 */
export type FogMemoryMode = 'full' | 'partial' | 'none';

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

  /**
   * Style for what is known but not currently seen -- remembered ground under
   * `memory: 'full'`, or simply "in range, out of sight" under the other modes.
   */
  fadedStyle: FogOfWarStyle;

  /** Style for what is not known at all: out of range, or never seen. */
  hiddenStyle: FogOfWarStyle;

  /**
   * How much history is kept, and therefore what selects between the two
   * styles above.
   *
   * - `'full'` (the default): the persistent explored texture decides. Ground
   *   you have visited stays `fadedStyle` however far away you walk, and
   *   sprites get the whole memory system -- phantoms left where something was
   *   last seen, and a never-seen sprite drawn not at all.
   * - `'partial'`: no history. The zones are pure current geometry -- outside a
   *   source's range is `hiddenStyle`, in range but out of sight is
   *   `fadedStyle` -- but sprites still get memory, so something that walks
   *   behind a wall inside the radius leaves a phantom.
   * - `'none'`: the same zones, and no sprite memory at all. Sprites are only
   *   ever FILTERED, never hidden or replaced: one in the faded zone keeps
   *   behaving normally with the faded look on it, and fades to transparency as
   *   it crosses into the hidden zone. Vision sources as a pure render filter.
   *
   * `'partial'` and `'none'` never read the explored texture, so its per-frame
   * sweep is skipped outright in those modes.
   */
  memory: FogMemoryMode;

  /**
   * Whether fully hidden terrain is skipped instead of drawn, default `true`.
   *
   * A fragment that no source reaches discards before any texture or lighting
   * work, so this is close to free. Set the viewport background to
   * `hiddenStyle.tint` and the boundary is seamless.
   *
   * `false` draws it in `hiddenStyle` instead -- which at the default
   * `opacity: 0` means solid black, useful for seeing where geometry actually
   * is while tuning.
   */
  dropHidden: boolean;

  /** How much active light sources influence memory/never-viewed cells, 0-1. */
  lightInfluence: number;

  /**
   * How a vision source decides what it can see.
   *
   * - `'line-of-sight'` (default): range AND an unobstructed path, from eight
   *   jittered raycasts against the voxel solidity volume. Walls block sight.
   * - `'distance'`: range alone. Everything inside the radius is seen, walls
   *   included.
   *
   * This is a whole-system switch, not a rendering one -- it drives sprites,
   * terrain, and what gets marked explored alike. Splitting it would put the
   * live view and terrain memory back into disagreement, which is the class of
   * bug the single-source-of-truth work here exists to prevent.
   *
   * `'distance'` also makes a sprite match the tile it stands on EXACTLY.
   * Visibility is then a pure function of position, so a sprite fragment and a
   * terrain fragment at the same world point resolve identically. Under
   * `'line-of-sight'` they cannot: terrain raycasts per fragment while a sprite
   * gets one raycast at its anchor, so the occlusion term snaps across a sprite
   * where it gradates across a tile.
   *
   * It is much cheaper too -- eight DDA raycasts per terrain fragment and per
   * sprite sample, gone -- but pick it for the look, since it is a visible
   * gameplay change: vision passes through walls.
   */
  visionMode: FogVisionMode;

  /**
   * Whether marking terrain "explored" requires line of sight, or just range.
   *
   * Default `true`, and it should stay that way: a cell is remembered exactly
   * when a vision source could actually SEE it, decided by `isVisibleFrom` --
   * the same predicate behind the sprite sweep and deferred terrain
   * presentation, and a ray-for-ray mirror of what unified.frag computes per
   * fragment. That is what keeps terrain memory, sprite memory and the live
   * view from disagreeing about what counts as seen.
   *
   * `false` marks purely by range. It is a perf lever, not a look: it makes
   * memory appear on ground that was near but out of sight, which reads as
   * inconsistent against the live view right beside it.
   *
   * Note the raycast is not a residency problem. It runs against the voxel
   * solidity volume, which covers every resident cell whether or not its mesh
   * has been built, and both `isRayBlockedTS` and the shader's `isRayBlocked`
   * fail OPEN once a ray leaves that volume -- so CPU and GPU agree out there
   * by construction.
   */
  exploreRequiresLineOfSight: boolean;

  /**
   * @deprecated No longer has any effect. It tuned the near/far terrain-memory
   * LOD, which tiered how much detail a flat per-material colour snapshot
   * carried. Remembered terrain is now the real geometry, deferred rather
   * than repainted (see cell-map/deferred-presentation.ts), so there are no
   * tiers left to tune. Retained so existing scenes and saves still load.
   */
  nearBufferCells: number;
}

export interface FogOfWarOptions extends ComponentOptions {
  fadedStyle?: FogOfWarStyle;
  hiddenStyle?: FogOfWarStyle;
  memory?: FogMemoryMode;
  dropHidden?: boolean;
  lightInfluence?: number;
  visionMode?: FogVisionMode;
  exploreRequiresLineOfSight?: boolean;
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

    fadedStyle: options.fadedStyle ?? {
      saturation: 0,
      opacity: 1,
      tint: new Vector3D(1, 1, 1),
    },
    hiddenStyle: options.hiddenStyle ?? {
      saturation: 0,
      opacity: 0,
      tint: new Vector3D(0, 0, 0),
    },
    memory: options.memory ?? 'full',
    dropHidden: options.dropHidden ?? true,
    lightInfluence: options.lightInfluence ?? 0,
    visionMode: options.visionMode ?? 'line-of-sight',
    exploreRequiresLineOfSight: options.exploreRequiresLineOfSight ?? true,
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
    fadedStyle: serializeStyle(fow.fadedStyle),
    hiddenStyle: serializeStyle(fow.hiddenStyle),
    memory: fow.memory,
    dropHidden: fow.dropHidden,
    lightInfluence: fow.lightInfluence,
    visionMode: fow.visionMode,
    exploreRequiresLineOfSight: fow.exploreRequiresLineOfSight,
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

  const defaultFadedStyle: FogOfWarStyle = {
    saturation: 0,
    opacity: 1,
    tint: new Vector3D(1, 1, 1),
  };
  const defaultHiddenStyle: FogOfWarStyle = {
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

  const fadedStyle = parseStyle(data.fadedStyle, 'fadedStyle', defaultFadedStyle);
  const hiddenStyle = parseStyle(
    data.hiddenStyle,
    'hiddenStyle',
    defaultHiddenStyle,
  );

  return {
    component: builder({
      name: componentName,
      fadedStyle,
      hiddenStyle,
      lightInfluence: data.lightInfluence as number,
      // Unrecognised values fall back to the default rather than erroring: an
      // unknown mode is a forward-compatibility case (a scene written by a
      // newer build), and defaulting keeps the scene loadable.
      memory:
        data.memory === 'partial' || data.memory === 'none'
          ? data.memory
          : undefined,
      dropHidden:
        typeof data.dropHidden === 'boolean'
          ? (data.dropHidden as boolean)
          : undefined,
      // Anything unrecognised falls back to the default rather than being
      // reported: an unknown mode is a forward-compatibility case (a scene
      // saved by a newer build), and defaulting keeps the scene loadable.
      visionMode: data.visionMode === 'distance' ? 'distance' : undefined,
      // Absent in scenes saved before this option existed; they load on the
      // default, which is the behaviour those scenes already had.
      exploreRequiresLineOfSight: data.exploreRequiresLineOfSight as
        | boolean
        | undefined,
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
  'fadedStyle',
  'hiddenStyle',
  'memory',
  'dropHidden',
  'lightInfluence',
  'visionMode',
  'exploreRequiresLineOfSight',
  'nearBufferCells',
];
