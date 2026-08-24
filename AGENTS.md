# AGENTS.md — Omosuen

Guidance for coding assistants working in this repo. Read this before writing engine code;
Omosuen's component model is data-oriented and Proxy-dispatched, so habits from
class/inheritance-based engines will produce broken code if applied blindly.

## Mental model — what Omosuen is (and isn't)

- It's an **axonometric WebGL2 game engine** shipped as a self-contained UMD global
  (`Omosuen`) plus an npm/ESM package. Built from TypeScript; hot paths run in **Rust→WASM**.
- Game visuals render through `viewport` + `camera` (WebGL2). On-screen DOM UI is either the
  `ui-overlay` component (plain `innerHTML` + event bindings) or the **State Street plugin**
  (`state-overlay`) for data-bound UI.
- Components are **plain data objects**, not class instances. Behavior lives in a central
  registry and is dispatched through a Proxy. Don't reach for classes/inheritance.
- The engine is **dependency-free by design.** Do not add runtime/algorithm npm or Cargo
  deps; port needed algorithms in-house. Build tooling (webpack, ts-loader, wasm-bindgen) is
  fine. See [.claude/best-practices/wasm-in-omosuen.md](.claude/best-practices/wasm-in-omosuen.md).

## The component pattern (read this first)

Each component type lives in `src/component/<type>/` as:
- `data.ts` — the `<Type>T` data interface, a `builder(options)` that returns a **plain data
  object**, a `PROPERTY_ALLOWLIST`, and a serializer.
- `methods.ts` — a `<Type>Methods` object of functions whose **first parameter is the
  component** (e.g. `setFrame(sprite, index)`).
- `index.ts` — re-exports.

At runtime `newComponent()` wraps the data object in a Proxy
([src/component/types.ts](src/component/types.ts) `wrapInProxy`). The Proxy:
- exposes a **method** when the name is in the type's `MethodRegistry` entry, dispatching
  `MethodRegistry[type][name](component, ...args)` — so callers write `component.method(args)`
  (the component arg is bound for them);
- exposes a **data property** only if it's in the base set or that type's
  `PROPERTY_ALLOWLIST`.

### ⚠️ The #1 gotcha: PROPERTY_ALLOWLIST

When you add a data field to a component's `<Type>T` interface, you **must** also add the
field name to that component's `PROPERTY_ALLOWLIST` in the same `data.ts`. Otherwise the
Proxy intercepts reads of that field as a method lookup and you get runtime errors like
`"<type> has no method named X"` / `"X is not a function"`. This applies to **every**
`src/component/*/data.ts`.

## Creating and using components

```js
const scene = await Omosuen.newComponent('nexus', { name: 'Scene' });
const sprite = await Omosuen.newComponent('sprite', { name: 'Hero', /* options */ });
scene.addComponent(sprite);

sprite.setFrame(0);                       // method call → dispatched via the Proxy
const cam = scene.getComponentByType('camera');   // explicit query
const allSprites = scene.sprites;                 // nexus shorthand (plural type)
```

- `newComponent(type, options, parent?)` is **async** and returns the wrapped component (or
  `null`). Add it to a nexus with `scene.addComponent(...)`.
- Nexus shorthand on a nexus proxy: `nexus.<pluralType>` → all of that type, `nexus.<type>` →
  first of that type, `nexus.<name>` → by name.
- `ComponentUnique` (FALSE / LOCAL / GLOBAL / NAME) governs how many instances may coexist; set
  it in the builder, not at call sites.

## Scene module pattern

A scene module exports `createScene()` returning a root nexus with components attached. Any
`registerHtmlConstructor` / `registerBinding` / `registerMethod` the scene needs go at module
top level (they run on import, before `createScene`).

```js
const Omosuen = window.Omosuen;
Omosuen.registerHtmlConstructor('hud', () => `<div id="hud">…</div>`);
Omosuen.registerBinding('onClick', (e) => { /* ... */ });

export async function createScene() {
  const scene = await Omosuen.newComponent('nexus', { name: 'Level 1' });
  const ui = await Omosuen.newComponent('ui-overlay', {
    name: 'HUD', htmlConstructorKey: 'hud',
    bindings: [{ selector: '#hud', onActions: ['click'], methodKey: 'onClick' }],
  });
  scene.addComponent(ui);
  return scene;
}
```

Register and activate it from your entry: `registerSceneModule(name, path)` then
`await switchScene(name)`. Boot order is always `await init()` → register → `switchScene` →
`start(fps)`.

## Messaging pattern

```js
Omosuen.registerMethod('message-listener', 'onText', (env) => { /* env.body, env.sender */ });
const bus = await Omosuen.newComponent('messenger', {
  name: 'Bus', listeners: [{ pattern: 'text', callbackKey: 'onText' }],
});
scene.addComponent(bus);
bus.send('text', null, { value: 'hi' });   // null receiver = broadcast
```

Listener callbacks are looked up from `MethodRegistry['message-listener']` by key — register
the function before the listener fires. Wildcards: `Omosuen.ALL_MESSAGES`, `Omosuen.ANY_MESSAGES`.

## Writing a plugin component

A plugin registers a brand-new component type from outside the core via a
`ComponentTypeDefinition`:

```ts
const def = {
  type: 'my-thing',
  builder: (options) => ({ /* plain data */ }),   // returns ComponentData
  methods: { type: 'my-thing', init, update, dispose },
  propertyAllowlist: ['foo', 'bar'],
  serializer: { serialize, deserialize },
};
```

Register it via the `plugins` init option (a `ComponentTypeDefinition`, or a filepath string
to a self-registering JS file that calls `Omosuen.registerPluginComponent(def)`), or call
`registerPluginComponent(def)` directly — **before** loading a scene that uses it.

If the plugin wraps a library with its own **perpetual polling** `requestAnimationFrame` loop
(one that ticks forever regardless of whether anything changed), **disable that loop and drive
it from the engine loop** in the component's `update(component, dt)` instead. This doesn't apply
to a library with genuinely on-demand/event-driven scheduling (e.g.
[plugins/state-overlay/](plugins/state-overlay/)'s State Street v3.0.0+, which schedules its own
render only in direct response to a state mutation and needs no per-frame driving at all —
`state-overlay`'s component type defines no `update()` method for exactly this reason). Official
plugins live in `plugins/<name>/`, are their own npm package `omosuen-<name>`, vendor their deps
under `vendor/`, and ship via the `plugin-release.yml` workflow (release = bump the plugin's
`package.json` version + merge).

## Constraints & gotchas

- **Dependency-free.** No runtime/algorithm libraries (npm or Cargo). In-house ports only.
- **`init` is async** — `await Omosuen.init(...)` before `switchScene`, especially when using
  the `plugins` option (it loads plugin files during init).
- **WASM init ordering.** The render WASM must be initialized before cell/mesh/solidity calls;
  `initRenderWasm()` is awaited in the cell-map builder/deserializer and camera init. There is
  **no JS fallback** — calls before init throw loudly (by design).
- **cell-map is windowed, not a whole-map buffer.** `CellWindow`/`ChunkColdStorage`
  (`src/component/cell-map/window.ts`/`cold-storage.ts`) keep only a resident window of chunks in
  the live WASM store; everything else lives compressed in cold storage. `cellMap.mapSize` means
  the **current window's size**, not the whole authored/generated map — don't assume it's a fixed,
  whole-map constant. `generateCell`/`generateChunk` must be a **pure function of their
  coordinates** for a given seed; the whole eviction/regeneration/cold-storage model relies on
  that determinism holding.
- **`registry.ts` pulls in the whole component graph, including camera's raw shader imports.**
  Any module that imports `MethodRegistry`/`registerMethod` from `component/registry.ts`
  transitively imports every component builder, including camera's `.vert`/`.frag` raw-string
  imports (webpack `raw-loader`-only). This means such a module can't be unit-tested via a bare
  `tsx test/*.test.ts` script the way WASM-only tests (`test:wasm*`) can — verify through the
  browser test harness instead (`npm run test`, or a throwaway `webpack --entry <file>` build run
  in a browser) if you need to exercise code that touches the registry.
- **`emissionColorMap`/`smoothingWeights` are windowed too**, via `AuxiliaryChannel`
  (`src/component/cell-map/auxiliary-channel.ts`) — a *synchronous* evict/assemble cycle hooked
  into `CellWindow`'s `onReassemble`, deliberately not integrated with `pendingShift`/`advance()`'s
  multi-frame staging, since neither channel has a procedural-generation cost. `setEmissionColor`/
  `getEmissionColor` take a world cell coordinate (not window-local) and fully support off-window
  writes. See `.design/cell-map-overhaul/18-secondary-dense-map-windowing.md`.
- **Naming conventions.** Module-level / reusable variables are `camelCase` (no underscore
  prefix). Functions `camelCase`, types `PascalCase` (enforced by eslint).
- **No `any`.** The engine eslint config errors on `@typescript-eslint/no-explicit-any` and
  requires explicit function return types.
- **No repo-wide release-process doc.** For wrapping up a multi-phase effort before a release,
  the established pattern is a `.design/<effort>/06-implementation-summary.md`-style doc (see
  `.design/chunk-buffering/` or `.design/cell-map-overhaul/`) — a plain-language summary of what
  shipped, what was verified, and what's still a known gap.

## Commands

```bash
npm run build:dev          # webpack dev bundle → test/dev/omosuen.js
npm run build              # dev + prod bundles
npm run lint               # eslint . --ext .ts  (must stay clean)
npm run test:wasm          # WASM solidity golden suite
npm run test:wasm-mesh     # WASM mesher golden suite
npm run test:wasm-audio    # WASM audio golden suite
```

Run the demo harness over HTTP (ES modules don't load from `file://`):
`npx serve test` then open `http://localhost:<port>/state-overlay-demo.html` (or another
page in [test/](test/)). The built engine bundle is loaded by the test HTML from `test/dev/`.
