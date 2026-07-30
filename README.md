# Omosuen

An axonometric game engine with an orbiting orthographic camera. *Etymology: **Omos**
(Greek: shoulder/axis) + **Suen** (Mesopotamian moon deity / measurement).*

Omosuen is a TypeScript engine that ships as a single self-contained UMD bundle. It
renders with WebGL2, runs hot paths (voxel meshing, visibility, audio time-stretch) in
**WASM compiled from Rust**, and is built around a data-oriented component tree.

## Highlights

- **Zero runtime dependencies.** Algorithms are hand-rolled/ported in-house; only build
  tooling (webpack, ts-loader, wasm toolchain) is external.
- **WASM-accelerated.** The render crate (cell store, greedy/smoothed meshing, solidity)
  and the audio crate (WSOLA pitch/tempo) are compiled to WASM and base64-embedded into the
  bundle at build time.
- **`file://` drop-in.** No external `.wasm` files, no `fetch`, no COOP/COEP — the UMD
  bundle runs straight off the filesystem.
- **Component + Nexus architecture.** Components are plain data; behavior is dispatched
  through a Proxy from a central method registry (data-oriented, not class instances).
- **Extensible.** Register methods, UI bindings, and whole new component types at runtime —
  including external **plugin components** (see [Official plugins](#official-plugins)).
- **Customizable voxel cells.** Per-side textures, per-cell-type smoothing, and custom per-cell
  meshes — with optional UVs and per-face coverage — all meshed (and smoothed) in WASM.

## Install

```bash
# npm / bundler — install a tagged engine release straight from GitHub
npm i github:joshabracks/omosuen#v0.24.0
```

```ts
// then import it in a bundler project — types + the wasm-embedded UMD runtime
import Omosuen, { start } from 'omosuen';
```

```html
<!-- or drop the UMD bundle in a page; defines the global `Omosuen` -->
<script src="omosuen.js"></script>
```

The production bundle (`omosuen.min.js`) is attached as an asset to each `v*` GitHub
Release. The same bundle (plus type declarations) ships inside the installable tag,
so `<script>` / `file://` users keep using the global `window.Omosuen` while bundler
users `import` it. Tags `v0.7.0`+ are npm-importable; older tags shipped source only.

## Quick start

Omosuen apps follow one shape: **initialize → register scene(s) → switch to a scene →
start the loop.** A "scene" is a module that exports `createScene()` returning a root
`nexus` with its components attached.

```html
<!-- index.html -->
<script src="omosuen.js"></script>
<script type="module" src="game.js"></script>
```

```js
// game.js
const Omosuen = window.Omosuen;

async function main() {
  await Omosuen.init();                                   // async — await before switchScene
  Omosuen.registerSceneModule('main', '/scenes/main.js'); // path served to the browser
  await Omosuen.switchScene('main');
  Omosuen.start(60);                                      // run the loop at 60 FPS
}

window.addEventListener('load', () => main());
```

```js
// scenes/main.js — registered UI + the scene factory
const Omosuen = window.Omosuen;

// HTML for a ui-overlay, referenced by key.
Omosuen.registerHtmlConstructor('mainUI', () => `
  <div style="position:absolute;inset:0;display:grid;place-items:center;color:#fff">
    <button id="hello">Say hello</button>
  </div>
`);

// Event handler for a binding, referenced by key.
Omosuen.registerBinding('sayHello', () => console.log('Hello from Omosuen!'));

export async function createScene() {
  const scene = await Omosuen.newComponent('nexus', { name: 'Main' });

  const ui = await Omosuen.newComponent('ui-overlay', {
    name: 'Main UI',
    htmlConstructorKey: 'mainUI',
    bindings: [{ selector: '#hello', onActions: ['click'], methodKey: 'sayHello' }],
  });
  scene.addComponent(ui);

  return scene;
}
```

Serve the directory over HTTP (ES-module scripts don't load from `file://`) — e.g.
`npx serve .` — and open the page. For a WebGL render scene, add a `viewport` and a
`camera`; see [test/scenes/](test/scenes/) for complete examples.

## Core concepts

**Nexus / component tree.** A `nexus` is a container node. Every component has a `parent`
and components are queried off a nexus: `getComponentByType`, `getComponentsByType`,
`getComponentByName`, `getComponentById`, and `addComponent`. Scenes are just a root nexus.

**Components are data + dispatched methods.** `newComponent(type, options, parent?)` returns
a Proxy-wrapped data object. Calling `component.someMethod(...)` dispatches to a central
registry; reading a data field is allowed only if it's in that component type's
property allowlist. On a nexus, shorthand resolves children: `nexus.sprites` (all sprites),
`nexus.camera` (first camera), `nexus.<name>` (by name).

**Uniqueness.** `ComponentUnique` controls how many instances may exist: `FALSE` (many),
`LOCAL` (one per parent nexus), `GLOBAL` (one per scene), `NAME` (one per type+name).

**The loop.** `Omosuen.start(fps)` runs init → update → render → messaging each frame across
the active scene. `stop()`, `pause()`, `resume()`, and timing getters (`getFPS()`,
`getFrameTime()`) are available.

**Rendering.** A `viewport` owns a WebGL2 canvas; a `camera` renders the scene into it
(axonometric, with zoom, pixelation, and a Y-slice reveal for fog-of-war). Sprites draw
from atlas-packed `texture-map`s; `cell-map` is a WASM-backed voxel grid.

## Component catalog

Create any of these with `Omosuen.newComponent('<type>', options)`. Quick index:

| Type | Purpose |
| --- | --- |
| `nexus` | Scene container / component-tree node |
| `transform` | Position / rotation / scale (hierarchical) |
| `sprite` | Multi-channel billboard (albedo / normal / material / emission) |
| `camera` | Axonometric renderer (zoom, pixelation, orbit yaw, Y-slice reveal) |
| `viewport` | WebGL2 canvas + context |
| `cell-map` | Voxel grid store (WASM-backed, RLE-compressed) |
| `light` | Ambient / point / spot / directional light |
| `collider` | Box / sphere collision shape + queries |
| `event-collider` | Trigger volume with enter / exit / while callbacks |
| `animation-controller` | Sprite frame animation playback |
| `timer` | Countdown / repeating timer with callbacks |
| `input-controller` | Keyboard / mouse / pointer / touch / gamepad → actions |
| `texture-map` | Multi-frame texture definition (framemap or grid) |
| `atlas-manager` | Packs texture-maps into GPU atlases (one per scene) |
| `audio-track` | Audio file reference |
| `audio-effect` | Pitch / speed / reverb / EQ / pan / spatial settings (data) |
| `audio-player` | Web Audio playback manager (one per scene) |
| `data-layer` | Typed key/value store for game state |
| `flag-manager` | Boolean flags for quests/progression (one per scene) |
| `messenger` | Inter-component messaging hub |
| `ui-overlay` | DOM overlay (HTML constructor + event bindings) |

**Common options.** Every component accepts `name: string` (required) plus the optional
advanced fields `overrideKey`, `updateOverride`, `initOverride` (swap in registered override
methods for show/hide/update/init). Options below are *in addition* to these. Defaults shown
are what the builder applies when the field is omitted. Full method sets live in each
`src/component/<type>/methods.ts`.

### Structure & state

**`nexus`** — Container/grouping node and scene root; holds child components, supports a
`paused` state. No options beyond the common ones.

**`transform`** — 3D position, rotation (Euler, radians), and scale; composes hierarchically.
- `position?: Vector3D` (default `(0,0,0)`)
- `rotation?: Vector3D` (default `(0,0,0)`)
- `scale?: Vector3D` (default `(1,1,1)`)

**`data-layer`** — Typed key/value store; enforces a consistent type per key (string, number,
boolean, Vector2D/3D/4D). No options beyond the common ones (starts empty).

**`flag-manager`** — Set of boolean string flags for quest/progression state. *Unique: one per
scene.* No options beyond the common ones (starts empty).

**`messenger`** — Message hub for inter-component communication (pattern-routed).
- `listeners?: ListenerConfig[]` (default `[]`) — each `{ pattern: string | RegExp | ALL_MESSAGES | ANY_MESSAGES, callbackKey: string }`; `callbackKey` resolves a function registered via `registerMethod('message-listener', key, fn)`.

### Spatial & physics

**`collider`** — Box (AABB/OBB) or sphere collision shape with queries.
- `shape?: 'box' | 'sphere'` (default `'box'`)
- `size?: Vector3D` (default `(0.5,0.5,0.5)`) — box half-extents
- `radius?: number` (default `0.5`) — sphere radius
- `offset?: Vector3D` (default `(0,0,0)`) — local offset from the transform

**`event-collider`** — Trigger volume that fires enter/exit/while callbacks when tracked
colliders overlap it. Same geometry options as `collider`:
- `shape?: 'box' | 'sphere'` (default `'box'`), `size?: Vector3D` (default `(0.5,0.5,0.5)`), `radius?: number` (default `0.5`), `offset?: Vector3D` (default `(0,0,0)`)

### Rendering

**`viewport`** — WebGL2 canvas + rendering context (the render surface).
- `width?: number` (default `800`), `height?: number` (default `600`)
- `offsetX?: number` (default `0`), `offsetY?: number` (default `0`) — placement on screen
- `backgroundColor?: Vector4D` (default `(0,0,0,1)`)

**`camera`** — Axonometric renderer into a viewport; pixel-perfect zoom, orbit yaw, and a
Y-slice reveal for fog-of-war/occlusion. *Unique: one per parent nexus.*
- `viewportRef: string` (**required**) — name of the viewport to render into
- `zoom?: number` (default `1.0`), `pixelScale?: number` (default `2.0`)
- `axonometricAngle?: number` (default `30`) — pitch, degrees
- `orbitYaw?: number` (default `0`) — degrees, rotates world X/Z around +Y before the
  orthographic projection; `0` matches the original fixed-azimuth view. Set via
  `setOrbitYaw(degrees)` or `orbitBy(deltaDegrees)`. Still no perspective/FOV or free
  6DOF — the projection stays orthographic-axonometric, only the azimuth moves.
- `revealYOffset?: number` (default `16.0`), `revealFadeHeight?: number` (default `8.0`), `revealRadius?: number` (default `256.0`) — Y-slice reveal tuning

**`sprite`** — Multi-channel billboard; per-channel frame selection, tint, opacity, optional
silhouette, material-driven specular and emission. *Unique: one per parent nexus.*
- `textureMapKeys?: { albedo?, normal?, material?, emission?: string }` (default all empty) — which texture-maps feed each channel. `material` is `R=metallic, G=roughness`, driving a cheap Blinn-Phong specular highlight (metallic gates it — non-metal sprites are unaffected).
- `frame?: { albedo?, normal?, material?, emission?: number }` (default all `0`) — frame index per channel
- `anchor?: Vector2D` (default `(0,0)`)
- `tint?: Vector4D` (default `(1,1,1,1)`), `opacity?: number` (default `1.0`)
- `showSilhouette?: boolean` (default `false`), `silhouetteColor?: Vector4D` (default `(0.2,0.4,0.8,0.5)`)
- `emissionIntensity?: number` (default `0`, clamped 0–1) — scales the emission texture (or albedo as a fallback when no emission texture is assigned) into a self-illuminating glow. Set via `setEmissionIntensity(intensity)`.
- `emissionColor?: Vector3D` (default `(0,0,0)`, no-op) — flat additive RGB highlight, added independent of `emissionIntensity`. Set via `setEmissionColor(r,g,b)`, read via `getEmissionColor()`.

**`cell-map`** — Voxel grid (material/shape/emission/visibility per cell); WASM-backed RLE
store with greedy/smoothed meshing.
- `materials: Material[]` (**required**) — each `Material` bundles `{ albedoTextureKey, normalTextureKey, emissionTextureKey, materialTextureKey: string }` and a frame index per channel `{ albedoFrame, normalFrame, emissionFrame, materialFrame?: number (default 0) }`
  - `sides?: { up?, southEast?, southWest?: { albedoFrame?, normalFrame?: number } }` — per-visible-side texture override (`up` = +Y, `southEast` = +X, `southWest` = +Z — the three faces the camera shows at `orbitYaw = 0`). Omitted sides/channels fall back to the base frame, so a material with no `sides` renders unchanged. Per-side frames must be frames of the **same** texture-map as the base (single atlas page); albedo + normal only. These names assume `orbitYaw` near `0`/`90`/`180`/`270`; at other yaws the camera sees faces these overrides don't cover, so authors relying on `sides` should snap orbit to those angles (a yaw-aware per-side remap is a possible follow-up, not implemented here).
  - `smoothness?: number` (0–15) — per-cell-type smoothing weight that overrides `smoothingWeights` for cells of this material; omit to use the map/per-cell weight.
- `cellSize: Vector3D` (**required**), `mapSize: Vector3D` (**required**)
- `materialMap: Array3D<number>` (**required**)
- `shapeMap?: Array3D<number>` (default all `1`) — per-cell shape index: `0` = air, `1` = default cube, `2+` = a custom mesh from `meshes`
- `meshes?: Mesh[]` — custom cell shapes (indices `0` air / `1` cube are auto-filled — pass `null`/omit to keep the defaults). Each `Mesh`:
  - `vertices: Float32Array` — local `-0.5..0.5`, scaled to fill the cell footprint; `indices: Uint16Array` — CCW-wound triangles
  - `uvs?: Float32Array` — one uv per vertex enables **UV texturing** (sampled from the material's base albedo/normal frame); empty/omitted falls back to **triplanar** (the cube default)
  - `faceCover?: { posX?, negX?, posY?, negY?, posZ?, negZ?: boolean }` (each default `true`) — set a side `false` when the mesh doesn't fill that cell face, so the neighbor still renders its adjacent face instead of being culled
  - Custom shapes are meshed in WASM alongside cubes (greedy **and** smoothed), so they dedup/smooth seamlessly with neighbors and round-trip through serialization
- `emissionMap?: Array3D<number>` (default `0`), `visibilityMap?: Array3D<boolean>` (default `true`)
- `smoothing?: number` (default `0`) — surface-net smoothing iterations; `smoothingWeights?: number | Array3D<number>` (default `8`, range 0–15) base per-cell weight; `normalSmoothing?: number` (default `0`). At a vertex shared by cells of differing weight the lowest (hardest) weight wins, so softer cells snap to harder neighbors' square corners (no seams). A material's `smoothness` overrides these per cell-type.
- `revealExempt?: boolean` (default `false`) — ignore the camera Y-slice reveal

**`light`** — Ambient / point / spot / directional light.
- `lightType: 'ambient' | 'point' | 'spot' | 'directional'` (**required**)
- `color?: Vector3D` (default `(1,1,1)`), `brightness?: number` (default `1`)
- `radius?: number` (default `100`), `hardness?: number` (default `0`)
- `direction?: Vector3D` (default `(0,-1,0)`) — for spot/directional

**`texture-map`** — Maps a source image into frame definitions for atlas packing.
- `textureMapKey: string` (**required**), `filePath: string` (**required**)
- `imageType?: Vector4D[] | GridConfig` (default: whole image as one frame) — a frame-rect list `[x,y,w,h]`, or a grid `{ cellSize: Vector2D, gridSize: Vector2D, cellCount?: number }`
- `atlasManager?` — if provided, auto-registers with that atlas-manager

**`atlas-manager`** — Packs texture-maps into GPU atlases (incremental upload in retain mode).
*Unique: one per scene.*
- `config?: { atlasSize?: 1024 | 2048 | 4096 | 8192 (default 4096); maxAtlases?: number 1–16 (default 16); padding?: number 0–4 (default 1); retainAtlas?: boolean (default false) }`

### Animation, timing & input

**`animation-controller`** — Sprite frame-animation playback. *Unique: one per parent nexus.*
- `animations?: Animation[]` (default `[]`) — each `{ name, frames, frameRate? (default 12), loop? (default true), onComplete? }`
- `channels?: ChannelType[]` (default `['albedo']`) — sprite channels to drive
- `speed?: number` (default `1.0`)

**`timer`** — Accumulates time and fires events on completion; optional repeat / auto-dispose.
- `duration: number` (**required**) — ms
- `time?: number` (default `0`), `speed?: number` (default `1`)
- `repeat?: number | boolean` (default `false`) — `false` once, `true` forever, number = count
- `destroy?: boolean` (default `false`) — dispose after finishing
- `events?: string[]` (default `[]`) — registered method keys invoked on completion

**`input-controller`** — Keyboard/mouse/pointer/touch/gamepad → action bindings.
- `bindings?: ActionBinding[]` (default `[]`)
- `preventDefault?: boolean` (default `true`)
- `target?: EventTarget` (default `window`)

### Audio

**`audio-track`** — Reference to an audio file (loaded/played by the audio-player). *Unique:
one per name.*
- `filePath: string` (**required**)

**`audio-effect`** — Pure data: effect settings applied when a track is played.
- `pitchShift?: number` (default `0`, semitones), `speedShift?: number` (default `1.0`)
- `volume?: number` (default `1.0`), `pan?: number` (default `0`, −1…1)
- `reverb?: number` (default `0`, 0…1), `mix?: number[]` (default `[]`, multi-band EQ, each −1…1)
- `spatial?: boolean` (default `false`) + `spatialX/Y/Z?: number` (default `0`) — HRTF 3D position
- `transitionBuffer?: number` (default `150`) — ms pre-buffer for seamless effect transitions

**`audio-player`** — Web Audio manager: decodes buffers, plays tracks with effects. *Unique:
one per scene.*
- `masterVolume?: number` (default `1.0`), `muted?: boolean` (default `false`)

### UI

**`ui-overlay`** — DOM overlay layer: builds HTML from a registered constructor and wires DOM
event bindings.
- `htmlConstructorKey?: string` — key of an `registerHtmlConstructor(key, fn)` constructor
- `bindings?: UIBinding[]` (default `[]`) — each `{ selector: string, onActions: UIAction[], methodKey: string }` (`methodKey` resolves a `registerBinding(key, fn)` handler)
- `cssOverrides?: Record<string, string>` (default `{}`) — inline styles on the container
- `previousOverlayId?: number` — overlay to restore via the `back()` method

For reactive, data-bound overlays, see the [`state-overlay`](#official-plugins) plugin.

## Messaging

Components talk via a `messenger`. Register a listener callback by key, then attach it to a
pattern; senders queue messages that are delivered each frame.

```js
Omosuen.registerMethod('message-listener', 'onHit', (envelope) => {
  console.log(envelope.message, envelope.body, 'from', envelope.sender.name);
});

const messenger = await Omosuen.newComponent('messenger', {
  name: 'Bus',
  listeners: [{ pattern: 'hit', callbackKey: 'onHit' }],
});
scene.addComponent(messenger);

messenger.send('hit', null, { damage: 10 });   // null receiver = broadcast
```

`Omosuen.ALL_MESSAGES` / `Omosuen.ANY_MESSAGES` are wildcard patterns. The envelope is
`{ message, sender, receiver, messenger, body }`.

## Math

`Omosuen` exports `Vector2D`, `Vector3D`, `Vector4D` (with `.r/.g/.b/.a` color aliases on
V3/V4 and `add`/`subtract`/`multiply`/`divide`/`normalize`), the dense/compressed/bit-packed
grid types `Array2D`, `Array3D`, `Array3Dc`, `Array3Di`, `Array3Dic`, and `lerp(a, b, t)`.

## Extending the engine

Register behavior at runtime:

- `registerMethod(type, key, fn)` — add/override a method for a component type.
- `registerBinding(key, fn)` / `registerHtmlConstructor(key, fn)` — UI event handlers and
  `ui-overlay` HTML.
- `registerPluginComponent(def)` — register a **whole new component type** from outside the
  core (`def: { type, builder, methods, propertyAllowlist?, serializer? }`).

Plugin components can also be loaded declaratively via the `plugins` init option — either a
`ComponentTypeDefinition` (bundler/TS) or a path to a self-registering JS file:

```js
await Omosuen.init({ plugins: [stateOverlayDefinition] });
// or, no bundler:
await Omosuen.init({ plugins: ['./state-overlay.plugin.js'] });
```

Plugin/UI registrations must happen **before** the scene that uses them is loaded.

## Official plugins

- **[omosuen-state-overlay](plugins/state-overlay/README.md)** — reactive DOM overlays
  powered by [State Street](https://github.com/Joshabracks/State-Street), driven by the
  Omosuen loop (no second `requestAnimationFrame`).

  ```bash
  npm i github:joshabracks/omosuen#state-overlay0.0.6
  ```

- **[omosuen-aseprite-loader](plugins/aseprite-loader/README.md)** — ingests
  [Aseprite](https://www.aseprite.org/) (`.aseprite`/`.ase`) files into layered,
  animated entities with shared atlases and animation maps.

  ```bash
  npm i github:joshabracks/omosuen#aseprite-loader0.3.0
  ```

- **[omosuen-browser-local-storage](plugins/browser-local-storage/README.md)** —
  persists game state to browser storage (localStorage, sessionStorage, IndexedDB,
  cookies) with optional data-layer mirroring and nexus snapshots.

  ```bash
  npm i github:joshabracks/omosuen#browser-local-storage0.1.0
  ```

- **[omosuen-perf-monitor](plugins/perf-monitor/README.md)** — on-screen frame
  profiler HUD (FPS, phase timing, per-component-type cost) with a hotkey toggle and a
  JSON snapshot export for bug reports.

  ```bash
  npm i github:joshabracks/omosuen#perf-monitor0.1.0
  ```

  Each plugin is its own package (`omosuen-<name>`) released as a git tag
  `<plugin><version>`; the standalone browser bundle is attached to the Release as a
  downloadable asset.

## Build & scripts

```bash
npm run build       # dev + prod bundles
npm run build:dev   # development bundle → test/dev/omosuen.js
npm run build:prod  # minified bundle    → omosuen.min.js
npm run lint        # eslint . --ext .ts
```

Building compiles the Rust crates in [wasm/](wasm/) to WASM and base64-embeds them into the
bundle (see [build-tools/wasm.mjs](build-tools/wasm.mjs)); a `wasm32-unknown-unknown` Rust
target is required. WASM parity is pinned by golden-snapshot suites
(`npm run test:wasm`, `test:wasm-mesh`, `test:wasm-audio`).

## License

ISC.
