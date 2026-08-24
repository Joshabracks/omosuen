# omosuen-state-overlay

Official [Omosuen](https://github.com/Joshabracks/omosuen) **plugin component**:
reactive DOM overlays powered by [State Street](https://github.com/Joshabracks/State-Street)
v3.0.0+. A `state.data` mutation schedules exactly one coalesced render via State
Street's own on-demand scheduling — independent of the Omosuen engine loop; there's
no per-frame Omosuen dispatch into a `state-overlay` component at all.

State Street is vendored (zero-dependency) under `vendor/`, so this plugin is
self-contained and the Omosuen core stays dependency-free.

**Note:** because rendering is driven by State Street's own scheduler rather than the
Omosuen loop, pausing the Omosuen engine loop does **not** pause `state-overlay`
re-renders — only a `state.data` mutation does (which can still happen from an
out-of-band DOM event handler, e.g. a `:click=...` bound method, even while the
engine loop is paused).

## Install

```
npm i github:joshabracks/omosuen#state-overlay0.0.1
```

## Use

```ts
import { stateOverlayDefinition, registerStateBundle } from 'omosuen-state-overlay';

// Register the plugin component type with the engine.
await Omosuen.init({ plugins: [stateOverlayDefinition] });

// Register a reactive UI bundle (State Street template/data/components/methods).
registerStateBundle('counter', {
  template: `<h1>Count: {{count}}</h1><button :click=inc()>+1</button>`,
  data: { count: 0 },
  methods: { inc: ({ state }) => { state.data.count += 1; } },
});

// Add a state-overlay component referencing the bundle.
const overlay = await Omosuen.newComponent('state-overlay', {
  name: 'Counter',
  bundleKey: 'counter',
});
scene.addComponent(overlay);
```

### No-bundler / free-form path

Load the prebuilt browser bundle after the Omosuen UMD script, or via the init
option with a filepath — it self-registers the component type and exposes
`window.OmosuenStateOverlay.registerStateBundle`:

```js
await Omosuen.init({ plugins: ['./state-overlay.plugin.js'] });
window.OmosuenStateOverlay.registerStateBundle('counter', { /* ... */ });
```

## Component: `state-overlay`

| Option | Type | Notes |
| --- | --- | --- |
| `name` | string | Component name (also the container element id). |
| `bundleKey` | string | Key of a bundle registered via `registerStateBundle`. |
| `cssOverrides` | Record<string,string> | Inline style overrides for the container. |

Lifecycle: `init` attaches the container, then builds the State Street instance
immediately if its `bundleKey` is already registered, or via a one-shot callback
once `registerStateBundle` is called for it (so bundles may still register after
the component is created). No `update` method — once built, State Street
schedules its own renders. `dispose` unsubscribes any still-pending bundle wait,
calls `state.destroy()`, and removes the container.

## License

ISC. Bundled State Street is © its authors (see `vendor/state-street/LICENSE`).
