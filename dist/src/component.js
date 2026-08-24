// The `aseprite-loader` plugin component: a declarative, serializable handle to a
// .aseprite file. On init it statically fetches + parses the file and builds the
// entity's sprites + animation-controller + texture-maps into its own nexus (all
// flagged `_generated`, so the scene serializer keeps only this declaration and
// the pixels/atlas regenerate on load). Same fully-static `filePath` convention
// as the engine's audio-track / texture-map.
import { ComponentUnique, castTo, getActiveScene, } from 'omosuen';
import { importAseprite, importAsepriteSources } from './import.js';
const TYPE = 'aseprite-loader';
const PROPERTY_ALLOWLIST = [
    'filePath',
    'sources',
    'flatten',
    'visibleOnly',
    'packageId',
    'layerSlots',
    'anchorMode',
];
function builder(options) {
    return {
        type: TYPE,
        name: options.name,
        unique: ComponentUnique.LOCAL,
        parent: null,
        _disposed: false,
        filePath: options.filePath ?? '',
        sources: options.sources,
        flatten: options.flatten ?? true,
        visibleOnly: options.visibleOnly ?? true,
        packageId: options.packageId ?? options.name,
        layerSlots: options.layerSlots,
        anchorMode: options.anchorMode ?? 'center',
    };
}
/**
 * Multi-file init: resolve each source's effective options against the loader
 * defaults into a keyed entries map, then hand them + the set-level `flatten`/
 * `layerSlots` to `importAsepriteSources`. Fetching is deferred to the importer
 * so repeat spawns of the same art set (blueprint fast-path) never touch the
 * network.
 */
async function initFromSources(a, parent, atlasManager, sceneRoot) {
    const entries = {};
    for (const [key, s] of Object.entries(a.sources ?? {})) {
        const opts = typeof s === 'string' ? { filePath: s } : s;
        entries[key] = {
            filePath: opts.filePath,
            visibleOnly: opts.visibleOnly ?? a.visibleOnly,
        };
    }
    if (Object.keys(entries).length === 0) {
        console.warn(`[aseprite-loader] '${a.name}' has no sources; nothing imported`);
        return;
    }
    await importAsepriteSources(entries, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        parent: parent,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        atlasManager: atlasManager,
        // Shared texture-maps + animation-map live on the scene root so they outlive
        // any single entity's dispose/re-skin.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sharedParent: sceneRoot,
        packageId: a.packageId,
        anchorMode: a.anchorMode,
        flatten: a.flatten,
        layerSlots: a.layerSlots,
    });
}
const methods = {
    type: TYPE,
    async init(component) {
        const a = component;
        if (!a.parent) {
            console.warn(`[aseprite-loader] Cannot initialize '${a.name}' - no parent nexus`);
            return;
        }
        const parent = castTo(a.parent);
        const scene = getActiveScene();
        if (!scene) {
            console.warn(`[aseprite-loader] Cannot initialize '${a.name}' - no active scene`);
            return;
        }
        const atlasManager = scene.getComponentByType('atlas-manager', true);
        if (!atlasManager) {
            console.warn(`[aseprite-loader] '${a.name}' found no atlas-manager in the scene; cannot ingest`);
            return;
        }
        try {
            if (a.sources && Object.keys(a.sources).length > 0) {
                await initFromSources(a, parent, atlasManager, scene);
            }
            else {
                const response = await fetch(a.filePath);
                if (!response.ok) {
                    console.error(`[aseprite-loader] Failed to fetch '${a.filePath}' for '${a.name}': ${response.status} ${response.statusText}`);
                    return;
                }
                const buffer = await response.arrayBuffer();
                await importAseprite(buffer, {
                    parent,
                    atlasManager,
                    packageId: a.packageId,
                    flatten: a.flatten,
                    visibleOnly: a.visibleOnly,
                    layerSlots: a.layerSlots,
                    anchorMode: a.anchorMode,
                });
            }
        }
        catch (error) {
            console.error(`[aseprite-loader] Failed to import '${a.name}'`, error);
        }
    },
    dispose(component) {
        component._disposed = true;
    },
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serialize(component) {
    const a = component;
    return {
        type: TYPE,
        name: a.name,
        filePath: a.filePath,
        sources: a.sources,
        flatten: a.flatten,
        visibleOnly: a.visibleOnly,
        packageId: a.packageId,
        layerSlots: a.layerSlots,
        anchorMode: a.anchorMode,
    };
}
function deserialize(data) {
    if (!data || typeof data !== 'object') {
        return {
            component: null,
            errors: [
                {
                    code: 'INVALID_DATA',
                    message: 'aseprite-loader deserialize received non-object data',
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
                { code: 'MISSING_NAME', message: 'aseprite-loader requires a name' },
            ],
        };
    }
    const hasFilePath = typeof d.filePath === 'string' && d.filePath.length > 0;
    const hasSources = d.sources !== null &&
        typeof d.sources === 'object' &&
        !Array.isArray(d.sources) &&
        Object.keys(d.sources).length > 0;
    if (!hasFilePath && !hasSources) {
        return {
            component: null,
            errors: [
                {
                    code: 'MISSING_FILEPATH',
                    message: 'aseprite-loader requires a filePath or a non-empty sources map',
                },
            ],
        };
    }
    return {
        component: builder({
            name: d.name,
            filePath: d.filePath,
            sources: d.sources,
            flatten: d.flatten,
            visibleOnly: d.visibleOnly,
            packageId: d.packageId,
            layerSlots: d.layerSlots,
            anchorMode: d.anchorMode,
        }),
        errors: [],
    };
}
const serializer = { serialize, deserialize };
/**
 * The full plugin definition. Pass to
 * `Omosuen.init({ plugins: [asepriteLoaderDefinition] })` (TS path) or register
 * it from the self-registering JS file (see browser.ts).
 */
export const asepriteLoaderDefinition = {
    type: TYPE,
    // builder requires `filePath`; the registry's builder type takes the looser
    // ComponentOptions, so bridge through unknown (runtime options carry filePath).
    builder: builder,
    methods,
    propertyAllowlist: PROPERTY_ALLOWLIST,
    serializer,
};
