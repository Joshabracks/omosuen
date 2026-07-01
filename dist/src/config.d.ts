import type { ComponentTypeDefinition } from './component/registry';
export interface OmosuenConfig {
    logSuppression?: number;
    plugins?: (ComponentTypeDefinition | string)[];
}
export declare function getConfig(): Readonly<OmosuenConfig>;
export declare function setConfig(config: Partial<OmosuenConfig>): void;
//# sourceMappingURL=config.d.ts.map