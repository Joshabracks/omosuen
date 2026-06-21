import { ComponentData, ComponentOptions, ComponentSerializer, ComponentUnique, ComponentInstanceMethods } from '../types';
import type { NexusMethods } from './methods';
export interface NexusT extends ComponentData, ComponentInstanceMethods<NexusMethods> {
    type: 'nexus';
    unique: ComponentUnique.FALSE;
    components: ComponentData[];
    paused: boolean;
    script?: string;
}
export declare function builder(options: ComponentOptions): NexusT;
export declare const NexusSerializer: ComponentSerializer;
export declare const PROPERTY_ALLOWLIST: string[];
//# sourceMappingURL=data.d.ts.map