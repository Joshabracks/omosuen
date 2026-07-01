// The `browser-local-storage` plugin component: a declarative, serializable handle
// to browser persistence. It is a THIN layer over the engine's existing serializers
// and browser-native storage — it invents no value-serialization convention:
//   • arbitrary key/values          → JSON-serializable (idb also stores binary)
//   • auto-mirror a linked data-layer → DataLayerSerializer (+ DataLayer.setAll)
//   • nexus snapshots                → serializeComponentRecursive / deserializeScene
//
// One unified async key/value surface fronts four backends (local/session/cookie/
// idb); File System Access is exposed separately as gesture-gated export/import.

import {
  ComponentUnique,
  getActiveScene,
  serializeComponentRecursive,
  deserializeScene,
  DataLayerSerializer,
} from 'omosuen';
import type {
  ComponentData,
  ComponentOptions,
  ComponentMethods,
  ComponentSerializer,
  ComponentTypeDefinition,
} from 'omosuen';
import type {
  StorageBackend,
  StorageOptions,
  KVBackend,
  MirrorConfig,
} from './types.js';
import { fullKey, nsPrefix } from './keys.js';
import { webStorageBackend } from './backends/local.js';
import { cookieBackend } from './backends/cookie.js';
import { idbBackend } from './backends/indexeddb.js';
import { exportToFile, importFromFile } from './backends/file.js';

const TYPE = 'browser-local-storage';

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

const PROPERTY_ALLOWLIST: string[] = [
  'namespace',
  'defaultBackend',
  'cookieMaxAgeDays',
  'cookieSameSite',
  'idbDbName',
  'idbStoreName',
  'mirror',
];

// IndexedDB adapters hold an open DB connection, so cache one per (db, store)
// rather than reopening per call. Web-storage/cookie adapters are stateless.
const idbCache = new Map<string, KVBackend>();

function resolveBackend(c: BrowserLocalStorageT, opts?: StorageOptions): KVBackend {
  const backend = opts?.backend ?? c.defaultBackend;
  switch (backend) {
    case 'session':
      return webStorageBackend(true);
    case 'cookie':
      return cookieBackend({
        maxAgeDays: c.cookieMaxAgeDays,
        sameSite: c.cookieSameSite,
      });
    case 'idb': {
      const cacheKey = `${c.idbDbName}::${c.idbStoreName}`;
      let adapter = idbCache.get(cacheKey);
      if (!adapter) {
        adapter = idbBackend(c.idbDbName, c.idbStoreName);
        idbCache.set(cacheKey, adapter);
      }
      return adapter;
    }
    case 'local':
    default:
      return webStorageBackend(false);
  }
}

// ─── Auto-mirror ────────────────────────────────────────────────────────────
// Timer state is kept off the component (module Map keyed by id) so it never needs
// allowlisting and isn't serialized.
const mirrorTimers = new Map<number, number>();

function mirrorKey(c: BrowserLocalStorageT): string {
  return c.mirror?.key ?? `mirror:${c.mirror?.dataLayer}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolveMirrorDataLayer(c: BrowserLocalStorageT): any | null {
  if (!c.mirror) return null;
  const scene = getActiveScene();
  if (!scene) return null;
  const dl = scene.getComponentByName(c.mirror.dataLayer, true);
  if (!dl || dl.type !== 'data-layer') return null;
  return dl;
}

async function hydrateMirror(c: BrowserLocalStorageT): Promise<void> {
  if (!c.mirror) return;
  const dl = resolveMirrorDataLayer(c);
  if (!dl) {
    console.warn(
      `[browser-local-storage] '${c.name}' mirror data-layer '${c.mirror.dataLayer}' not found; skipping hydrate`,
    );
    return;
  }
  const backend = resolveBackend(c, { backend: c.mirror.backend });
  const stored = await backend.get(fullKey(c.namespace, mirrorKey(c)));
  if (stored == null) return;
  // Rehydrate through the data-layer's own serializer (Vectors tagged/restored),
  // then push values into the live data-layer via its public setAll.
  const result = DataLayerSerializer.deserialize(stored) as {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    component: any | null;
  };
  const temp = result?.component;
  if (!temp || !(temp.storage instanceof Map)) return;
  dl.setAll(Object.fromEntries(temp.storage));
}

async function saveMirror(c: BrowserLocalStorageT): Promise<boolean> {
  if (!c.mirror) return false;
  const dl = resolveMirrorDataLayer(c);
  if (!dl) return false;
  const backend = resolveBackend(c, { backend: c.mirror.backend });
  const serialized = DataLayerSerializer.serialize(dl);
  return backend.set(fullKey(c.namespace, mirrorKey(c)), serialized);
}

// ─── Builder ────────────────────────────────────────────────────────────────
function builder(options: BrowserLocalStorageOptions): BrowserLocalStorageT {
  return {
    type: TYPE,
    name: options.name,
    unique: ComponentUnique.FALSE,
    parent: null,
    _disposed: false,
    namespace: options.namespace ?? options.name,
    defaultBackend: options.defaultBackend ?? 'local',
    cookieMaxAgeDays: options.cookieMaxAgeDays ?? 365,
    cookieSameSite: options.cookieSameSite ?? 'Lax',
    idbDbName: options.idbDbName ?? 'omosuen-storage',
    idbStoreName: options.idbStoreName ?? 'kv',
    mirror: options.mirror ?? null,
  } as unknown as BrowserLocalStorageT;
}

// ─── Methods (proxy-dispatched; the component is passed as the first arg) ──────
const methods = {
  type: TYPE,

  async init(component: ComponentData): Promise<void> {
    const c = component as BrowserLocalStorageT;
    if (c.mirror) await hydrateMirror(c);
  },

  update(component: ComponentData, deltaTime: number): void {
    const c = component as BrowserLocalStorageT;
    if (!c.mirror || c.id === undefined) return;
    const interval = c.mirror.autosaveMs ?? 1000;
    const next = (mirrorTimers.get(c.id) ?? 0) + deltaTime;
    if (next >= interval) {
      mirrorTimers.set(c.id, 0);
      void saveMirror(c);
    } else {
      mirrorTimers.set(c.id, next);
    }
  },

  dispose(component: ComponentData): void {
    const c = component as BrowserLocalStorageT;
    c._disposed = true;
    if (c.id !== undefined) mirrorTimers.delete(c.id);
    if (c.mirror) void saveMirror(c);
  },

  // ── Unified key/value ──
  set(
    component: ComponentData,
    key: string,
    value: unknown,
    opts?: StorageOptions,
  ): Promise<boolean> {
    const c = component as BrowserLocalStorageT;
    return resolveBackend(c, opts).set(fullKey(c.namespace, key), value);
  },
  get(
    component: ComponentData,
    key: string,
    opts?: StorageOptions,
  ): Promise<unknown | null> {
    const c = component as BrowserLocalStorageT;
    return resolveBackend(c, opts).get(fullKey(c.namespace, key));
  },
  remove(
    component: ComponentData,
    key: string,
    opts?: StorageOptions,
  ): Promise<void> {
    const c = component as BrowserLocalStorageT;
    return resolveBackend(c, opts).remove(fullKey(c.namespace, key));
  },
  has(
    component: ComponentData,
    key: string,
    opts?: StorageOptions,
  ): Promise<boolean> {
    const c = component as BrowserLocalStorageT;
    return resolveBackend(c, opts).has(fullKey(c.namespace, key));
  },
  keys(component: ComponentData, opts?: StorageOptions): Promise<string[]> {
    const c = component as BrowserLocalStorageT;
    return resolveBackend(c, opts).keys(nsPrefix(c.namespace));
  },
  clear(component: ComponentData, opts?: StorageOptions): Promise<void> {
    const c = component as BrowserLocalStorageT;
    return resolveBackend(c, opts).clear(nsPrefix(c.namespace));
  },

  // ── Nexus snapshots (whole-tree; works on any nexus, not just the scene root) ──
  saveNexus(
    component: ComponentData,
    nexus: unknown,
    key: string,
    opts?: StorageOptions,
  ): Promise<boolean> {
    const c = component as BrowserLocalStorageT;
    const data = serializeComponentRecursive(nexus);
    return resolveBackend(c, opts).set(fullKey(c.namespace, key), data);
  },
  /**
   * Restores a snapshot into a deserialized nexus (IDs continued via the engine's
   * counter). v1 is scene-replace oriented — pair with `switchScene`; it does not
   * re-ID for insertion into a still-live scene. Returns null if absent/invalid.
   */
  async loadNexus(
    component: ComponentData,
    key: string,
    opts?: StorageOptions,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any | null> {
    const c = component as BrowserLocalStorageT;
    const data = await resolveBackend(c, opts).get(fullKey(c.namespace, key));
    if (data == null) return null;
    return deserializeScene(data);
  },

  // ── File System Access (gesture-gated) ──
  exportToFile(
    _component: ComponentData,
    payload: unknown,
    suggestedName?: string,
  ): Promise<boolean> {
    return exportToFile(payload, suggestedName);
  },
  importFromFile(_component: ComponentData): Promise<unknown | null> {
    return importFromFile();
  },

  // ── Auto-mirror (manual trigger; hydrate happens on init) ──
  saveMirror(component: ComponentData): Promise<boolean> {
    return saveMirror(component as BrowserLocalStorageT);
  },
};

// ─── Serializer (persists CONFIG only; stored data lives in the browser) ──────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serialize(component: ComponentData): any {
  const c = component as BrowserLocalStorageT;
  return {
    type: TYPE,
    name: c.name,
    namespace: c.namespace,
    defaultBackend: c.defaultBackend,
    cookieMaxAgeDays: c.cookieMaxAgeDays,
    cookieSameSite: c.cookieSameSite,
    idbDbName: c.idbDbName,
    idbStoreName: c.idbStoreName,
    mirror: c.mirror,
  };
}

function deserialize(data: unknown): {
  component: BrowserLocalStorageT | null;
  errors: { code: string; message: string }[];
} {
  if (!data || typeof data !== 'object') {
    return {
      component: null,
      errors: [
        {
          code: 'INVALID_DATA',
          message: 'browser-local-storage deserialize received non-object data',
        },
      ],
    };
  }
  const d = data as Partial<BrowserLocalStorageT>;
  if (d.type !== TYPE) {
    return {
      component: null,
      errors: [
        {
          code: 'TYPE_MISMATCH',
          message: `type ${String(d.type)} does not match "${TYPE}"`,
        },
      ],
    };
  }
  if (!d.name) {
    return {
      component: null,
      errors: [
        { code: 'MISSING_NAME', message: 'browser-local-storage requires a name' },
      ],
    };
  }
  return {
    component: builder({
      name: d.name,
      namespace: d.namespace,
      defaultBackend: d.defaultBackend,
      cookieMaxAgeDays: d.cookieMaxAgeDays,
      cookieSameSite: d.cookieSameSite,
      idbDbName: d.idbDbName,
      idbStoreName: d.idbStoreName,
      mirror: d.mirror ?? undefined,
    }),
    errors: [],
  };
}

const serializer: ComponentSerializer = { serialize, deserialize };

/**
 * The full plugin definition. Pass to
 * `Omosuen.init({ plugins: [browserLocalStorageDefinition] })` (TS path) or register
 * it from the self-registering JS file (see browser.ts).
 */
export const browserLocalStorageDefinition: ComponentTypeDefinition = {
  type: TYPE,
  builder: builder as unknown as ComponentTypeDefinition['builder'],
  methods: methods as unknown as ComponentMethods,
  propertyAllowlist: PROPERTY_ALLOWLIST,
  serializer,
};
