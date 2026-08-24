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

One loader can ingest **several** `.aseprite` files into the **same** nexus by **horizontal
ingestion**: instead of one full sprite set per file, sprites are shared **by layer name** across
every source in the set. A set where every source has `main`/`outline` layers produces exactly
**2 sprites total** — however many sources are in the set — because each layer name gets one
shared texture-map (every contributing source's frames packed into it, concatenated
left-to-right) and one shared sprite. `sources` is keyed by source id (used to prefix animation
names — see below); a bare string value is shorthand for `{ filePath }`:

```js
await Omosuen.newComponent('aseprite-loader', {
  name: 'unit',
  sources: {
    villager: './sprites/Villager.aseprite',
    fighter: './sprites/Fighter.aseprite',
    lumberjack: './sprites/Lumberjack.aseprite',
  },
  flatten: false,       // set-level: applies to every source in the set (no per-source override)
  layerSlots: { 'hair-a': 'hair', 'hair-b': 'hair' }, // set-level, keyed by layer name
  anchorMode: 'bottom-center',
});
```

Key order matters — it drives frame-index allocation across the set (see below) — so declare
`sources` in a stable order and **avoid numeric-string keys** (`"1"`, `"2"`); JavaScript reorders
those ahead of any other keys regardless of declaration order, which would silently scramble
frame allocation.

| Artifact | Single `filePath` | `sources` (shared by layer name) |
|----------|-------------------|-----------------------------------|
| Sprite / layer name | layer name | `{layerName}` (flattened set: `{packageId}`) — one sprite total, not per source |
| Animation (tag) name | `walk` | `{sourceKey}-walk` |
| Texture key | `aseprite:{packageId}:{build}` | `aseprite:{artSetKey}:{layerName}` |

**Swapping variants** ("costumes") means two things, not one: (1) call
`controller.play('fighter-walk')` — animation tags stay namespaced per source, so this is how you
select which source's frames actually play; (2) show/hide whichever layers aren't universal across
every source in the set (e.g. an accessory-only layer one source has and others don't) — most
layers are shared and need no toggling at all, but for the few that aren't, call
`setLayerVisible(name, bool)` in the **same tick** as `play()`. Skip step 2 for a layer the
newly-active source *does* have — hiding a layer the active source doesn't use only matters to
avoid a harmless console warning (see Gotchas), not incorrect rendering.

**Gotcha**: if a layer the active source doesn't contribute to is left visible while that source's
animation plays, the engine logs `[camera] Sprite '...' frame N not found in texture map` every
frame (not a crash — the sprite is just skipped) — hide layers the active source doesn't use.

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

// Multi-file entity directly (shared by layer name across the set; the importer
// fetches each filePath lazily, skipping the network on cached repeat spawns):
import { importAsepriteSources } from 'omosuen-aseprite-loader';
await importAsepriteSources(
  {
    villager: { filePath: './sprites/Villager.aseprite', visibleOnly: true },
    fighter: { filePath: './sprites/Fighter.aseprite', visibleOnly: true },
  },
  // `sharedParent` (typically the scene root) owns the shared texture-maps +
  // animation-map so they outlive any one entity; `parent` gets the per-instance
  // sprites + controller. `flatten`/`layerSlots` are set-level here too.
  {
    parent, atlasManager, sharedParent: sceneRoot, packageId: 'unit',
    flatten: false, anchorMode: 'bottom-center',
  },
);
```

### Shared data & cheap repeat-instancing

A multi-file loader shares its heavy static data across every entity of the same art set:

- **Texture-maps** are created once per (art set, layer name) key and owned by the scene root —
  already shared across every source in the set (not just across entities) by the horizontal
  ingestion described above; each entity's sprites reference them by key (the engine resolves
  texture-maps globally by `textureMapKey`).
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
