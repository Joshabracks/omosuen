// omosuen-image-loader — public ESM entry.
//
// Strict/bundler consumers: pass `imageLoaderDefinition` to the engine's
// `plugins` init option, or call `registerImageLoader()` once after the engine
// is initialized. The two ingestion paths — `importAseprite` (parse a .aseprite
// binary) and `importImages` (declare an image per sprite texture channel) —
// plus the standalone `parseAseprite` are exported for direct/procedural use.
import { registerPluginComponent } from 'omosuen';
import { imageLoaderDefinition } from './component.js';
export { imageLoaderDefinition } from './component.js';
export { importAseprite, importAsepriteSources } from './import.js';
export { importImages } from './images.js';
export { animatedChannels, spriteTextureMapKeys, CHANNEL_ORDER, } from './channels.js';
export { parseAseprite, indexAseprite, materializeCels, dropPixels, getCel, } from './parser/parser.js';
export { clearAsepriteCache } from './session.js';
export { resolveFrameSelector, resolveFrameSelectors, resolveLayers, defaultFrameGroups, tagAnimation, } from './selection.js';
/**
 * Convenience: register the `image-loader` component type with the engine.
 * Equivalent to passing `imageLoaderDefinition` in `Omosuen.init({ plugins })`.
 */
export function registerImageLoader() {
    registerPluginComponent(imageLoaderDefinition);
}
