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
(axonometric, with zoom and pixelation). Sprites draw from atlas-packed `texture-map`s;
`cell-map` is a WASM-backed voxel grid.

**Fog of war.** One or more `vision-source` components (attached to any entity — typically
a player or party member) reveal terrain and sprites via real per-pixel line-of-sight, with
a soft radial + occlusion edge (no voxelized hard cuts). A scene-wide `fog-of-war` component
configures how previously-seen-but-not-currently-visible terrain and sprites render:
desaturated/tinted "memory" by default, fully hidden if never seen. Terrain memory is
itself two-tier — fine per-cell detail near a vision source, a coarser per-chunk color
farther away — and survives save/load. Sprites are hidden outside live vision by default;
opt a sprite into being remembered (frozen at its last-seen pose instead of vanishing) with
`sprite.trackedByFog`.

## Component catalog

Create any of these with `Omosuen.newComponent('<type>', options)`. Quick index:

| Type | Purpose |
| --- | --- |
| `nexus` | Scene container / component-tree node |
| `transform` | Position / rotation / scale (hierarchical) |
| `sprite` | Multi-channel billboard (albedo / normal / material / emission) |
| `camera` | Axonometric renderer (zoom, pixelation, orbit yaw) |
| `viewport` | WebGL2 canvas + context |
| `cell-map` | Windowed/streaming voxel grid (WASM-backed, RLE-compressed) (one per engine instance) |
| `light` | Ambient / point / spot / directional light |
| `vision-source` | Fog-of-war reveal source (soft radial + line-of-sight) |
| `fog-of-war` | Fog-of-war memory/never-viewed styling config (one per scene) |
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

**`camera`** — Axonometric renderer into a viewport; pixel-perfect zoom and orbit yaw.
*Unique: one per parent nexus.*
- `viewportRef: string` (**required**) — name of the viewport to render into
- `zoom?: number` (default `1.0`), `pixelScale?: number` (default `2.0`)
- `axonometricAngle?: number` (default `30`) — pitch, degrees
- `orbitYaw?: number` (default `0`) — degrees, rotates world X/Z around +Y before the
  orthographic projection; `0` matches the original fixed-azimuth view. Set via
  `setOrbitYaw(degrees)` or `orbitBy(deltaDegrees)`. Still no perspective/FOV or free
  6DOF — the projection stays orthographic-axonometric, only the azimuth moves.
- The camera's offscreen framebuffer (used for pixel-perfect zoom) is only recomputed on
  `setZoom`/`setPixelScale`, not automatically when the viewport resizes. Call
  `resize()` after resizing the viewport (e.g. from a `window.resize` listener) to
  re-sync it — otherwise the rendered image stretches/squashes to the new canvas size.

**`sprite`** — Multi-channel billboard; per-channel frame selection, tint, opacity, optional
silhouette, material-driven specular and emission. *Unique: one per parent nexus.*
- `textureMapKeys?: { albedo?, normal?, material?, emission?: string }` (default all empty) — which texture-maps feed each channel. `material` is `R=metallic, G=roughness`, driving a cheap Blinn-Phong specular highlight (metallic gates it — non-metal sprites are unaffected).
- `frame?: { albedo?, normal?, material?, emission?: number }` (default all `0`) — frame index per channel
- `anchor?: Vector2D` (default `(0,0)`)
- `tint?: Vector4D` (default `(1,1,1,1)`), `opacity?: number` (default `1.0`)
- `showSilhouette?: boolean` (default `false`), `silhouetteColor?: Vector4D` (default `(0.2,0.4,0.8,0.5)`)
- `emissionIntensity?: number` (default `0`, clamped 0–1) — scales the emission texture (or albedo as a fallback when no emission texture is assigned) into a self-illuminating glow. Set via `setEmissionIntensity(intensity)`.
- `emissionColor?: Vector3D` (default `(0,0,0)`, no-op) — flat additive RGB highlight, added independent of `emissionIntensity`. Set via `setEmissionColor(r,g,b)`, read via `getEmissionColor()`.
- `trackedByFog?: boolean` (default `false`) — opt in to fog-of-war memory: once seen by a
  `vision-source`, this sprite freezes at its last-seen position/frame/tint instead of
  vanishing when it leaves live vision, styled like `fog-of-war`'s `memoryStyle`, and resumes
  live rendering the moment it's seen again. `false` (default) keeps today's behavior — hidden
  outright outside live vision. Set via `setTrackedByFog(tracked)`.

**`cell-map`** — Windowed/streaming voxel grid (material/shape/emission/visibility per cell);
WASM-backed RLE store with greedy/smoothed meshing. *Unique: one per engine instance* — its state
lives in module-level storage (the underlying WASM cell store is itself a process-wide singleton),
so constructing a second live `cell-map` while one exists throws (`builder()`) or returns a
`LIVE_INSTANCE_EXISTS` error (`deserialize()`) instead of silently corrupting the first. Dispose
the existing instance before constructing another.

Two construction paths, chosen by which options are supplied: **hand-authored** (`mapSize` +
`materialMap`, the pre-windowing shape below) or **generative** (`generateCell`/`generateChunk`,
`mapSize`/`materialMap` omitted — or neither, for a purely empty map authored via `setCellData`
after construction). Either way, the engine only ever keeps a **resident window** of chunks
loaded in WASM; everything outside it lives compressed in cold storage and is pulled back in when
the window shifts there again. A hand-authored map with no explicit `windowRadius` gets one
auto-sized to keep the whole authored map resident (today's pre-windowing behavior, unchanged);
supplying `windowRadius` opts even a hand-authored map into windowed streaming.

- `materials: Material[]` (**required**) — each `Material` bundles `{ albedoTextureKey, normalTextureKey, emissionTextureKey, materialTextureKey: string }` and a frame index per channel `{ albedoFrame, normalFrame, emissionFrame, materialFrame?: number (default 0) }`
  - `sides?: { up?, southEast?, southWest?: { albedoFrame?, normalFrame?: number } }` — per-visible-side texture override (`up` = +Y, `southEast` = +X, `southWest` = +Z — the three faces the camera shows at `orbitYaw = 0`). Omitted sides/channels fall back to the base frame, so a material with no `sides` renders unchanged. Per-side frames must be frames of the **same** texture-map as the base (single atlas page); albedo + normal only. These names assume `orbitYaw` near `0`/`90`/`180`/`270`; at other yaws the camera sees faces these overrides don't cover, so authors relying on `sides` should snap orbit to those angles (a yaw-aware per-side remap is a possible follow-up, not implemented here).
  - `smoothness?: number` (0–15) — per-cell-type smoothing weight that overrides `smoothingWeights` for cells of this material; omit to use the map/per-cell weight.
- `cellSize: Vector3D` (**required**)
- `mapSize?: Vector3D`, `materialMap?: Array3D<number>` — together, the hand-authored path (both or neither; **required** for that path, omit both for the generative path)
- `chunkSize?: Vector3D` (default `{32,32,20}`) — cells per streaming chunk per axis; pick once at construction/deserialize time, not safe to change on an existing map
- `windowRadius?: {x,y,z}` (default: auto-computed to cover the whole authored map on the hand-authored path; `{1,1,1}` — a 3×3×3-chunk window — on the generative path) — padding radius in chunks around the focus point
- `generateCell?: ((worldX, worldY, worldZ) => CellData | undefined) | string` — generates one cell at a world coordinate; returning `undefined` falls back to air. Always used for single-cell point queries. Must be a pure function of its coordinates for a given world/seed — the whole windowing/eviction/caching system relies on that determinism. A `string` instead of a function is a key registered via `registerMethod('cell-map-generator', key, fn)`; a registry-keyed generator survives save/load (`serialize()` emits the key), a raw function does not (that generator simply doesn't come back on reload — a documented, explainable limitation, not a crash).
- `generateChunk?: ((cx, cy, cz) => CellData[]) | string` — bulk per-chunk variant (a `chunkSize.x*y*z`-length array), preferred over looping `generateCell` when both are supplied; never used for point queries. Same live-function-or-registry-key shape as `generateCell`, resolved independently.
- `shapeMap?: Array3D<number>` (default all `1`) — per-cell shape index: `0` = air, `1` = default cube, `2+` = a custom mesh from `meshes`
- `meshes?: Mesh[]` — custom cell shapes (indices `0` air / `1` cube are auto-filled — pass `null`/omit to keep the defaults). Each `Mesh`:
  - `vertices: Float32Array` — local `-0.5..0.5`, scaled to fill the cell footprint; `indices: Uint16Array` — CCW-wound triangles
  - `uvs?: Float32Array` — one uv per vertex enables **UV texturing** (sampled from the material's base albedo/normal frame); empty/omitted falls back to **triplanar** (the cube default)
  - `faceCover?: { posX?, negX?, posY?, negY?, posZ?, negZ?: boolean }` (each default `true`) — set a side `false` when the mesh doesn't fill that cell face, so the neighbor still renders its adjacent face instead of being culled
  - Custom shapes are meshed in WASM alongside cubes (greedy **and** smoothed), so they dedup/smooth seamlessly with neighbors and round-trip through serialization
- `emissionMap?: Array3D<number>` (default `0`), `visibilityMap?: Array3D<boolean>` (default `true`)
- `smoothing?: number` (default `0`) — surface-net smoothing iterations; `smoothingWeights?: number | Array3D<number>` (default `8`, range 0–15) base per-cell weight (a per-cell `Array3D` on the generative path is validated against the initial window's size, not a whole-map `mapSize`); `normalSmoothing?: number` (default `0`). At a vertex shared by cells of differing weight the lowest (hardest) weight wins, so softer cells snap to harder neighbors' square corners (no seams). A material's `smoothness` overrides these per cell-type.
- `revealExempt?: boolean` (default `false`) — opt this cell-map out of fog-of-war entirely (always renders fully live, regardless of any `vision-source`)
- `autoFocusFromCamera?: boolean` (default `true` for the generative path / any map with an explicit `windowRadius`, `false` otherwise) — the render loop drives the window's focus from the camera position every frame. Set `false` for explicit control via `setFocus(cellMap, worldX, worldY, worldZ)`.
- `autoResizeFromZoom?: boolean` (default: mirrors `autoFocusFromCamera`) — the render loop grows/shrinks the window's radius with camera zoom, capped by `maxTerrainLoadDimensions`. Set `false` for explicit control via `setWindowRadius(cellMap, radius)`.
- `maxTerrainLoadDimensions?: {x,y,z}` (default `{512,512,512}`, world units) — safety cap on how far auto-resize (or a direct `setWindowRadius` call) may ever grow the window, since a resize's assemble step can call `generateCell` for every newly-exposed chunk synchronously in one frame.
- `renderDistance?: {x,y,z}` (default `{1,1,1}`, chunks) — half-extents of the render loop's axis-aligned draw/cull volume, independent of viewport/zoom/orbit. `frustumPadding?: {x,y,z}` (default `{0,0,0}`, world units) — diagnostic-only additive padding on top of that.

**Behavior changes from the pre-windowing `cell-map`, relevant if you're upgrading:** `mapSize`
now means the **current resident window's size**, not the whole authored/generated map — read
`getBounds(cellMap)` for the window's world-space extent instead if you need absolute placement.
`raycastCellMap`/`sampleSurfaceHeight`'s default `maxDistance` scales off the window's size for the
same reason; pass it explicitly for a world taller than one window. `getCellData`'s previous
out-of-bounds throw is gone — every coordinate now resolves to something (resident window, cold
storage, generator, or empty) instead of throwing, so code that relied on that throw for bounds
validation needs its own check now.

An edit outside the resident window (`setCellData` et al.) is fully supported — it's routed
through cold storage rather than the live WASM store, and comes back exactly as written the next
time the window shifts there, **including through save/load** (`coldStorageEntries` in the
serialized scene). A `generateCell`/`generateChunk` **registered via a `'cell-map-generator'`
key** also survives save/load; a raw function passed directly does not.

`emissionColorMap`/`smoothingWeights` get the same windowed treatment: `setEmissionColor`/
`getEmissionColor` take a **world** cell coordinate (matching `setCellData`) and fully support an
off-window highlight — it persists through a shift, a resize, and save/load, the same as primary
cell data. `smoothingWeights` correctly follows the window through a shift/resize instead of going
stale or being reset; the common case (a uniform number, the only option on the generative path)
has no per-cell mutation API and never needs re-uploading to the GPU on an ordinary shift.

**Refreshing generated content.** `generateCell`/`generateChunk` are treated as pure, time-invariant
functions of world coordinates — once a chunk is visited (resident or evicted-and-unedited), its
answer is cached forever, even if whatever state the generator closes over later changes (e.g. a
new region becomes generatable in a world that grows over a session). Call
`refreshChunks(cellMap, min, max)` — or `refreshChunks(cellMap, null)` for the whole resident
window — to force affected chunks to re-derive from the generator. Resident chunks with a live
edit are left untouched (edits are tracked per-chunk, not per-cell, so there's no way to know which
specific cells inside one are real edits vs. generator-original) and reported back via
`skippedEditedChunks` so callers can detect it. Synchronous, not budgeted — call it when new
content becomes generatable, not every frame; a refresh over many resident chunks can cost real
time (one generator call plus one WASM write per cell, per chunk).

**Bulk cell writes.** `setCells(cellMap, entries, opts?)` applies a batch of already-known
`{x,y,z,data}` cell values a few at a time across frames (budgeted via `opts.budgetMs`, default
4ms) instead of a tight loop of `setCellData` calls stalling a single frame, batching dirty-marking
once per touched chunk rather than once per cell. Returns a Promise that resolves once that call's
entries are applied (rejects if the component is disposed mid-batch); overlapping `setCells` calls
queue and resolve independently, in order.

**`light`** — Ambient / point / spot / directional light.
- `lightType: 'ambient' | 'point' | 'spot' | 'directional'` (**required**)
- `color?: Vector3D` (default `(1,1,1)`), `brightness?: number` (default `1`)
- `radius?: number` (default `100`), `hardness?: number` (default `0`)
- `direction?: Vector3D` (default `(0,-1,0)`) — for spot/directional

**`vision-source`** — Fog-of-war reveal source: real per-pixel line-of-sight raycasting with
a soft radial + occlusion edge (not a coarse voxel grid). Attach to any entity — a player, a
party member, a scouted watchtower. Multiple simultaneous sources union together. Position is
read from a sibling `transform`, same as point/spot lights. *Unique: many per parent nexus.*
- `radius?: number` (default `256.0`) — world units, live vision range
- `fadeWidth?: number` (default `32.0`) — world units, soft-edge width beyond `radius`
- `enabled?: boolean` (default `true`)

**`fog-of-war`** — Scene-wide fog-of-war styling config. *Unique: one per scene.* With no
`fog-of-war` component present, the documented defaults below still apply (it's optional —
add one only to customize the styling).
- `memoryStyle?: { saturation?, opacity?, tint?: Vector3D }` (default `{ saturation: 0, opacity: 1, tint: (1,1,1) }`) — terrain/sprites seen before but not currently visible. Default: fully opaque, desaturated, untinted.
- `neverViewedStyle?: { saturation?, opacity?, tint?: Vector3D }` (default `{ saturation: 0, opacity: 0, tint: (0,0,0) }`) — never seen. Default: fully hidden.
- `lightInfluence?: number` (default `0`) — how much nearby lights extend live vision beyond geometry/line-of-sight alone; additive only (can only extend, never shrink, vision), so `0` is a true no-op.
- `nearBufferCells?: number` (default `0`) — terrain memory renders at two levels of detail: fine per-cell color near a vision source, a coarser per-chunk color farther away. This adds extra cells, beyond the usual one chunk-width, that still count as "near" (fine detail).

Terrain memory persists through save/load (part of the owning `cell-map`'s serialized data,
alongside primary cell data). Sprites don't get memory styling unless individually opted in
via `sprite.trackedByFog` (see the `sprite` entry above) — an untracked sprite is simply
hidden outside live vision, matching "memory shows what the terrain looked like, not current
entity state."

**`texture-map`** — Maps a source image into frame definitions for atlas packing.
- `textureMapKey: string` (**required**), `filePath: string` (**required**)
- `imageType?: Vector4D[] | GridConfig` (default: whole image as one frame) — a frame-rect list `[x,y,w,h]`, or a grid `{ cellSize: Vector2D, gridSize: Vector2D, cellCount?: number }`
- `atlasManager?` — if provided, auto-registers with that atlas-manager
- `recomputeFrames(tm, imageSize?)` — recomputes `originalFrames` from the texture-map's
  *current* `imageType`. Nothing does this automatically after construction, so call it after
  changing `imageType` post-construction (e.g. switching from whole-image to a grid/framemap
  layout). Clears stale `packedFrames`; follow with `atlasManager.compiled = false` +
  `processTextureMaps()` to re-pack. `imageSize` is only needed for the whole-image fallback
  (`imageType === undefined`) — grid/framemap configs don't need it.

**`atlas-manager`** — Packs texture-maps into GPU atlases (incremental upload in retain mode).
*Unique: one per scene.*
- `config?: { atlasSize?: 1024 | 2048 | 4096 | 8192 (default 4096); maxAtlases?: number 1–16 (default 16); padding?: number 0–4 (default 1); retainAtlas?: boolean (default false) }`
- `rekeyTextureMap(am, textureMap, oldKey)` — re-registers a texture-map after its
  `textureMapKey` changed post-registration. `addTextureMap` alone only registers under
  whatever key is current *at call time*; changing the key afterward and not calling
  `rekeyTextureMap` leaves the old key's bookkeeping dangling and camera texture-map caches
  stale. Follow with a recompile (`am.compiled = false; await am.processTextureMaps();`) —
  camera caches self-heal automatically at the tail of that recompile.

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
