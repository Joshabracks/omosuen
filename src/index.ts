// omosuen-aseprite-loader — public ESM entry.
//
// Strict/bundler consumers: pass `asepriteLoaderDefinition` to the engine's
// `plugins` init option, or call `registerAsepriteLoader()` once after the engine
// is initialized. The format tools `parseAseprite` / `importAseprite` are also
// exported for direct/procedural use.

import { registerPluginComponent } from 'omosuen';
import { asepriteLoaderDefinition } from './component.js';

export { asepriteLoaderDefinition } from './component.js';
export type { AsepriteLoaderT, AsepriteLoaderOptions } from './component.js';
export { importAseprite } from './import.js';
export type {
  AsepriteImportConfig,
  AsepriteImportResult,
} from './import.js';
export { parseAseprite } from './parser/parser.js';
export type {
  AseFile,
  AseLayer,
  AseCel,
  AseFrame,
  AseTag,
} from './parser/types.js';

/**
 * Convenience: register the `aseprite-loader` component type with the engine.
 * Equivalent to passing `asepriteLoaderDefinition` in `Omosuen.init({ plugins })`.
 */
export function registerAsepriteLoader(): void {
  registerPluginComponent(asepriteLoaderDefinition);
}
