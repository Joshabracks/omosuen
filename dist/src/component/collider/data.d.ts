import { ComponentData, ComponentOptions, ComponentSerializer, ComponentUnique, ComponentInstanceMethods } from '../types';
import { Vector3D } from '../../math';
import type { ColliderMethods } from './methods';
export interface ColliderT extends ComponentData, ComponentInstanceMethods<ColliderMethods> {
    type: 'collider';
    unique: ComponentUnique.FALSE;
    shape: 'box' | 'sphere';
    size: Vector3D;
    radius: number;
    offset: Vector3D;
}
export interface ColliderOptions extends ComponentOptions {
    shape?: 'box' | 'sphere';
    size?: Vector3D;
    radius?: number;
    offset?: Vector3D;
}
export declare function builder(options: ColliderOptions): ColliderT;
export declare const ColliderSerializer: ComponentSerializer;
export declare const PROPERTY_ALLOWLIST: string[];
//# sourceMappingURL=data.d.ts.map