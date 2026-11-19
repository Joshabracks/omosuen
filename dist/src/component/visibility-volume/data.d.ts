import { ComponentData, ComponentOptions, ComponentSerializer, ComponentUnique, ComponentInstanceMethods } from '../types';
import { Vector3D } from '../../math';
import type { VisibilityVolumeMethods } from './methods';
export interface VisibilityVolumeT extends ComponentData, ComponentInstanceMethods<VisibilityVolumeMethods> {
    type: 'visibility-volume';
    unique: ComponentUnique.FALSE;
    size: Vector3D;
    enabled: boolean;
    marksExplored: boolean;
    fadeWidth: number;
    priority: number;
}
export interface VisibilityVolumeOptions extends ComponentOptions {
    size?: Vector3D | {
        x: number;
        y: number;
        z: number;
    };
    enabled?: boolean;
    marksExplored?: boolean;
    fadeWidth?: number;
    priority?: number;
}
export declare function builder(options: VisibilityVolumeOptions): VisibilityVolumeT;
export declare const VisibilityVolumeSerializer: ComponentSerializer;
export declare const PROPERTY_ALLOWLIST: string[];
//# sourceMappingURL=data.d.ts.map