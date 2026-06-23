export { asepriteLoaderDefinition } from './component';
export type { AsepriteLoaderT, AsepriteLoaderOptions } from './component';
export { importAseprite } from './import';
export type { AsepriteImportConfig, AsepriteImportResult, } from './import';
export { parseAseprite } from './parser/parser';
export type { AseFile, AseLayer, AseCel, AseFrame, AseTag, } from './parser/types';
/**
 * Convenience: register the `aseprite-loader` component type with the engine.
 * Equivalent to passing `asepriteLoaderDefinition` in `Omosuen.init({ plugins })`.
 */
export declare function registerAsepriteLoader(): void;
