import { setConfig as applyConfig } from './config';
export * from './component';
export * from './math';
export { parseAseprite } from './asset/aseprite';
export type { AseFile, AseLayer, AseCel, AseFrame, AseTag, } from './asset/aseprite';
export { importAseprite } from './asset/aseprite/import';
export type { AsepriteImportConfig, AsepriteImportResult, } from './asset/aseprite/import';
export * from './scene';
export * from './loop';
export { getConfig, setConfig } from './config';
export type { OmosuenConfig } from './config';
export declare const version: string;
export declare const name = "Omosuen";
export declare function init(config?: import('./config').OmosuenConfig): Promise<void>;
export { start } from './loop/manager';
declare const _default: {
    version: string;
    name: string;
    init: typeof init;
    setConfig: typeof applyConfig;
};
export default _default;
//# sourceMappingURL=index.d.ts.map