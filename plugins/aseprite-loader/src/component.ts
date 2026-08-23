// The `aseprite-loader` plugin component: a declarative, serializable handle to a
// .aseprite file. On init it statically fetches + parses the file and builds the
// entity's sprites + animation-controller + texture-maps into its own nexus (all
// flagged `_generated`, so the scene serializer keeps only this declaration and
// the pixels/atlas regenerate on load). Same fully-static `filePath` convention
// as the engine's audio-track / texture-map.

import {
  ComponentUnique,
  castTo,
  getActiveScene,
} from 'omosuen';
import type {
  ComponentData,
  ComponentOptions,
  ComponentMethods,
  ComponentSerializer,
  ComponentTypeDefinition,
} from 'omosuen';
import { importAseprite, importAsepriteSources } from './import.js';
import type { AsepriteSourceEntry } from './import.js';

const TYPE = 'aseprite-loader';

export type AnchorMode = 'center' | 'bottom-center';

/**
 * One entry in a multi-file loader's `sources` map. Every source in the set
 * shares sprites by LAYER NAME with every other source (one sprite total per
 * unique layer name across the whole set, not per source) and contributes to a
 * shared animation-controller with `${sourceKey}-${tag}` animation names.
 * `visibleOnly` falls back to the loader-level default; `flatten`/`layerSlots`
 * are set-level only (`AsepriteLoaderOptions.flatten`/`layerSlots`) — see
 * `import.ts`'s `importAsepriteSources` doc for why per-source flatten doesn't
 * have a clean meaning under shared-by-layer-name ingestion.
 */
export interface AsepriteSourceOptions {
  /** Required static URL, same convention as the single-file `filePath`. */
  filePath: string;
  visibleOnly?: boolean;
}

export interface AsepriteLoaderOptions extends ComponentOptions {
  /** Single-file shorthand. Omit when using `sources`. */
  filePath?: string;
  /**
   * Multi-file: several .aseprite files sharing sprites by layer name into one
   * entity + one controller. Keyed by source id (e.g. `{ archer: '...', miner: '...' }`);
   * a bare string value is shorthand for `{ filePath: value }`. Object key order
   * drives frame-index allocation — do not use numeric-string keys (JS reorders
   * them ahead of insertion order regardless of declaration order).
   */
  sources?: Record<string, string | AsepriteSourceOptions>;
  flatten?: boolean;
  visibleOnly?: boolean;
  packageId?: string;
  /** Layer-name → slot map; layers sharing a slot are mutually exclusive. Set-level: keyed by the shared layer name, not by source. */
  layerSlots?: Record<string, string>;
  /**
   * Sprite anchor, resolved against the .ase canvas size at load (no dimension
   * math needed). 'center' (default) centers the sprite on the transform;
   * 'bottom-center' foot-anchors it so billboards stand on the ground.
   */
  anchorMode?: AnchorMode;
}

export interface AsepriteLoaderT extends ComponentData {
  type: 'aseprite-loader';
  /** Empty string when the loader is driven by `sources` instead. */
  filePath: string;
  sources?: Record<string, string | AsepriteSourceOptions>;
  flatten: boolean;
  visibleOnly: boolean;
  packageId: string;
  layerSlots?: Record<string, string>;
  anchorMode: AnchorMode;
}

const PROPERTY_ALLOWLIST: string[] = [
  'filePath',
  'sources',
  'flatten',
  'visibleOnly',
  'packageId',
  'layerSlots',
  'anchorMode',
];

function builder(options: AsepriteLoaderOptions): AsepriteLoaderT {
  return {
    type: TYPE,
    name: options.name,
    unique: ComponentUnique.LOCAL,
    parent: null,
    _disposed: false,
    filePath: options.filePath ?? '',
    sources: options.sources,
    flatten: options.flatten ?? true,
    visibleOnly: options.visibleOnly ?? true,
    packageId: options.packageId ?? options.name,
    layerSlots: options.layerSlots,
    anchorMode: options.anchorMode ?? 'center',
  } as unknown as AsepriteLoaderT;
}

/**
 * Multi-file init: resolve each source's effective options against the loader
 * defaults into a keyed entries map, then hand them + the set-level `flatten`/
 * `layerSlots` to `importAsepriteSources`. Fetching is deferred to the importer
 * so repeat spawns of the same art set (blueprint fast-path) never touch the
 * network.
 */
async function initFromSources(
  a: AsepriteLoaderT,
  parent: unknown,
  atlasManager: unknown,
  sceneRoot: unknown,
): Promise<void> {
  const entries: Record<string, AsepriteSourceEntry> = {};
  for (const [key, s] of Object.entries(a.sources ?? {})) {
    const opts = typeof s === 'string' ? { filePath: s } : s;
    entries[key] = {
      filePath: opts.filePath,
      visibleOnly: opts.visibleOnly ?? a.visibleOnly,
    };
  }

  if (Object.keys(entries).length === 0) {
    console.warn(
      `[aseprite-loader] '${a.name}' has no sources; nothing imported`,
    );
    return;
  }

  await importAsepriteSources(entries, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parent: parent as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    atlasManager: atlasManager as any,
    // Shared texture-maps + animation-map live on the scene root so they outlive
    // any single entity's dispose/re-skin.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sharedParent: sceneRoot as any,
    packageId: a.packageId,
    anchorMode: a.anchorMode,
    flatten: a.flatten,
    layerSlots: a.layerSlots,
  });
}

const methods: ComponentMethods = {
  type: TYPE,

  async init(component: ComponentData): Promise<void> {
    const a = component as AsepriteLoaderT;
    if (!a.parent) {
      console.warn(
        `[aseprite-loader] Cannot initialize '${a.name}' - no parent nexus`,
      );
      return;
    }
    const parent = castTo(a.parent);

    const scene = getActiveScene();
    if (!scene) {
      console.warn(
        `[aseprite-loader] Cannot initialize '${a.name}' - no active scene`,
      );
      return;
    }
    const atlasManager = scene.getComponentByType('atlas-manager', true);
    if (!atlasManager) {
      console.warn(
        `[aseprite-loader] '${a.name}' found no atlas-manager in the scene; cannot ingest`,
      );
      return;
    }

    try {
      if (a.sources && Object.keys(a.sources).length > 0) {
        await initFromSources(a, parent, atlasManager, scene);
      } else {
        const response = await fetch(a.filePath);
        if (!response.ok) {
          console.error(
            `[aseprite-loader] Failed to fetch '${a.filePath}' for '${a.name}': ${response.status} ${response.statusText}`,
          );
          return;
        }
        const buffer = await response.arrayBuffer();
        await importAseprite(buffer, {
          parent,
          atlasManager,
          packageId: a.packageId,
          flatten: a.flatten,
          visibleOnly: a.visibleOnly,
          layerSlots: a.layerSlots,
          anchorMode: a.anchorMode,
        });
      }
    } catch (error) {
      console.error(`[aseprite-loader] Failed to import '${a.name}'`, error);
    }
  },

  dispose(component: ComponentData): void {
    component._disposed = true;
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serialize(component: ComponentData): any {
  const a = component as AsepriteLoaderT;
  return {
    type: TYPE,
    name: a.name,
    filePath: a.filePath,
    sources: a.sources,
    flatten: a.flatten,
    visibleOnly: a.visibleOnly,
    packageId: a.packageId,
    layerSlots: a.layerSlots,
    anchorMode: a.anchorMode,
  };
}

function deserialize(data: unknown): {
  component: AsepriteLoaderT | null;
  errors: { code: string; message: string }[];
} {
  if (!data || typeof data !== 'object') {
    return {
      component: null,
      errors: [
        {
          code: 'INVALID_DATA',
          message: 'aseprite-loader deserialize received non-object data',
        },
      ],
    };
  }
  const d = data as Partial<AsepriteLoaderT>;
  if (d.type !== TYPE) {
    return {
      component: null,
      errors: [
        {
          code: 'TYPE_MISMATCH',
          message: `type ${String(d.type)} does not match "${TYPE}"`,
        },
      ],
    };
  }
  if (!d.name) {
    return {
      component: null,
      errors: [
        { code: 'MISSING_NAME', message: 'aseprite-loader requires a name' },
      ],
    };
  }
  const hasFilePath = typeof d.filePath === 'string' && d.filePath.length > 0;
  const hasSources =
    d.sources !== null &&
    typeof d.sources === 'object' &&
    !Array.isArray(d.sources) &&
    Object.keys(d.sources).length > 0;
  if (!hasFilePath && !hasSources) {
    return {
      component: null,
      errors: [
        {
          code: 'MISSING_FILEPATH',
          message: 'aseprite-loader requires a filePath or a non-empty sources map',
        },
      ],
    };
  }
  return {
    component: builder({
      name: d.name,
      filePath: d.filePath,
      sources: d.sources,
      flatten: d.flatten,
      visibleOnly: d.visibleOnly,
      packageId: d.packageId,
      layerSlots: d.layerSlots,
      anchorMode: d.anchorMode,
    }),
    errors: [],
  };
}

const serializer: ComponentSerializer = { serialize, deserialize };

/**
 * The full plugin definition. Pass to
 * `Omosuen.init({ plugins: [asepriteLoaderDefinition] })` (TS path) or register
 * it from the self-registering JS file (see browser.ts).
 */
export const asepriteLoaderDefinition: ComponentTypeDefinition = {
  type: TYPE,
  // builder requires `filePath`; the registry's builder type takes the looser
  // ComponentOptions, so bridge through unknown (runtime options carry filePath).
  builder: builder as unknown as ComponentTypeDefinition['builder'],
  methods,
  propertyAllowlist: PROPERTY_ALLOWLIST,
  serializer,
};
