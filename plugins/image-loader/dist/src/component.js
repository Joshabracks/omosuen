// The `image-loader` plugin component: a declarative, serializable handle to a
// .aseprite file. On init it statically fetches + parses the file and builds the
// entity's sprites + animation-controller + texture-maps into its own nexus (all
// flagged `_generated`, so the scene serializer keeps only this declaration and
// the pixels/atlas regenerate on load). Same fully-static `filePath` convention
// as the engine's audio-track / texture-map.
import { ComponentUnique, castTo, getActiveScene } from 'omosuen';
import { importImages } from './images.js';
import { AsepriteSession, } from './session.js';
const TYPE = 'image-loader';
const PROPERTY_ALLOWLIST = [
    'filePath',
    'images',
    'imageType',
    'sources',
    'flatten',
    'visibleOnly',
    'layers',
    'frames',
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
        images: options.images,
        imageType: options.imageType,
        sources: options.sources,
        flatten: options.flatten ?? true,
        visibleOnly: options.visibleOnly ?? true,
        layers: options.layers,
        frames: options.frames,
        packageId: options.packageId ?? options.name,
        layerSlots: options.layerSlots,
        anchorMode: options.anchorMode ?? 'center',
    };
}
/**
 * Each Aseprite loader's live session (selection + held frames). Keyed by
 * component id, not object identity: `init` can receive the component's Proxy
 * while proxy method calls (`loader.extend(...)`) dispatch with the raw object,
 * so the two never compare equal. A promise, so an `extend` issued before init
 * finishes waits for it instead of being lost.
 */
const sessionsById = new Map();
const sessionsByRef = new WeakMap();
const sessions = {
    get(c) {
        return c.id !== undefined ? sessionsById.get(c.id) : sessionsByRef.get(c);
    },
    set(c, p) {
        if (c.id !== undefined)
            sessionsById.set(c.id, p);
        else
            sessionsByRef.set(c, p);
    },
    delete(c) {
        if (c.id !== undefined)
            sessionsById.delete(c.id);
        else
            sessionsByRef.delete(c);
    },
};
/**
 * Multi-file init: resolve each source's effective options against the loader
 * defaults, then build one set-mode session. Files are fetched + indexed once
 * per URL (cached), so repeat spawns of the same art set never touch the
 * network.
 */
function sourcesSpecs(a) {
    return Object.entries(a.sources ?? {}).map(([key, s]) => {
        const opts = typeof s === 'string' ? { filePath: s } : s;
        return {
            key,
            filePath: opts.filePath,
            visibleOnly: opts.visibleOnly ?? a.visibleOnly,
            layers: opts.layers ?? a.layers,
            frames: opts.frames ?? a.frames,
        };
    });
}
async function startSession(a, parent, atlasManager, scene) {
    const common = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        parent: parent,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        atlasManager: atlasManager,
        packageId: a.packageId,
        flatten: a.flatten,
        anchorMode: a.anchorMode,
        layerSlots: a.layerSlots,
    };
    if (a.sources && Object.keys(a.sources).length > 0) {
        // Shared texture-maps + animation-map live on the scene root so they outlive
        // any single entity's dispose/re-skin.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return AsepriteSession.create(sourcesSpecs(a), { ...common, mode: 'set', sharedParent: scene });
    }
    return AsepriteSession.create([{ key: '', filePath: a.filePath, visibleOnly: a.visibleOnly, layers: a.layers, frames: a.frames }], { ...common, mode: 'single' });
}
async function withSession(component, verb, fn) {
    const pending = sessions.get(component);
    const session = pending ? await pending : null;
    if (!session) {
        console.warn(`[image-loader] '${component.name}' ${verb}: no Aseprite import to change`);
        return;
    }
    await fn(session);
}
const methods = {
    type: TYPE,
    extend(component, change) {
        return withSession(component, 'extend', (s) => s.extend(change));
    },
    release(component, change) {
        return withSession(component, 'release', (s) => s.release(change));
    },
    async init(component) {
        const a = component;
        // A re-init replaces the previous import: give its frames back first.
        const previous = sessions.get(component);
        sessions.delete(component);
        if (previous)
            (await previous)?.dispose();
        if (!a.parent) {
            console.warn(`[image-loader] Cannot initialize '${a.name}' - no parent nexus`);
            return;
        }
        const parent = castTo(a.parent);
        const scene = getActiveScene();
        if (!scene) {
            console.warn(`[image-loader] Cannot initialize '${a.name}' - no active scene`);
            return;
        }
        const atlasManager = scene.getComponentByType('atlas-manager', true);
        if (!atlasManager) {
            console.warn(`[image-loader] '${a.name}' found no atlas-manager in the scene; cannot ingest`);
            return;
        }
        try {
            if (a.images && Object.keys(a.images).length > 0) {
                await importImages({
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    parent: parent,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    atlasManager: atlasManager,
                    packageId: a.packageId,
                    images: a.images,
                    imageType: a.imageType,
                    anchorMode: a.anchorMode,
                });
            }
            else {
                const pending = startSession(a, parent, atlasManager, scene).catch((error) => {
                    console.error(`[image-loader] Failed to import '${a.name}'`, error);
                    return null;
                });
                sessions.set(component, pending);
                const session = await pending;
                // Disposed while loading: hand back whatever the import just took.
                if (session && component._disposed)
                    session.dispose();
            }
        }
        catch (error) {
            console.error(`[image-loader] Failed to import '${a.name}'`, error);
        }
    },
    dispose(component) {
        component._disposed = true;
        const pending = sessions.get(component);
        sessions.delete(component);
        // Gives every frame reference back, so shared frames no other entity uses
        // leave their texture-maps (and the atlas reclaims them on its next compile).
        if (pending)
            void pending.then((s) => s?.dispose());
    },
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serialize(component) {
    const a = component;
    return {
        type: TYPE,
        name: a.name,
        filePath: a.filePath,
        // URL-only by construction (see ImageLoaderOptions.images) so this round-trips.
        images: a.images,
        // `ImageType` is duck-typed on both sides (isFrameMap/isGridConfig test for
        // Array-ness and for `cellSize`/`gridSize` keys), and every reader touches
        // only .x/.y/.z/.w — so plain JSON objects survive the trip as-is.
        imageType: a.imageType,
        sources: serializableSources(a.sources),
        flatten: a.flatten,
        visibleOnly: a.visibleOnly,
        // The declared selection only — runtime `extend`/`release` changes aren't
        // saved, and a predicate `layers` can't be (the load falls back to visibleOnly).
        layers: serializableLayers(a.layers),
        frames: a.frames,
        packageId: a.packageId,
        layerSlots: a.layerSlots,
        anchorMode: a.anchorMode,
    };
}
function serializableLayers(layers) {
    return Array.isArray(layers) ? [...layers] : undefined;
}
function serializableSources(sources) {
    if (!sources)
        return sources;
    const out = {};
    for (const [key, s] of Object.entries(sources)) {
        out[key] = typeof s === 'string' ? s : { ...s, layers: serializableLayers(s.layers) };
    }
    return out;
}
function isNonEmptyMap(value) {
    return (value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        Object.keys(value).length > 0);
}
function deserialize(data) {
    if (!data || typeof data !== 'object') {
        return {
            component: null,
            errors: [
                {
                    code: 'INVALID_DATA',
                    message: 'image-loader deserialize received non-object data',
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
                { code: 'MISSING_NAME', message: 'image-loader requires a name' },
            ],
        };
    }
    const hasFilePath = typeof d.filePath === 'string' && d.filePath.length > 0;
    const hasSources = isNonEmptyMap(d.sources);
    const hasImages = isNonEmptyMap(d.images);
    if (!hasFilePath && !hasSources && !hasImages) {
        return {
            component: null,
            errors: [
                {
                    code: 'MISSING_FILEPATH',
                    message: 'image-loader requires a filePath, a non-empty sources map, or a non-empty images map',
                },
            ],
        };
    }
    return {
        component: builder({
            name: d.name,
            filePath: d.filePath,
            images: d.images,
            imageType: d.imageType,
            sources: d.sources,
            flatten: d.flatten,
            visibleOnly: d.visibleOnly,
            layers: Array.isArray(d.layers) ? d.layers : undefined,
            frames: Array.isArray(d.frames) ? d.frames : undefined,
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
 * `Omosuen.init({ plugins: [imageLoaderDefinition] })` (TS path) or register
 * it from the self-registering JS file (see browser.ts).
 */
export const imageLoaderDefinition = {
    type: TYPE,
    // builder requires `filePath`; the registry's builder type takes the looser
    // ComponentOptions, so bridge through unknown (runtime options carry filePath).
    builder: builder,
    methods,
    propertyAllowlist: PROPERTY_ALLOWLIST,
    serializer,
};
