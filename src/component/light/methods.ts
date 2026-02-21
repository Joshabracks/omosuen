import { ComponentData, ComponentMethods } from '../types';
import { Vector3D } from '../../math';
import { LightT, LightType } from './data';

export interface LightMethods extends ComponentMethods {
  type: 'light';
  init: (component: ComponentData) => Promise<void>;
  dispose: (component: ComponentData) => void;
  setColor: (light: LightT, color: Vector3D) => void;
  getColor: (light: LightT) => Vector3D;
  setBrightness: (light: LightT, brightness: number) => void;
  getBrightness: (light: LightT) => number;
  setRadius: (light: LightT, radius: number) => void;
  getRadius: (light: LightT) => number;
  setHardness: (light: LightT, hardness: number) => void;
  getHardness: (light: LightT) => number;
  setDirection: (light: LightT, direction: Vector3D) => void;
  getDirection: (light: LightT) => Vector3D;
  setLightType: (light: LightT, lightType: LightType) => void;
  getLightType: (light: LightT) => LightType;
}

export const Light: LightMethods = {
  type: 'light',

  async init(_component: ComponentData): Promise<void> {
    // No-op
  },

  dispose(component: ComponentData): void {
    const light = component as LightT;
    light._disposed = true;
  },

  setColor(light: LightT, color: Vector3D): void {
    light.color = color;
  },

  getColor(light: LightT): Vector3D {
    return light.color;
  },

  setBrightness(light: LightT, brightness: number): void {
    light.brightness = brightness;
  },

  getBrightness(light: LightT): number {
    return light.brightness;
  },

  setRadius(light: LightT, radius: number): void {
    light.radius = radius;
  },

  getRadius(light: LightT): number {
    return light.radius;
  },

  setHardness(light: LightT, hardness: number): void {
    light.hardness = hardness;
  },

  getHardness(light: LightT): number {
    return light.hardness;
  },

  setDirection(light: LightT, direction: Vector3D): void {
    light.direction = direction;
  },

  getDirection(light: LightT): Vector3D {
    return light.direction;
  },

  setLightType(light: LightT, lightType: LightType): void {
    light.lightType = lightType;
  },

  getLightType(light: LightT): LightType {
    return light.lightType;
  },
};
