import { ComponentData, ComponentOptions, ComponentSerializer, ComponentUnique, ComponentInstanceMethods } from '../types';
import type { VisionSourceMethods } from './methods';
export interface VisionSourceT extends ComponentData, ComponentInstanceMethods<VisionSourceMethods> {
    type: 'vision-source';
    unique: ComponentUnique.FALSE;
    radius: number;
    fadeWidth: number;
    enabled: boolean;
}
export interface VisionSourceOptions extends ComponentOptions {
    radius?: number;
    fadeWidth?: number;
    enabled?: boolean;
}
export declare function builder(options: VisionSourceOptions): VisionSourceT;
export declare const VisionSourceSerializer: ComponentSerializer;
export declare const PROPERTY_ALLOWLIST: string[];
//# sourceMappingURL=data.d.ts.map