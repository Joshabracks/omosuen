// The `state-overlay` plugin component: a reactive DOM overlay backed by a
// State Street (https://github.com/Joshabracks/State-Street) instance. A
// `state.data` mutation schedules exactly one coalesced render via State
// Street's own on-demand scheduling (v3.0.0+) -- independent of the Omosuen
// engine loop; there's no per-frame Omosuen dispatch into this component at
// all once its State instance is built.
//
// State Street is vendored (zero-dependency) under ../vendor/state-street; this
// plugin owns it, so the Omosuen core stays dependency-free.

import { State } from '../vendor/state-street/index.js';
import type {
  ComponentData,
  ComponentOptions,
  ComponentMethods,
  ComponentSerializer,
  ComponentTypeDefinition,
} from 'omosuen';

/**
 * A State Street configuration bundle: the same four arguments State Street's
 * constructor takes. Registered by key (see {@link registerStateBundle}) and
 * referenced from a state-overlay component's `bundleKey` — mirrors how the
 * built-in ui-overlay references a registered HTML constructor by key.
 */
export interface StateBundle {
  template: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  components?: Record<string, (ctx: any) => string>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  methods?: Record<string, (ctx: any) => void | string>;
}

const bundles: Record<string, StateBundle> = {};

// Callbacks waiting on a bundle key that hasn't registered yet (see
// onBundleAvailable). Drained and cleared the moment that key registers.
const bundleWaiters: Record<string, Array<(bundle: StateBundle) => void>> = {};

/**
 * Registers a State Street UI bundle under a key. May be called before OR
 * after a state-overlay component with this `bundleKey` is created --
 * `onBundleAvailable` resolves either ordering.
 */
export function registerStateBundle(key: string, bundle: StateBundle): void {
  bundles[key] = bundle;
  const waiters = bundleWaiters[key];
  if (waiters) {
    delete bundleWaiters[key];
    for (const cb of waiters) cb(bundle);
  }
}

/**
 * Resolves a bundle by key: calls `cb` synchronously if it's already
 * registered, otherwise queues `cb` to run whenever `registerStateBundle`
 * eventually registers that key. Returns an unsubscribe function that removes
 * a still-pending `cb` (used at dispose time so a never-arriving bundle
 * doesn't leak a closure over a disposed component).
 */
function onBundleAvailable(
  key: string,
  cb: (bundle: StateBundle) => void,
): () => void {
  const existing = bundles[key];
  if (existing) {
    cb(existing);
    return () => {};
  }
  const list = (bundleWaiters[key] ??= []);
  list.push(cb);
  return () => {
    const idx = list.indexOf(cb);
    if (idx !== -1) list.splice(idx, 1);
  };
}

export interface StateOverlayOptions extends ComponentOptions {
  bundleKey?: string;
  cssOverrides?: Record<string, string>;
}

export interface StateOverlayT extends ComponentData {
  type: 'state-overlay';
  container: HTMLElement;
  bundleKey?: string;
  cssOverrides: Record<string, string>;
  // The State Street instance; built as soon as its bundle is available (see
  // onBundleAvailable) -- immediately at init() if already registered, or via
  // a one-shot callback if the bundle registers later.
  state: State | null;
  // Unsubscribes a still-pending onBundleAvailable callback; set only while
  // waiting on a bundle that hasn't registered yet. Called at dispose so a
  // never-arriving bundle doesn't leak a closure over a disposed component.
  _unsubscribeBundleWait?: () => void;
}

const PROPERTY_ALLOWLIST: string[] = [
  'container',
  'bundleKey',
  'cssOverrides',
  'state',
  '_unsubscribeBundleWait',
];

function builder(options: StateOverlayOptions): StateOverlayT {
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
  } as StateOverlayT;
}

const methods: ComponentMethods = {
  type: 'state-overlay',

  async init(component: ComponentData): Promise<void> {
    const s = component as StateOverlayT;
    // Attach the container first -- State's constructor calls mountCheck()
    // internally and needs a connected element to mount into.
    if (s.container && !s.container.parentNode) {
      document.body.appendChild(s.container);
    }

    if (!s.bundleKey) return; // nothing to build

    // Resolves immediately if the bundle is already registered (the common
    // case), or later via a one-shot callback if it registers after this
    // component was created. Must not await -- a missing/mistyped bundleKey
    // must not hang scene init.
    s._unsubscribeBundleWait = onBundleAvailable(s.bundleKey, (bundle) => {
      if (s.state) return; // already built (defensive; shouldn't recur)
      s.state = new State(
        bundle.template,
        bundle.data ?? {},
        bundle.components ?? {},
        bundle.methods ?? {},
        { autoRender: true, mountTarget: s.container, mountOnAvailable: false },
      );
    });
    if (!bundles[s.bundleKey]) {
      console.warn(
        `[state-overlay] bundle '${s.bundleKey}' not registered yet for '${s.name}'. ` +
          `Will build automatically once registerStateBundle('${s.bundleKey}', ...) is called.`,
      );
    }
  },

  // No update() -- once built, State Street schedules its own on-demand
  // renders directly off state.data mutations (see the module doc comment).
  // Omitting the key entirely (not just a no-op function) means this
  // component type never has update-pass work dispatched to it.

  dispose(component: ComponentData): void {
    const s = component as StateOverlayT;
    s._unsubscribeBundleWait?.();
    s._unsubscribeBundleWait = undefined;
    if (s.state) {
      s.state.destroy();
      s.state = null;
    }
    if (s.container && s.container.parentNode) {
      s.container.parentNode.removeChild(s.container);
    }
    s._disposed = true;
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serialize(component: ComponentData): any {
  const s = component as StateOverlayT;
  return {
    type: 'state-overlay',
    name: s.name,
    bundleKey: s.bundleKey,
    cssOverrides: Object.keys(s.cssOverrides).length ? s.cssOverrides : undefined,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deserialize(data: any): { component: StateOverlayT | null; errors: { code: string; message: string }[] } {
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

const serializer: ComponentSerializer = {
  serialize,
  deserialize,
};

/**
 * The full plugin definition. Pass to `Omosuen.init({ plugins: [stateOverlayDefinition] })`
 * (TS path) or register it from a self-registering JS file (see browser.ts).
 */
export const stateOverlayDefinition: ComponentTypeDefinition = {
  type: 'state-overlay',
  builder: builder as ComponentTypeDefinition['builder'],
  methods,
  propertyAllowlist: PROPERTY_ALLOWLIST,
  serializer,
};
