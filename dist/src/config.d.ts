import type { ComponentTypeDefinition } from './component/registry';
import type { COMPONENT_TYPE } from './component/types';
export interface OmosuenConfig {
    logSuppression?: number;
    plugins?: (ComponentTypeDefinition | string)[];
    componentRegistrationOverrideList?: Partial<Record<COMPONENT_TYPE, boolean>>;
}
export declare function getConfig(): Readonly<OmosuenConfig>;
export declare function setConfig(config: Partial<OmosuenConfig>): void;
//# sourceMappingURL=config.d.ts.map