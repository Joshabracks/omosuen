export { browserLocalStorageDefinition } from './component.js';
export type { BrowserLocalStorageT, BrowserLocalStorageOptions, } from './component.js';
export type { StorageBackend, StorageOptions, KVBackend, CookieConfig, MirrorConfig, } from './types.js';
export { fileSystemAccessSupported, exportToFile, importFromFile, } from './backends/file.js';
/**
 * Convenience: register the `browser-local-storage` component type with the engine.
 * Equivalent to passing `browserLocalStorageDefinition` in `Omosuen.init({ plugins })`.
 */
export declare function registerBrowserLocalStorage(): void;
