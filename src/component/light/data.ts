import {
  ComponentData,
  ComponentOptions,
  ComponentSerializer,
  ComponentInstanceMethods,
  ComponentUnique,
} from '../base';
import { Vector3D } from '../../math';
import type { LightMethods } from './methods';

export type LightType = 'ambient' | 'point' | 'spot' | 'directional';

export interface LightT
  extends ComponentData, ComponentInstanceMethods<LightMethods> {
  type: 'light';
  unique: ComponentUnique.FALSE;

  /** Discriminator for light behavior. */
  lightType: LightType;

  /** Light color (RGB, each channel 0-1). */
  color: Vector3D;

  /** Light brightness (0-1). */
  brightness: number;

  /** How far the light travels from center (point, spot). */
  radius: number;

  /** Distance at which light begins to soften, 0-1. 0 = gradient from center, 1 = full brightness until edge (point, spot). */
  hardness: number;

  /** Light direction in world space (directional). */
  direction: Vector3D;
}

export interface LightOptions extends ComponentOptions {
  lightType: LightType;
  color?: Vector3D;
  brightness?: number;
  radius?: number;
  hardness?: number;
  direction?: Vector3D;
}

export function builder(options: LightOptions): LightT {
  const light = {
    type: 'light' as const,
    name: options.name,
    unique: ComponentUnique.FALSE,
    parent: null,
    _disposed: false,

    lightType: options.lightType,
    color: options.color ?? new Vector3D(1, 1, 1),
    brightness: options.brightness ?? 1,
    radius: options.radius ?? 100,
    hardness: options.hardness ?? 0,
    direction: options.direction ?? new Vector3D(0, -1, 0),
  };

  return light as unknown as LightT;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serialize(component: ComponentData): any {
  const l = component as LightT;

  return {
    type: 'light',
    name: l.name,
    lightType: l.lightType,
    color: {
      _vectorType: 'Vector3D',
      x: l.color.x,
      y: l.color.y,
      z: l.color.z,
    },
    brightness: l.brightness,
    radius: l.radius,
    hardness: l.hardness,
    direction: {
      _vectorType: 'Vector3D',
      x: l.direction.x,
      y: l.direction.y,
      z: l.direction.z,
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deserialize(data: any): LightT {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const { type, name, lightType } = data;

  const errors: string[] = [];
  if (type !== 'light') {
    errors.push(`type ${type} does not match "light"`);
  }
  if (!name) {
    errors.push('light requires a name');
  }
  if (!lightType) {
    errors.push('light requires a lightType');
  }
  if (errors.length) {
    throw new Error(errors.join('\n'));
  }

  let colorVec = new Vector3D(1, 1, 1);
  if (data.color && typeof data.color === 'object') {
    if ('_vectorType' in data.color && data.color._vectorType === 'Vector3D') {
      colorVec = new Vector3D(data.color.x, data.color.y, data.color.z);
    }
  }

  let directionVec = new Vector3D(0, -1, 0);
  if (data.direction && typeof data.direction === 'object') {
    if ('_vectorType' in data.direction && data.direction._vectorType === 'Vector3D') {
      directionVec = new Vector3D(data.direction.x, data.direction.y, data.direction.z);
    }
  }

  return builder({
    name: name as string,
    lightType: lightType as LightType,
    color: colorVec,
    brightness: data.brightness as number,
    radius: data.radius as number,
    hardness: data.hardness as number,
    direction: directionVec,
  });
}

export const LightSerializer: ComponentSerializer = {
  serialize,
  deserialize,
};

export const PROPERTY_ALLOWLIST: string[] = [
  'lightType',
  'color',
  'brightness',
  'radius',
  'hardness',
  'direction',
];
