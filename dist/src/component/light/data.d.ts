import { ComponentData, ComponentOptions, ComponentSerializer, ComponentUnique, ComponentInstanceMethods } from '../types';
import { Vector3D } from '../../math';
import type { LightMethods } from './methods';
export type LightType = 'ambient' | 'point' | 'spot' | 'directional';
export interface LightT extends ComponentData, ComponentInstanceMethods<LightMethods> {
    type: 'light';
    unique: ComponentUnique.FALSE;
    lightType: LightType;
    color: Vector3D;
    brightness: number;
    radius: number;
    hardness: number;
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
export declare function builder(options: LightOptions): LightT;
export declare const LightSerializer: ComponentSerializer;
export declare const PROPERTY_ALLOWLIST: string[];
//# sourceMappingURL=data.d.ts.map