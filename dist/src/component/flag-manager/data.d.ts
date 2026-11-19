import { ComponentData, ComponentOptions, ComponentSerializer, ComponentUnique, ComponentInstanceMethods } from '../types';
import type { FlagManagerMethods } from './methods';
export interface FlagManagerT extends ComponentData, ComponentInstanceMethods<FlagManagerMethods> {
    type: 'flag-manager';
    unique: ComponentUnique.GLOBAL;
    flags: Set<string>;
}
export declare function builder(options: ComponentOptions): FlagManagerT;
export declare const FlagManagerSerializer: ComponentSerializer;
export declare const PROPERTY_ALLOWLIST: string[];
//# sourceMappingURL=data.d.ts.map