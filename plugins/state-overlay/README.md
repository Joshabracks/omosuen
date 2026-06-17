# omosuen-state-overlay

Official [Omosuen](https://github.com/Joshabracks/omosuen) **plugin component**:
reactive DOM overlays powered by [State Street](https://github.com/Joshabracks/State-Street),
driven by the Omosuen engine loop (no second `requestAnimationFrame`).

State Street is vendored (zero-dependency) under `vendor/`, so this plugin is
self-contained and the Omosuen core stays dependency-free.

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

Lifecycle: `init` attaches the container; `update` lazily builds the State Street
instance (so bundles can register late) then ticks `mountCheck()` + `update()`;
`dispose` calls `state.destroy()` and removes the container.

## License

ISC. Bundled State Street is © its authors (see `vendor/state-street/LICENSE`).
