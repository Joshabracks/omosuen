// Shared types for the browser-local-storage plugin.

/** Which browser backend a read/write targets. */
export type StorageBackend = 'local' | 'session' | 'cookie' | 'idb';

/** Per-call options for the unified key/value API. */
export interface StorageOptions {
  /** Backend to read/write. Defaults to the component's `defaultBackend`. */
  backend?: StorageBackend;
}

/**
 * A unified async key/value adapter over one browser backend. Adapters operate on
 * fully-qualified (namespaced) keys; `keys`/`clear` take the namespace prefix and
 * return/act on the sub-keys under it. Every method resolves (never rejects) so a
 * disabled/unavailable backend degrades gracefully.
 */
export interface KVBackend {
  get(fullKey: string): Promise<unknown | null>;
  /** Returns false if the write was rejected (quota, unavailable, oversize). */
  set(fullKey: string, value: unknown): Promise<boolean>;
  remove(fullKey: string): Promise<void>;
  has(fullKey: string): Promise<boolean>;
  /** Sub-keys under `prefix` (prefix stripped). */
  keys(prefix: string): Promise<string[]>;
  /** Remove every entry whose key starts with `prefix`. */
  clear(prefix: string): Promise<void>;
}

/** Cookie backend attributes. */
export interface CookieConfig {
  maxAgeDays: number;
  sameSite: 'Lax' | 'Strict' | 'None';
}

/** Auto-mirror config: keep a named data-layer persisted to a backend. */
export interface MirrorConfig {
  /** Name of the sibling/scene data-layer to mirror. */
  dataLayer: string;
  /** Backend to persist to (default = component's `defaultBackend`). */
  backend?: StorageBackend;
  /** Storage key (default = `mirror:<dataLayer>`). */
  key?: string;
  /** Autosave throttle in ms (default 1000). */
  autosaveMs?: number;
}
