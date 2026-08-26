import { ComponentData, ComponentOptions, ComponentSerializer, ComponentUnique, ComponentInstanceMethods } from '../types';
import { Vector3D } from '../../math';
import type { FogOfWarMethods } from './methods';
export interface FogOfWarStyle {
    saturation: number;
    opacity: number;
    tint: Vector3D;
}
export interface FogOfWarT extends ComponentData, ComponentInstanceMethods<FogOfWarMethods> {
    type: 'fog-of-war';
    unique: ComponentUnique.GLOBAL;
    memoryStyle: FogOfWarStyle;
    neverViewedStyle: FogOfWarStyle;
    lightInfluence: number;
    nearBufferCells: number;
}
export interface FogOfWarOptions extends ComponentOptions {
    memoryStyle?: FogOfWarStyle;
    neverViewedStyle?: FogOfWarStyle;
    lightInfluence?: number;
    nearBufferCells?: number;
}
export declare function builder(options: FogOfWarOptions): FogOfWarT;
export declare const FogOfWarSerializer: ComponentSerializer;
export declare const PROPERTY_ALLOWLIST: string[];
//# sourceMappingURL=data.d.ts.map