# omosuen-browser-local-storage

Official [Omosuen](https://github.com/Joshabracks/omosuen) **plugin component**:
persists game state to browser storage — localStorage, sessionStorage, IndexedDB, or
cookies — behind one unified async key/value API, with optional auto-mirroring of a
`data-layer` component and whole-nexus snapshot save/load. A thin layer over the
engine's existing serializers and browser-native storage; it invents no new
value-serialization convention.

## Install

```
npm i github:joshabracks/omosuen#browser-local-storage0.1.0
```

## Use

```ts
import { browserLocalStorageDefinition } from 'omosuen-browser-local-storage';

// Register the plugin component type with the engine.
await Omosuen.init({ plugins: [browserLocalStorageDefinition] });

const storage = await Omosuen.newComponent('browser-local-storage', {
  name: 'SaveGame',
});
scene.addComponent(storage);

await storage.set('highScore', 42);
const highScore = await storage.get('highScore'); // 42
```

### No-bundler / free-form path

Load the prebuilt browser bundle after the Omosuen UMD script, or via the init option
with a filepath — it self-registers the component type:

```js
await Omosuen.init({ plugins: ['./browser-local-storage.plugin.js'] });
```

### Auto-mirroring a data-layer

```ts
const dataLayer = await Omosuen.newComponent('data-layer', { name: 'PlayerState' });
scene.addComponent(dataLayer);

const storage = await Omosuen.newComponent('browser-local-storage', {
  name: 'SaveGame',
  mirror: { dataLayer: 'PlayerState', autosaveMs: 1000 },
});
scene.addComponent(storage);
// `storage` hydrates PlayerState from the backend on init, then autosaves it on the
// configured interval. Trigger a save immediately with `storage.saveMirror()`.
```

## Component: `browser-local-storage`

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `namespace` | string | component `name` | Key prefix isolating this store. |
| `defaultBackend` | `'local' \| 'session' \| 'cookie' \| 'idb'` | `'local'` | Backend used when a call omits `opts.backend`. |
| `cookieMaxAgeDays` | number | `365` | Cookie lifetime in days. |
| `cookieSameSite` | `'Lax' \| 'Strict' \| 'None'` | `'Lax'` | Cookie `SameSite` attribute. |
| `idbDbName` | string | `'omosuen-storage'` | IndexedDB database name. |
| `idbStoreName` | string | `'kv'` | IndexedDB object-store name. |
| `mirror` | `MirrorConfig` | — | Optional data-layer auto-mirror (`{ dataLayer, backend?, key?, autosaveMs? }`). |

Every call except `exportToFile`/`importFromFile` takes an optional
`opts: { backend? }` to override `defaultBackend` for that call.

| Method | Notes |
| --- | --- |
| `set(key, value, opts?)` | Store a JSON-serializable value. Resolves `false` on a rejected write (quota, unavailable, oversize). |
| `get(key, opts?)` | Read a stored value, or `null`. |
| `remove(key, opts?)` | Delete a key. |
| `has(key, opts?)` | Whether a key exists. |
| `keys(opts?)` | List keys in this namespace. |
| `clear(opts?)` | Clear all keys in this namespace. |
| `saveNexus(nexus, key, opts?)` | Serialize a nexus subtree (any nexus, not just the scene root). |
| `loadNexus(key, opts?)` | Deserialize a saved nexus snapshot. Scene-replace oriented — pair with `switchScene`. |
| `exportToFile(payload, suggestedName?)` | File System Access export (gesture-gated). |
| `importFromFile()` | File System Access import (gesture-gated). |
| `saveMirror()` | Manually persist the linked data-layer immediately. |

Lifecycle: `init` hydrates the mirror (if configured) from storage; `update` autosaves
the mirror on `mirror.autosaveMs`; `dispose` does a final mirror save.

## License

ISC.
