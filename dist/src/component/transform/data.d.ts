import { ComponentData, ComponentOptions, ComponentSerializer, ComponentUnique, ComponentInstanceMethods } from '../types';
import { Vector3D } from '../../math';
import type { TransformMethods } from './methods';
export interface TransformT extends ComponentData, ComponentInstanceMethods<TransformMethods> {
    type: 'transform';
    unique: ComponentUnique.FALSE;
    position: Vector3D;
    rotation: Vector3D;
    scale: Vector3D;
    worldPosition: Vector3D;
    worldRotation: Vector3D;
    worldScale: Vector3D;
    onScreen: boolean;
}
export interface TransformOptions extends ComponentOptions {
    position?: Vector3D;
    rotation?: Vector3D;
    scale?: Vector3D;
}
export declare function builder(options: TransformOptions): TransformT;
export declare const TransformSerializer: ComponentSerializer;
export declare const PROPERTY_ALLOWLIST: string[];
//# sourceMappingURL=data.d.ts.map