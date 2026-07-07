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
 * One entry in a multi-file loader's `sources` array. Each contributes its own
 * texture-maps + sprites (namespaced by `id`) to the SAME entity nexus and a
 * shared animation-controller with `${id}-${tag}` animation names. Per-source
 * `flatten`/`visibleOnly` fall back to the loader-level defaults.
 */
export interface AsepriteSourceOptions {
  /** Required static URL, same convention as the single-file `filePath`. */
  filePath: string;
  /** Namespace prefix for this source. Default: basename(filePath) sans extension. */
  id?: string;
  flatten?: boolean;
  visibleOnly?: boolean;
  /** Within-source mutually-exclusive layers (raw layer name → slot name). */
  layerSlots?: Record<string, string>;
}

export interface AsepriteLoaderOptions extends ComponentOptions {
  /** Single-file shorthand. Omit when using `sources`. */
  filePath?: string;
  /** Multi-file: several .aseprite files into one entity + one controller. */
  sources?: AsepriteSourceOptions[];
  flatten?: boolean;
  visibleOnly?: boolean;
  packageId?: string;
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
  sources?: AsepriteSourceOptions[];
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

/** Filename without directory or `.aseprite` / `.ase` extension. */
function basename(filePath: string): string {
  const file = filePath.split(/[\\/]/).pop() ?? filePath;
  return file.replace(/\.(aseprite|ase)$/i, '');
}

/**
 * Multi-file init: dedupe `sources` by filePath and resolve each source's
 * effective options against the loader defaults into descriptors, then hand them
 * to `importAsepriteSources`. Fetching is deferred to the importer so repeat
 * spawns of the same art set (blueprint fast-path) never touch the network.
 */
async function initFromSources(
  a: AsepriteLoaderT,
  parent: unknown,
  atlasManager: unknown,
  sceneRoot: unknown,
): Promise<void> {
  const seen = new Set<string>();
  const entries: AsepriteSourceEntry[] = [];
  for (const s of a.sources ?? []) {
    if (seen.has(s.filePath)) {
      console.warn(
        `[aseprite-loader] '${a.name}' skipping duplicate source '${s.filePath}'`,
      );
      continue;
    }
    seen.add(s.filePath);
    entries.push({
      filePath: s.filePath,
      id: s.id ?? basename(s.filePath),
      flatten: s.flatten ?? a.flatten,
      visibleOnly: s.visibleOnly ?? a.visibleOnly,
      layerSlots: s.layerSlots,
    });
  }

  if (entries.length === 0) {
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
      if (a.sources && a.sources.length > 0) {
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
  const hasSources = Array.isArray(d.sources) && d.sources.length > 0;
  if (!hasFilePath && !hasSources) {
    return {
      component: null,
      errors: [
        {
          code: 'MISSING_FILEPATH',
          message: 'aseprite-loader requires a filePath or a non-empty sources array',
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
