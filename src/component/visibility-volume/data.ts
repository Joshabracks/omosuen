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
import type { VisibilityVolumeMethods } from './methods';

/**
 * An axis-aligned box that DECLARES everything inside it visible -- a building,
 * a town square, a road, a field strip.
 *
 * Where a `vision-source` is an observer (a sphere that sees out from its
 * centre, blocked by walls in `'line-of-sight'` mode), a volume is a statement:
 * every cell whose CENTRE lies inside the box, and every sprite whose ground
 * point's cell centre does, renders live -- behind walls, under roofs, below
 * cliff lips. No sight lines are traced.
 *
 * It joins fog-of-war's single definition of "seen" rather than overlaying the
 * shader: the CPU sprite sweep (`_fowStatus`, phantoms), deferred terrain
 * presentation, and explored marking all treat inside-a-volume as observed.
 * Visibility is the max over every vision source and every volume, so a volume
 * can only add visibility, never remove it. A scene with volumes and no vision
 * sources still applies fog outside them.
 *
 * Position is NOT stored here -- the box is centred on the sibling `transform`'s
 * world position, exactly as vision sources and point lights resolve theirs.
 * Scale and rotation are ignored (axis-aligned only).
 *
 * No count is compiled into the engine: volumes share the runtime-sized shape
 * store and spatial bins with vision sources (camera/render/visibility-shapes.ts).
 */
export interface VisibilityVolumeT
  extends ComponentData, ComponentInstanceMethods<VisibilityVolumeMethods> {
  type: 'visibility-volume';
  unique: ComponentUnique.FALSE;

  /** Full box extents in world units, centred on the sibling transform. */
  size: Vector3D;

  /** Whether the volume currently contributes. Takes effect the next frame. */
  enabled: boolean;

  /**
   * Whether everything inside is also written to the persistent explored state
   * (`memory: 'full'` only), so it stays remembered after the volume is
   * disabled or removed. `false` makes the box live while it exists and leaves
   * no memory behind.
   */
  marksExplored: boolean;

  /**
   * Optional soft edge OUTSIDE the box, in world units: visibility ramps from 1
   * at the surface to 0 at `fadeWidth` beyond it (smoothstep, as vision sources
   * use). `0` is a hard edge on the cell grid.
   */
  fadeWidth: number;

  /**
   * Rank used only when the consumer has capped rendered shapes
   * (`FogOfWarT.maxVisibilityShapes`): higher is kept first, before distance.
   */
  priority: number;
}

export interface VisibilityVolumeOptions extends ComponentOptions {
  size?: Vector3D | { x: number; y: number; z: number };
  enabled?: boolean;
  marksExplored?: boolean;
  fadeWidth?: number;
  priority?: number;
}

export function builder(options: VisibilityVolumeOptions): VisibilityVolumeT {
  const s = options.size;
  const volume = {
    type: 'visibility-volume' as const,
    name: options.name,
    unique: ComponentUnique.FALSE,
    parent: null,
    _disposed: false,

    size: s ? new Vector3D(s.x, s.y, s.z) : new Vector3D(64, 64, 64),
    enabled: options.enabled ?? true,
    marksExplored: options.marksExplored ?? true,
    fadeWidth: options.fadeWidth ?? 0,
    priority: options.priority ?? 0,
  };

  return volume as unknown as VisibilityVolumeT;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serialize(component: ComponentData): any {
  const v = component as VisibilityVolumeT;
  return {
    type: 'visibility-volume',
    name: v.name,
    size: { _vectorType: 'Vector3D', x: v.size.x, y: v.size.y, z: v.size.z },
    enabled: v.enabled,
    marksExplored: v.marksExplored,
    fadeWidth: v.fadeWidth,
    priority: v.priority,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deserialize(data: any): DeserializeResult<VisibilityVolumeT> {
  const errors: DeserializationError[] = [];

  if (!data || typeof data !== 'object') {
    return {
      component: null,
      errors: [
        {
          code: 'INVALID_DATA',
          message: 'visibility-volume deserialize received non-object data',
        },
      ],
    };
  }

  const { type, name } = data;
  if (type !== 'visibility-volume') {
    errors.push({
      code: 'TYPE_MISMATCH',
      message: `type ${type} does not match "visibility-volume"`,
    });
  }
  if (!name) {
    errors.push({
      code: 'MISSING_NAME',
      message: 'visibility-volume requires a name',
    });
  }
  if (errors.length > 0) {
    return { component: null, errors };
  }

  let size: Vector3D | undefined;
  const raw = data.size;
  if (raw !== undefined) {
    if (
      raw &&
      typeof raw === 'object' &&
      typeof raw.x === 'number' &&
      typeof raw.y === 'number' &&
      typeof raw.z === 'number'
    ) {
      size = new Vector3D(raw.x as number, raw.y as number, raw.z as number);
    } else {
      errors.push({
        code: 'INVALID_VECTOR',
        message: `visibility-volume "${name}" size is not a Vector3D; defaulting`,
      });
    }
  }

  return {
    component: builder({
      name: name as string,
      size,
      enabled: typeof data.enabled === 'boolean' ? data.enabled : undefined,
      marksExplored:
        typeof data.marksExplored === 'boolean'
          ? data.marksExplored
          : undefined,
      fadeWidth:
        typeof data.fadeWidth === 'number' ? data.fadeWidth : undefined,
      priority: typeof data.priority === 'number' ? data.priority : undefined,
    }),
    errors,
  };
}

export const VisibilityVolumeSerializer: ComponentSerializer = {
  serialize,
  deserialize,
};

/**
 * Allowlist of visibility-volume-specific properties accessible via the
 * component Proxy.
 */
export const PROPERTY_ALLOWLIST: string[] = [
  'size',
  'enabled',
  'marksExplored',
  'fadeWidth',
  'priority',
];
