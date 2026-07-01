import type { ComponentData, ComponentOptions, ComponentTypeDefinition } from 'omosuen';
import type { StorageBackend, MirrorConfig } from './types.js';
export interface BrowserLocalStorageOptions extends ComponentOptions {
    /** Key prefix isolating this store (default = component `name`). */
    namespace?: string;
    /** Backend used when a call omits `opts.backend` (default `'local'`). */
    defaultBackend?: StorageBackend;
    /** Cookie lifetime in days (default 365). */
    cookieMaxAgeDays?: number;
    /** Cookie SameSite attribute (default `'Lax'`). */
    cookieSameSite?: 'Lax' | 'Strict' | 'None';
    /** IndexedDB database name (default `'omosuen-storage'`). */
    idbDbName?: string;
    /** IndexedDB object-store name (default `'kv'`). */
    idbStoreName?: string;
    /** Optional data-layer auto-mirror. */
    mirror?: MirrorConfig;
}
export interface BrowserLocalStorageT extends ComponentData {
    type: 'browser-local-storage';
    namespace: string;
    defaultBackend: StorageBackend;
    cookieMaxAgeDays: number;
    cookieSameSite: 'Lax' | 'Strict' | 'None';
    idbDbName: string;
    idbStoreName: string;
    mirror: MirrorConfig | null;
}
/**
 * The full plugin definition. Pass to
 * `Omosuen.init({ plugins: [browserLocalStorageDefinition] })` (TS path) or register
 * it from the self-registering JS file (see browser.ts).
 */
export declare const browserLocalStorageDefinition: ComponentTypeDefinition;
