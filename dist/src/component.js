// The `browser-local-storage` plugin component: a declarative, serializable handle
// to browser persistence. It is a THIN layer over the engine's existing serializers
// and browser-native storage — it invents no value-serialization convention:
//   • arbitrary key/values          → JSON-serializable (idb also stores binary)
//   • auto-mirror a linked data-layer → DataLayerSerializer (+ DataLayer.setAll)
//   • nexus snapshots                → serializeComponentRecursive / deserializeScene
//
// One unified async key/value surface fronts four backends (local/session/cookie/
// idb); File System Access is exposed separately as gesture-gated export/import.
import { ComponentUnique, getActiveScene, serializeComponentRecursive, deserializeScene, DataLayerSerializer, } from 'omosuen';
import { fullKey, nsPrefix } from './keys.js';
import { webStorageBackend } from './backends/local.js';
import { cookieBackend } from './backends/cookie.js';
import { idbBackend } from './backends/indexeddb.js';
import { exportToFile, importFromFile } from './backends/file.js';
const TYPE = 'browser-local-storage';
const PROPERTY_ALLOWLIST = [
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
const idbCache = new Map();
function resolveBackend(c, opts) {
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
const mirrorTimers = new Map();
function mirrorKey(c) {
    return c.mirror?.key ?? `mirror:${c.mirror?.dataLayer}`;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolveMirrorDataLayer(c) {
    if (!c.mirror)
        return null;
    const scene = getActiveScene();
    if (!scene)
        return null;
    const dl = scene.getComponentByName(c.mirror.dataLayer, true);
    if (!dl || dl.type !== 'data-layer')
        return null;
    return dl;
}
async function hydrateMirror(c) {
    if (!c.mirror)
        return;
    const dl = resolveMirrorDataLayer(c);
    if (!dl) {
        console.warn(`[browser-local-storage] '${c.name}' mirror data-layer '${c.mirror.dataLayer}' not found; skipping hydrate`);
        return;
    }
    const backend = resolveBackend(c, { backend: c.mirror.backend });
    const stored = await backend.get(fullKey(c.namespace, mirrorKey(c)));
    if (stored == null)
        return;
    // Rehydrate through the data-layer's own serializer (Vectors tagged/restored),
    // then push values into the live data-layer via its public setAll.
    const result = DataLayerSerializer.deserialize(stored);
    const temp = result?.component;
    if (!temp || !(temp.storage instanceof Map))
        return;
    dl.setAll(Object.fromEntries(temp.storage));
}
async function saveMirror(c) {
    if (!c.mirror)
        return false;
    const dl = resolveMirrorDataLayer(c);
    if (!dl)
        return false;
    const backend = resolveBackend(c, { backend: c.mirror.backend });
    const serialized = DataLayerSerializer.serialize(dl);
    return backend.set(fullKey(c.namespace, mirrorKey(c)), serialized);
}
// ─── Builder ────────────────────────────────────────────────────────────────
function builder(options) {
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
    };
}
// ─── Methods (proxy-dispatched; the component is passed as the first arg) ──────
const methods = {
    type: TYPE,
    async init(component) {
        const c = component;
        if (c.mirror)
            await hydrateMirror(c);
    },
    update(component, deltaTime) {
        const c = component;
        if (!c.mirror || c.id === undefined)
            return;
        const interval = c.mirror.autosaveMs ?? 1000;
        const next = (mirrorTimers.get(c.id) ?? 0) + deltaTime;
        if (next >= interval) {
            mirrorTimers.set(c.id, 0);
            void saveMirror(c);
        }
        else {
            mirrorTimers.set(c.id, next);
        }
    },
    dispose(component) {
        const c = component;
        c._disposed = true;
        if (c.id !== undefined)
            mirrorTimers.delete(c.id);
        if (c.mirror)
            void saveMirror(c);
    },
    // ── Unified key/value ──
    set(component, key, value, opts) {
        const c = component;
        return resolveBackend(c, opts).set(fullKey(c.namespace, key), value);
    },
    get(component, key, opts) {
        const c = component;
        return resolveBackend(c, opts).get(fullKey(c.namespace, key));
    },
    remove(component, key, opts) {
        const c = component;
        return resolveBackend(c, opts).remove(fullKey(c.namespace, key));
    },
    has(component, key, opts) {
        const c = component;
        return resolveBackend(c, opts).has(fullKey(c.namespace, key));
    },
    keys(component, opts) {
        const c = component;
        return resolveBackend(c, opts).keys(nsPrefix(c.namespace));
    },
    clear(component, opts) {
        const c = component;
        return resolveBackend(c, opts).clear(nsPrefix(c.namespace));
    },
    // ── Nexus snapshots (whole-tree; works on any nexus, not just the scene root) ──
    saveNexus(component, nexus, key, opts) {
        const c = component;
        const data = serializeComponentRecursive(nexus);
        return resolveBackend(c, opts).set(fullKey(c.namespace, key), data);
    },
    /**
     * Restores a snapshot into a deserialized nexus (IDs continued via the engine's
     * counter). v1 is scene-replace oriented — pair with `switchScene`; it does not
     * re-ID for insertion into a still-live scene. Returns null if absent/invalid.
     */
    async loadNexus(component, key, opts) {
        const c = component;
        const data = await resolveBackend(c, opts).get(fullKey(c.namespace, key));
        if (data == null)
            return null;
        return deserializeScene(data);
    },
    // ── File System Access (gesture-gated) ──
    exportToFile(_component, payload, suggestedName) {
        return exportToFile(payload, suggestedName);
    },
    importFromFile(_component) {
        return importFromFile();
    },
    // ── Auto-mirror (manual trigger; hydrate happens on init) ──
    saveMirror(component) {
        return saveMirror(component);
    },
};
// ─── Serializer (persists CONFIG only; stored data lives in the browser) ──────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serialize(component) {
    const c = component;
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
function deserialize(data) {
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
    const d = data;
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
const serializer = { serialize, deserialize };
/**
 * The full plugin definition. Pass to
 * `Omosuen.init({ plugins: [browserLocalStorageDefinition] })` (TS path) or register
 * it from the self-registering JS file (see browser.ts).
 */
export const browserLocalStorageDefinition = {
    type: TYPE,
    builder: builder,
    methods: methods,
    propertyAllowlist: PROPERTY_ALLOWLIST,
    serializer,
};
