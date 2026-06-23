// The `aseprite-loader` plugin component: a declarative, serializable handle to a
// .aseprite file. On init it statically fetches + parses the file and builds the
// entity's sprites + animation-controller + texture-maps into its own nexus (all
// flagged `_generated`, so the scene serializer keeps only this declaration and
// the pixels/atlas regenerate on load). Same fully-static `filePath` convention
// as the engine's audio-track / texture-map.
import { ComponentUnique, castTo, getActiveScene, } from 'omosuen';
import { importAseprite } from './import.js';
const TYPE = 'aseprite-loader';
const PROPERTY_ALLOWLIST = [
    'filePath',
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
        filePath: options.filePath,
        flatten: options.flatten ?? true,
        visibleOnly: options.visibleOnly ?? true,
        packageId: options.packageId ?? options.name,
        layerSlots: options.layerSlots,
        anchorMode: options.anchorMode ?? 'center',
    };
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
        catch (error) {
            console.error(`[aseprite-loader] Failed to import '${a.filePath}'`, error);
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
    if (typeof d.filePath !== 'string' || d.filePath.length === 0) {
        return {
            component: null,
            errors: [
                {
                    code: 'MISSING_FILEPATH',
                    message: 'aseprite-loader requires a filePath',
                },
            ],
        };
    }
    return {
        component: builder({
            name: d.name,
            filePath: d.filePath,
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
