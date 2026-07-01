// omosuen-browser-local-storage — public ESM entry.
//
// Strict/bundler consumers: pass `browserLocalStorageDefinition` to the engine's
// `plugins` init option, or call `registerBrowserLocalStorage()` once after the
// engine is initialized. Backend helpers are also exported for direct use.
import { registerPluginComponent } from 'omosuen';
import { browserLocalStorageDefinition } from './component.js';
export { browserLocalStorageDefinition } from './component.js';
export { fileSystemAccessSupported, exportToFile, importFromFile, } from './backends/file.js';
/**
 * Convenience: register the `browser-local-storage` component type with the engine.
 * Equivalent to passing `browserLocalStorageDefinition` in `Omosuen.init({ plugins })`.
 */
export function registerBrowserLocalStorage() {
    registerPluginComponent(browserLocalStorageDefinition);
}
