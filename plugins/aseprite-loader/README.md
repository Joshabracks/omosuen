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
```

## Build

```
npm run build      # tsc (ESM + .d.ts) + webpack (dist/aseprite-loader.plugin.js)
```

`dist/aseprite-loader.plugin.js` is the self-registering classic script; load it after the
Omosuen UMD bundle. The build externalizes `omosuen` to the `Omosuen` global so the plugin uses
the engine's runtime singletons rather than re-bundling them.
