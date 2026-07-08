import type { ComponentApiDoc } from "./component-api-types";

const O = (
  key: string,
  type: string,
  desc: string,
  defaultValue?: string,
) => (defaultValue !== undefined ? { key, type, desc, default: defaultValue } : { key, type, desc });

const BASE_OPTIONS = [
  O("name", "string", "Component name passed to newComponent (required)."),
  O("overrideKey", "string?", "MethodRegistry key for custom init/update/show/hide overrides."),
  O("updateOverride", "string?", "MethodRegistry key for a custom per-frame update."),
  O("initOverride", "string?", "MethodRegistry key for custom init."),
];

const A = (name: string, type: string, desc: string) => ({ name, type, desc });
const M = (
  key: string,
  signature: string,
  desc: string,
  args: ReturnType<typeof A>[] = [],
) => (args.length > 0 ? { key, signature, desc, args } : { key, signature, desc });

function withBase(extra: ReturnType<typeof O>[]): ReturnType<typeof O>[] {
  return [...BASE_OPTIONS, ...extra];
}

export const PLUGIN_API: Record<string, ComponentApiDoc> = {
  "state-overlay": {
    options: withBase([
      O("bundleKey", "string?", "Key of a bundle registered via registerStateBundle."),
      O("cssOverrides", "Record<string,string>?", "Inline CSS on the overlay container.", "{}"),
    ]),
    data: [
      O("container", "HTMLElement", "Root DOM element (appended on init)."),
      O("bundleKey", "string?", "Registered State Street bundle key."),
      O("cssOverrides", "Record<string,string>", "Applied inline style overrides."),
      O("state", "State | null", "State Street instance (built lazily on first update)."),
      O("_stateBuilt", "boolean", "Whether the State instance has been constructed."),
    ],
    methods: [
      M("init", "init()", "Append container to document.body."),
      M("update", "update(dt)", "Lazily build State Street, then mountCheck + update.", [
        A("dt", "number", "Frame delta time from engine loop (ms)."),
      ]),
      M("dispose", "dispose()", "Destroy State instance and remove container."),
    ],
  },

  "aseprite-loader": {
    options: withBase([
      O("filePath", "string?", "Single .aseprite URL (omit when using sources).", "'./assets/hero.aseprite'"),
      O("sources", "AsepriteSourceOptions[]?", "Multi-file ingest into one entity."),
      O("flatten", "boolean?", "Composite layers into one sprite.", "true"),
      O("visibleOnly", "boolean?", "Skip layers hidden in Aseprite.", "true"),
      O("packageId", "string?", "Namespace for generated texture-map keys.", "'Hero'"),
      O("layerSlots", "Record<string,string>?", "Mutually-exclusive layer slots."),
      O("anchorMode", "'center' | 'bottom-center'?", "Sprite anchor against canvas size.", "'center'"),
    ]),
    data: [
      O("filePath", "string", "Source URL (empty when driven by sources)."),
      O("sources", "AsepriteSourceOptions[]?", "Multi-file source list."),
      O("flatten", "boolean", "Layer compositing mode."),
      O("visibleOnly", "boolean", "Skip hidden Aseprite layers."),
      O("packageId", "string", "Texture-map / animation namespace."),
      O("layerSlots", "Record<string,string>?", "Exclusive layer slot map."),
      O("anchorMode", "AnchorMode", "center | bottom-center."),
    ],
    methods: [
      M("init", "init()", "Fetch, parse, and build sprites + controller under parent nexus."),
      M("dispose", "dispose()", "Mark disposed."),
    ],
  },

  "browser-local-storage": {
    options: withBase([
      O("namespace", "string?", "Key prefix isolating this store.", "'SaveGame'"),
      O("defaultBackend", "StorageBackend?", "Backend when a call omits opts.backend.", "'local'"),
      O("cookieMaxAgeDays", "number?", "Cookie lifetime in days.", "365"),
      O("cookieSameSite", "'Lax' | 'Strict' | 'None'?", "Cookie SameSite attribute.", "'Lax'"),
      O("idbDbName", "string?", "IndexedDB database name.", "'omosuen-storage'"),
      O("idbStoreName", "string?", "IndexedDB object-store name.", "'kv'"),
      O("mirror", "MirrorConfig?", "Optional data-layer auto-mirror."),
    ]),
    data: [
      O("namespace", "string", "Storage key prefix."),
      O("defaultBackend", "StorageBackend", "local | session | cookie | idb."),
      O("cookieMaxAgeDays", "number", "Cookie max-age in days."),
      O("cookieSameSite", "'Lax' | 'Strict' | 'None'", "Cookie SameSite."),
      O("idbDbName", "string", "IndexedDB database."),
      O("idbStoreName", "string", "IndexedDB store."),
      O("mirror", "MirrorConfig | null", "Data-layer mirror config."),
    ],
    methods: [
      M("init", "init()", "Hydrate mirror from storage when configured."),
      M("update", "update(dt)", "Autosave mirror on interval.", [
        A("dt", "number", "Frame delta time from engine loop (ms)."),
      ]),
      M("dispose", "dispose()", "Final mirror save and timer cleanup."),
      M("set", "set(key, value, opts?)", "Store a JSON-serializable value.", [
        A("key", "string", "Storage key (namespaced)."),
        A("value", "unknown", "Value to persist."),
        A("opts", "StorageOptions?", "Backend override."),
      ]),
      M("get", "get(key, opts?)", "Read a stored value.", [
        A("key", "string", "Storage key (namespaced)."),
        A("opts", "StorageOptions?", "Backend override."),
      ]),
      M("remove", "remove(key, opts?)", "Delete a key.", [
        A("key", "string", "Storage key (namespaced)."),
        A("opts", "StorageOptions?", "Backend override."),
      ]),
      M("has", "has(key, opts?)", "Whether key exists.", [
        A("key", "string", "Storage key (namespaced)."),
        A("opts", "StorageOptions?", "Backend override."),
      ]),
      M("keys", "keys(opts?)", "List keys in this namespace.", [
        A("opts", "StorageOptions?", "Backend override."),
      ]),
      M("clear", "clear(opts?)", "Clear all keys in this namespace.", [
        A("opts", "StorageOptions?", "Backend override."),
      ]),
      M("saveNexus", "saveNexus(nexus, key, opts?)", "Serialize a nexus subtree.", [
        A("nexus", "ComponentData", "Nexus root to serialize."),
        A("key", "string", "Storage key (namespaced)."),
        A("opts", "StorageOptions?", "Backend override."),
      ]),
      M("loadNexus", "loadNexus(key, opts?)", "Deserialize a saved nexus snapshot.", [
        A("key", "string", "Storage key (namespaced)."),
        A("opts", "StorageOptions?", "Backend override."),
      ]),
      M("exportToFile", "exportToFile(payload, suggestedName?)", "File System Access export (gesture-gated).", [
        A("payload", "unknown", "Data to write."),
        A("suggestedName", "string?", "Suggested download filename."),
      ]),
      M("importFromFile", "importFromFile()", "File System Access import (gesture-gated)."),
      M("saveMirror", "saveMirror()", "Manually persist linked data-layer."),
    ],
  },
};

export function getPluginApi(id: string): ComponentApiDoc | undefined {
  return PLUGIN_API[id];
}
