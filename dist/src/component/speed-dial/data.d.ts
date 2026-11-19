import { ComponentData, ComponentOptions, ComponentSerializer, ComponentUnique, ComponentInstanceMethods } from '../types';
import type { SpeedDialMethods } from './methods';
export interface SpeedDialT extends ComponentData, ComponentInstanceMethods<SpeedDialMethods> {
    type: 'speed-dial';
    unique: ComponentUnique.FALSE;
    speed: number;
}
export interface SpeedDialOptions extends ComponentOptions {
    speed?: number;
}
export declare function builder(options: SpeedDialOptions): SpeedDialT;
export declare const SpeedDialSerializer: ComponentSerializer;
export declare const PROPERTY_ALLOWLIST: string[];
//# sourceMappingURL=data.d.ts.map