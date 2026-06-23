export { asepriteLoaderDefinition } from './component.js';
export type { AsepriteLoaderT, AsepriteLoaderOptions } from './component.js';
export { importAseprite } from './import.js';
export type { AsepriteImportConfig, AsepriteImportResult, } from './import.js';
export { parseAseprite } from './parser/parser.js';
export type { AseFile, AseLayer, AseCel, AseFrame, AseTag, } from './parser/types.js';
/**
 * Convenience: register the `aseprite-loader` component type with the engine.
 * Equivalent to passing `asepriteLoaderDefinition` in `Omosuen.init({ plugins })`.
 */
export declare function registerAsepriteLoader(): void;
