# omosuen-image-loader

Official [Omosuen](../../README.md) plugin: the **`image-loader`** component turns art files
into ready-to-render entities. Dependency-free and fully browser-static — assets load by URL
via `fetch`, with zlib inflate via the native `DecompressionStream` (evergreen browsers:
Chrome 80+, Safari 16.4+, Firefox 113+).

It has two ingestion paths, and one component covers both:

| Path | Option | For |
| --- | --- | --- |
| **Aseprite** | `filePath` / `sources` | `.aseprite` / `.ase` binaries — layers become sprites, tags become animations |
| **Plain images** | `images` | ordinary image files, declared per sprite texture channel |

The Aseprite path is the older of the two and is unchanged. The plain-image path exists
because the Aseprite format carries only a composited RGBA image: it can describe an
**albedo** and nothing else. A sprite's `normal`, `material` and `emission` channels were
therefore unreachable through this plugin, whatever the art. `images` is how you reach them.

The plugin reuses the engine's general capabilities (multi-sprite layering, per-frame
animation timing, in-memory atlas ingestion, channel packing); it only adds the format-specific
parsing and assembly.

> **Renamed.** This plugin was `omosuen-aseprite-loader`, and its component type was
> `'aseprite-loader'`. The type string is now `'image-loader'` with **no back-compat alias**,
> so a scene serialized under the old type will not load. That is a deliberate breaking
> change; the `aseprite-loader` releases remain installable if you would rather pin one.

## What it does

Attach an `image-loader` component to a nexus; on init it builds the entity's
**texture-maps + sprites + animation-controller** as siblings in that nexus:

- Aseprite **tags** → named animations carrying **per-frame durations**.
- Aseprite **layers** → stacked sprites (one per layer when `flatten: false`), driven in
  lockstep; toggle them with `controller.setLayerVisible(name, bool)`.
- Generated children are flagged `_generated`, so a saved scene stores only the declaration
  (URL + config) and the pixels/atlas regenerate on load — no duplication across save/load.

## Usage

### Declarative (browser, self-registering)

```js
await Omosuen.init({ plugins: ['./image-loader.plugin.js'] });

await Omosuen.newComponent('image-loader', {
  name: 'hero',
  filePath: './assets/hero.aseprite',
  flatten: false,             // one sprite per layer (false) vs one composited sprite (true)
  visibleOnly: true,          // skip layers hidden in Aseprite
  anchorMode: 'bottom-center', // foot-anchor for ground-standing billboards ('center' = default)
  // layerSlots: { 'hair-a': 'hair', 'hair-b': 'hair' }, // mutually-exclusive slots
});
```

### Plain images, one per channel (`images`)

Declare an image per sprite texture channel. Nothing here is Aseprite-specific — these are
ordinary PNGs, or no files at all.

```js
await Omosuen.newComponent('image-loader', {
  name: 'crate',
  images: {
    albedo: './assets/crate.png',
    normal: './assets/crate_n.png',
    material: { metallic: 0, roughness: 0.35 },
  },
});
```

Each channel accepts one of three forms:

| Form | Meaning |
| --- | --- |
| `'./file.png'` | a URL, handed straight to the atlas — never decoded by the plugin |
| `['./f0.png', './f1.png', …]` | separate per-frame files, composited into one strip with a matching `FrameMap` |
| `{ metallic, roughness, mask, maskLevels }` | **`material` only** — channel-packed into `R=metallic, G=roughness, B=mask` |

The grouped `material` form is the reason this path exists. The renderer wants those three
maps interleaved into the RGB of one image, and authoring them as separate grayscale files
and merging them in external software is a step nothing needed to do by hand. Each entry
takes a URL **or a constant 0–1**, so `{ metallic: 0, roughness: 0.35 }` is a complete
material with no image files involved.

Two behaviours worth knowing:

- **An unauthored `roughness` defaults to 1 (fully rough), not 0.** Zero is a *mirror finish*
  — it is also what an empty channel gives you for free, which makes it the likeliest silent
  mistake in the whole feature. The default matches the shader's own.
- **`maskLevels` must match the number of grey levels the mask file uses**, counting "no region"
  as one of them. It snaps to N evenly-spaced values across 0–255, so too few merges regions
  together or into nothing at all — silently. A black/mid-grey/white mask needs `maskLevels: 3`
  (levels 0, 128, 255); at `2` the mid-grey quantises straight to 0 and that region disappears
  before it ever reaches the GPU. The mask arrives in a post effect as `u_aux.b`.
- **A constant-only material inherits the albedo's size.** The core packer refuses to guess a
  size when no source implies one; here the answer is not a guess, since a material must
  register with its albedo pixel-for-pixel. If every channel is a constant, pass `sheetSize`.

Supply several frames and the loader also builds an animation-controller driving **every**
populated channel in lockstep — so a 4-frame material strip advances with its albedo instead
of sitting frozen on frame 0.

`images` is mutually exclusive with `filePath` / `sources`, and component options stay
URL-only so a scene round-trips. For `Blob`, `ImageData` or live-canvas sources, call the
engine's `packMaterial` / `packChannels` / `packFrameStrip` directly and pass the resulting
canvas to a `texture-map`'s `sourceImage`.

### Multiple files on one entity (`sources`)

One loader can ingest **several** `.aseprite` files into the **same** nexus by **horizontal
ingestion**: instead of one full sprite set per file, sprites are shared **by layer name** across
every source in the set. A set where every source has `main`/`outline` layers produces exactly
**2 sprites total** — however many sources are in the set — because each layer name gets one
shared texture-map (every contributing source's frames packed into it, concatenated
left-to-right) and one shared sprite. `sources` is keyed by source id (used to prefix animation
names — see below); a bare string value is shorthand for `{ filePath }`:

```js
await Omosuen.newComponent('image-loader', {
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
  registerImageLoader,
  imageLoaderDefinition,
  importAseprite,
  parseAseprite,
} from 'omosuen-image-loader';

registerImageLoader(); // or: Omosuen.init({ plugins: [imageLoaderDefinition] })

// Or skip the component and build an entity directly:
const buf = await fetch('./hero.aseprite').then((r) => r.arrayBuffer());
await importAseprite(buf, { parent, atlasManager, packageId: 'hero', flatten: false });

// Multi-file entity directly (shared by layer name across the set; the importer
// fetches each filePath lazily, skipping the network on cached repeat spawns):
import { importAsepriteSources } from 'omosuen-image-loader';
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
npm run build      # tsc (ESM + .d.ts) + webpack (dist/image-loader.plugin.js)
```

`dist/image-loader.plugin.js` is the self-registering classic script; load it after the
Omosuen UMD bundle. The build externalizes `omosuen` to the `Omosuen` global so the plugin uses
the engine's runtime singletons rather than re-bundling them.
