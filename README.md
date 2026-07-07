# omosuen-aseprite-loader

Official [Omosuen](../../README.md) plugin: the **`aseprite-loader`** component ingests
**Aseprite** (`.aseprite` / `.ase`) files into layered, animated entities. Dependency-free
and fully browser-static — assets load by URL via `fetch`, with zlib inflate via the native
`DecompressionStream` (evergreen browsers: Chrome 80+, Safari 16.4+, Firefox 113+).

The plugin reuses the engine's general capabilities (multi-sprite layering, per-frame
animation timing, in-memory atlas ingestion); it only adds the Aseprite-specific parsing and
assembly.

## What it does

Attach an `aseprite-loader` component to a nexus; on init it fetches + parses the file and
builds the entity's **texture-maps + sprites + animation-controller** as siblings in that nexus:

- Aseprite **tags** → named animations carrying **per-frame durations**.
- Aseprite **layers** → stacked sprites (one per layer when `flatten: false`), driven in
  lockstep; toggle them with `controller.setLayerVisible(name, bool)`.
- Generated children are flagged `_generated`, so a saved scene stores only the declaration
  (URL + config) and the pixels/atlas regenerate on load — no duplication across save/load.

## Usage

### Declarative (browser, self-registering)

```js
await Omosuen.init({ plugins: ['./aseprite-loader.plugin.js'] });

await Omosuen.newComponent('aseprite-loader', {
  name: 'hero',
  filePath: './assets/hero.aseprite',
  flatten: false,             // one sprite per layer (false) vs one composited sprite (true)
  visibleOnly: true,          // skip layers hidden in Aseprite
  anchorMode: 'bottom-center', // foot-anchor for ground-standing billboards ('center' = default)
  // layerSlots: { 'hair-a': 'hair', 'hair-b': 'hair' }, // mutually-exclusive slots
});
```

### Multiple files on one entity (`sources`)

One loader can ingest **several** `.aseprite` files into the **same** nexus — one shared
animation-controller, one atlas pass — instead of a child nexus per file. Give each source an
`id` (default: the filename without extension); every artifact from that source is namespaced by
it, so nothing collides:

```js
await Omosuen.newComponent('aseprite-loader', {
  name: 'unit',
  sources: [
    { filePath: './sprites/Villager.aseprite' },                 // id defaults to "Villager"
    { filePath: './sprites/Fighter.aseprite', id: 'fighter' },   // explicit id
    { filePath: './sprites/Lumberjack.aseprite',
      layerSlots: { 'hair-a': 'hair', 'hair-b': 'hair' } },      // per-source slots
  ],
  flatten: false,      // loader-level default; each source may override flatten / visibleOnly
  anchorMode: 'bottom-center',
});
```

| Artifact | Single `filePath` | `sources` (namespaced) |
|----------|-------------------|------------------------|
| Sprite / layer name | layer name | `{id}:{layer}` (flattened source: `{id}`) |
| Animation (tag) name | `walk` | `{id}-walk` |
| Texture key | `aseprite:{packageId}:{build}` | `aseprite:{id}:{build}` |

**Swapping variants** (show one source, hide the rest) is done by **name prefix**, not by engine
`slot` (which is reserved for per-source `layerSlots` and stays *mutually exclusive*). To reveal
source `fighter`: for every controller layer whose name starts with `fighter:`, call
`setLayerVisible(name, true)`, and set the others to `false`. Play its animation in the **same
tick** you reveal it — `controller.play('fighter-walk')` — so no sprite renders a frame index from
another source's timeline. Duplicate `filePath`s in `sources` are skipped with a warning; use one
`id` per physical file.

### Programmatic (bundler / TS)

```ts
import {
  registerAsepriteLoader,
  asepriteLoaderDefinition,
  importAseprite,
  parseAseprite,
} from 'omosuen-aseprite-loader';

registerAsepriteLoader(); // or: Omosuen.init({ plugins: [asepriteLoaderDefinition] })

// Or skip the component and build an entity directly:
const buf = await fetch('./hero.aseprite').then((r) => r.arrayBuffer());
await importAseprite(buf, { parent, atlasManager, packageId: 'hero', flatten: false });

// Multi-file entity directly (namespaced by each entry's `id`; the importer
// fetches each filePath lazily, skipping the network on cached repeat spawns):
import { importAsepriteSources } from 'omosuen-aseprite-loader';
await importAsepriteSources(
  [
    { filePath: './sprites/Villager.aseprite', id: 'villager', flatten: false, visibleOnly: true },
    { filePath: './sprites/Fighter.aseprite', id: 'fighter', flatten: false, visibleOnly: true },
  ],
  // `sharedParent` (typically the scene root) owns the shared texture-maps +
  // animation-map so they outlive any one entity; `parent` gets the per-instance
  // sprites + controller.
  { parent, atlasManager, sharedParent: sceneRoot, packageId: 'unit', anchorMode: 'bottom-center' },
);
```

### Shared data & cheap repeat-instancing

A multi-file loader shares its heavy static data across every entity of the same art set:

- **Texture-maps** are created once per key and owned by the scene root; each entity's sprites
  reference them by key (the engine resolves texture-maps globally by `textureMapKey`).
- **Animations** live in one shared `animation-map` component; each entity's controller references it
  by key (`animations: '<key>'`) instead of inlining a copy.
- The **first** entity of an art set pays the full import; **subsequent** entities are built from a
  cached blueprint — only their own sprites + controller — with no `fetch`, parse, compositing, or atlas
  work. So spawning many units of the same art set is cheap.

## Build

```
npm run build      # tsc (ESM + .d.ts) + webpack (dist/aseprite-loader.plugin.js)
```

`dist/aseprite-loader.plugin.js` is the self-registering classic script; load it after the
Omosuen UMD bundle. The build externalizes `omosuen` to the `Omosuen` global so the plugin uses
the engine's runtime singletons rather than re-bundling them.
