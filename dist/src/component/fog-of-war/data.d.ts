import { ComponentData, ComponentOptions, ComponentSerializer, ComponentUnique, ComponentInstanceMethods } from '../types';
import { Vector3D } from '../../math';
import type { FogOfWarMethods } from './methods';
export type FogVisionMode = 'line-of-sight' | 'distance';
export type FogMemoryMode = 'full' | 'partial' | 'none';
export interface FogOfWarStyle {
    saturation: number;
    opacity: number;
    tint: Vector3D;
}
export interface FogOfWarT extends ComponentData, ComponentInstanceMethods<FogOfWarMethods> {
    type: 'fog-of-war';
    unique: ComponentUnique.GLOBAL;
    fadedStyle: FogOfWarStyle;
    hiddenStyle: FogOfWarStyle;
    memory: FogMemoryMode;
    dropHidden: boolean;
    lightInfluence: number;
    visionMode: FogVisionMode;
    exploreRequiresLineOfSight: boolean;
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
export declare function builder(options: FogOfWarOptions): FogOfWarT;
export declare const FogOfWarSerializer: ComponentSerializer;
export declare const PROPERTY_ALLOWLIST: string[];
//# sourceMappingURL=data.d.ts.map