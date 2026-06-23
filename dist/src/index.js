// omosuen-aseprite-loader — public ESM entry.
//
// Strict/bundler consumers: pass `asepriteLoaderDefinition` to the engine's
// `plugins` init option, or call `registerAsepriteLoader()` once after the engine
// is initialized. The format tools `parseAseprite` / `importAseprite` are also
// exported for direct/procedural use.
import { registerPluginComponent } from 'omosuen';
import { asepriteLoaderDefinition } from './component';
export { asepriteLoaderDefinition } from './component';
export { importAseprite } from './import';
export { parseAseprite } from './parser/parser';
/**
 * Convenience: register the `aseprite-loader` component type with the engine.
 * Equivalent to passing `asepriteLoaderDefinition` in `Omosuen.init({ plugins })`.
 */
export function registerAsepriteLoader() {
    registerPluginComponent(asepriteLoaderDefinition);
}
