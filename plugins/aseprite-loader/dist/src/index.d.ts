export { asepriteLoaderDefinition } from './component.js';
export type { AsepriteLoaderT, AsepriteLoaderOptions, AsepriteSourceOptions, } from './component.js';
export { importAseprite, importAsepriteSources } from './import.js';
export type { AsepriteImportConfig, AsepriteImportResult, AsepriteSourceEntry, AsepriteSourcesConfig, } from './import.js';
export { parseAseprite } from './parser/parser.js';
export type { AseFile, AseLayer, AseCel, AseFrame, AseTag, } from './parser/types.js';
/**
 * Convenience: register the `aseprite-loader` component type with the engine.
 * Equivalent to passing `asepriteLoaderDefinition` in `Omosuen.init({ plugins })`.
 */
export declare function registerAsepriteLoader(): void;
