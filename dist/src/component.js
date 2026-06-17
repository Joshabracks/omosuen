// The `state-overlay` plugin component: a reactive DOM overlay backed by a
// State Street (https://github.com/Joshabracks/State-Street) instance, driven by
// the Omosuen engine loop instead of State Street's own requestAnimationFrame.
//
// State Street is vendored (zero-dependency) under ../vendor/state-street; this
// plugin owns it, so the Omosuen core stays dependency-free.
import { State } from '../vendor/state-street/index.js';
const bundles = {};
/**
 * Registers a State Street UI bundle under a key. Call before the scene that
 * uses a state-overlay with this `bundleKey` is loaded.
 */
export function registerStateBundle(key, bundle) {
    bundles[key] = bundle;
}
const PROPERTY_ALLOWLIST = [
    'container',
    'bundleKey',
    'cssOverrides',
    'state',
    '_stateBuilt',
];
function builder(options) {
    const container = document.createElement('div');
    container.id = options.name.replace(/\s/g, '');
    container.style.zIndex = '1000';
    if (options.cssOverrides) {
        for (const key of Object.keys(options.cssOverrides)) {
            // @ts-expect-error indexable style write
            container.style[key] = options.cssOverrides[key];
        }
    }
    return {
        type: 'state-overlay',
        name: options.name,
        parent: null,
        container,
        bundleKey: options.bundleKey,
        cssOverrides: options.cssOverrides ?? {},
        state: null,
        _stateBuilt: false,
    };
}
const methods = {
    type: 'state-overlay',
    async init(component) {
        const s = component;
        // Attach the container so State Street has a live mount target.
        if (s.container && !s.container.parentNode) {
            document.body.appendChild(s.container);
        }
    },
    update(component, _deltaTime) {
        const s = component;
        // Lazily construct the State instance on first update (the bundle may have
        // been registered after builder ran). renderLoop:false → the Omosuen loop
        // drives it; mountTarget is this component's container.
        if (!s._stateBuilt) {
            if (!s.bundleKey) {
                s._stateBuilt = true; // nothing to build
                return;
            }
            const bundle = bundles[s.bundleKey];
            if (!bundle) {
                console.warn(`[state-overlay] bundle '${s.bundleKey}' not registered for '${s.name}'. ` +
                    `Call registerStateBundle('${s.bundleKey}', ...) before loading this component.`);
                s._stateBuilt = true; // don't retry every frame
                return;
            }
            s.state = new State(bundle.template, bundle.data ?? {}, bundle.components ?? {}, bundle.methods ?? {}, { renderLoop: false, mountTarget: s.container });
            s._stateBuilt = true;
        }
        // Drive State Street from the engine loop (no second rAF): mountCheck()
        // attaches/repairs the mount, update() applies dep-gated re-renders.
        if (s.state) {
            s.state.mountCheck();
            s.state.update();
        }
    },
    dispose(component) {
        const s = component;
        if (s.state) {
            s.state.destroy();
            s.state = null;
        }
        if (s.container && s.container.parentNode) {
            s.container.parentNode.removeChild(s.container);
        }
        s._stateBuilt = false;
        s._disposed = true;
    },
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serialize(component) {
    const s = component;
    return {
        type: 'state-overlay',
        name: s.name,
        bundleKey: s.bundleKey,
        cssOverrides: Object.keys(s.cssOverrides).length ? s.cssOverrides : undefined,
    };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deserialize(data) {
    if (!data || typeof data !== 'object') {
        return {
            component: null,
            errors: [{ code: 'INVALID_DATA', message: 'state-overlay deserialize received non-object data' }],
        };
    }
    if (data.type !== 'state-overlay') {
        return {
            component: null,
            // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
            errors: [{ code: 'TYPE_MISMATCH', message: `type ${data.type} does not match "state-overlay"` }],
        };
    }
    if (!data.name) {
        return { component: null, errors: [{ code: 'MISSING_NAME', message: 'state-overlay requires a name' }] };
    }
    return {
        component: builder({
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            name: data.name,
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            bundleKey: data.bundleKey,
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            cssOverrides: data.cssOverrides,
        }),
        errors: [],
    };
}
const serializer = {
    serialize,
    deserialize,
};
/**
 * The full plugin definition. Pass to `Omosuen.init({ plugins: [stateOverlayDefinition] })`
 * (TS path) or register it from a self-registering JS file (see browser.ts).
 */
export const stateOverlayDefinition = {
    type: 'state-overlay',
    builder: builder,
    methods,
    propertyAllowlist: PROPERTY_ALLOWLIST,
    serializer,
};
