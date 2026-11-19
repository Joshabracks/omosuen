// The `image-loader` plugin component: a declarative, serializable handle to a
// .aseprite file. On init it statically fetches + parses the file and builds the
// entity's sprites + animation-controller + texture-maps into its own nexus (all
// flagged `_generated`, so the scene serializer keeps only this declaration and
// the pixels/atlas regenerate on load). Same fully-static `filePath` convention
// as the engine's audio-track / texture-map.

import { ComponentUnique, castTo, getActiveScene } from 'omosuen';
import type {
  ComponentData,
  ComponentOptions,
  ComponentMethods,
  ComponentSerializer,
  ComponentTypeDefinition,
} from 'omosuen';
import { ImageChannelSpec, SpriteChannel, importImages } from './images.js';
import {
  AsepriteSession,
  type AsepriteSelectionChange,
  type AsepriteSourceSpec,
} from './session.js';
import type { FrameSelector, LayerSelection } from './selection.js';

const TYPE = 'image-loader';

export type AnchorMode = 'center' | 'bottom-center';

/**
 * One entry in a multi-file loader's `sources` map. Every source in the set
 * shares sprites by LAYER NAME with every other source (one sprite total per
 * unique layer name across the whole set, not per source) and contributes to a
 * shared animation-controller with `${sourceKey}-${tag}` animation names.
 * `visibleOnly`/`layers`/`frames` fall back to the loader-level defaults;
 * `flatten`/`layerSlots` are set-level only (`ImageLoaderOptions.flatten`/
 * `layerSlots`) — see `import.ts`'s `importAsepriteSources` doc for why
 * per-source flatten doesn't have a clean meaning under shared-by-layer-name
 * ingestion.
 */
export interface AsepriteSourceOptions {
  /** Required static URL, same convention as the single-file `filePath`. */
  filePath: string;
  visibleOnly?: boolean;
  /** Layers to load from this source; overrides the loader-level `layers`. */
  layers?: LayerSelection;
  /** Tags / frames to load from this source; overrides the loader-level `frames`. */
  frames?: FrameSelector[];
}

export interface ImageLoaderOptions extends ComponentOptions {
  /** Single-file shorthand. Omit when using `sources`. */
  filePath?: string;
  /**
   * Plain-image path: declare an image per sprite texture channel. Mutually
   * exclusive with `filePath`/`sources` (which parse Aseprite files).
   *
   * Each channel takes a URL, an array of per-frame URLs (composited into a
   * strip), or — for `material` — a `{ metallic, roughness, mask }` group that
   * is channel-packed into one image, removing the step where an artist merges
   * three grayscale files by hand.
   */
  images?: Partial<Record<SpriteChannel, ImageChannelSpec>>;
  /** Frame layout for single-image channels, passed through to `texture-map`. */
  imageType?: unknown;
  /**
   * Multi-file: several .aseprite files sharing sprites by layer name into one
   * entity + one controller. Keyed by source id (e.g. `{ archer: '...', miner: '...' }`);
   * a bare string value is shorthand for `{ filePath: value }`. Object key order
   * drives frame-index allocation — do not use numeric-string keys (JS reorders
   * them ahead of insertion order regardless of declaration order).
   */
  sources?: Record<string, string | AsepriteSourceOptions>;
  flatten?: boolean;
  /** Only Aseprite-visible layers (default true). Ignored when `layers` is given. */
  visibleOnly?: boolean;
  /**
   * Layers to load: names (every same-named layer matches) or a predicate
   * `(name, layer) => boolean`. Only these layers are decoded and composited.
   * A predicate isn't serializable — a saved scene falls back to `visibleOnly`.
   */
  layers?: LayerSelection;
  /**
   * Tags / frames to load: `'walk'` (a tag), `117` (an absolute frame),
   * `'walk:3'` or `{ tag: 'walk', frame: 3 }` (a frame of a tag, by position in
   * the tag). Only these frames are decoded and packed, and only these
   * animations exist (a lone frame becomes a one-frame animation named after its
   * selector). Default: every frame, one animation per tag.
   */
  frames?: FrameSelector[];
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

export interface ImageLoaderT extends ComponentData {
  type: 'image-loader';
  /** Empty string when the loader is driven by `sources`/`images` instead. */
  filePath: string;
  images?: Partial<Record<SpriteChannel, ImageChannelSpec>>;
  imageType?: unknown;
  sources?: Record<string, string | AsepriteSourceOptions>;
  flatten: boolean;
  visibleOnly: boolean;
  layers?: LayerSelection;
  frames?: FrameSelector[];
  packageId: string;
  layerSlots?: Record<string, string>;
  anchorMode: AnchorMode;
}

const PROPERTY_ALLOWLIST: string[] = [
  'filePath',
  'images',
  'imageType',
  'sources',
  'flatten',
  'visibleOnly',
  'layers',
  'frames',
  'packageId',
  'layerSlots',
  'anchorMode',
];

function builder(options: ImageLoaderOptions): ImageLoaderT {
  return {
    type: TYPE,
    name: options.name,
    unique: ComponentUnique.LOCAL,
    parent: null,
    _disposed: false,
    filePath: options.filePath ?? '',
    images: options.images,
    imageType: options.imageType,
    sources: options.sources,
    flatten: options.flatten ?? true,
    visibleOnly: options.visibleOnly ?? true,
    layers: options.layers,
    frames: options.frames,
    packageId: options.packageId ?? options.name,
    layerSlots: options.layerSlots,
    anchorMode: options.anchorMode ?? 'center',
  } as unknown as ImageLoaderT;
}

/**
 * Each Aseprite loader's live session (selection + held frames). Keyed by
 * component id, not object identity: `init` can receive the component's Proxy
 * while proxy method calls (`loader.extend(...)`) dispatch with the raw object,
 * so the two never compare equal. A promise, so an `extend` issued before init
 * finishes waits for it instead of being lost.
 */
const sessionsById = new Map<number, Promise<AsepriteSession | null>>();
const sessionsByRef = new WeakMap<object, Promise<AsepriteSession | null>>();

const sessions = {
  get(c: ComponentData): Promise<AsepriteSession | null> | undefined {
    return c.id !== undefined ? sessionsById.get(c.id) : sessionsByRef.get(c);
  },
  set(c: ComponentData, p: Promise<AsepriteSession | null>): void {
    if (c.id !== undefined) sessionsById.set(c.id, p);
    else sessionsByRef.set(c, p);
  },
  delete(c: ComponentData): void {
    if (c.id !== undefined) sessionsById.delete(c.id);
    else sessionsByRef.delete(c);
  },
};

/**
 * Multi-file init: resolve each source's effective options against the loader
 * defaults, then build one set-mode session. Files are fetched + indexed once
 * per URL (cached), so repeat spawns of the same art set never touch the
 * network.
 */
function sourcesSpecs(a: ImageLoaderT): AsepriteSourceSpec[] {
  return Object.entries(a.sources ?? {}).map(([key, s]) => {
    const opts = typeof s === 'string' ? { filePath: s } : s;
    return {
      key,
      filePath: opts.filePath,
      visibleOnly: opts.visibleOnly ?? a.visibleOnly,
      layers: opts.layers ?? a.layers,
      frames: opts.frames ?? a.frames,
    };
  });
}

async function startSession(
  a: ImageLoaderT,
  parent: unknown,
  atlasManager: unknown,
  scene: unknown,
): Promise<AsepriteSession | null> {
  const common = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parent: parent as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    atlasManager: atlasManager as any,
    packageId: a.packageId,
    flatten: a.flatten,
    anchorMode: a.anchorMode,
    layerSlots: a.layerSlots,
  };
  if (a.sources && Object.keys(a.sources).length > 0) {
    // Shared texture-maps + animation-map live on the scene root so they outlive
    // any single entity's dispose/re-skin.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return AsepriteSession.create(sourcesSpecs(a), { ...common, mode: 'set', sharedParent: scene as any });
  }
  return AsepriteSession.create(
    [{ key: '', filePath: a.filePath, visibleOnly: a.visibleOnly, layers: a.layers, frames: a.frames }],
    { ...common, mode: 'single' },
  );
}

async function withSession(
  component: ComponentData,
  verb: string,
  fn: (s: AsepriteSession) => Promise<void>,
): Promise<void> {
  const pending = sessions.get(component);
  const session = pending ? await pending : null;
  if (!session) {
    console.warn(`[image-loader] '${component.name}' ${verb}: no Aseprite import to change`);
    return;
  }
  await fn(session);
}

interface ImageLoaderMethods extends ComponentMethods {
  /**
   * Adds layers and/or tags/frames to a loaded entity, decoding and packing only
   * what's new — no re-fetch, no re-parse. New layers get sprites (honouring
   * `layerSlots`); new tags get animations.
   */
  extend: (component: ComponentData, change: AsepriteSelectionChange) => Promise<void>;
  /**
   * Removes layers and/or tags/frames. Frames no other entity holds leave their
   * texture-map, and the atlas reclaims their space on its next compile.
   * Releasing the playing animation stops it.
   */
  release: (component: ComponentData, change: AsepriteSelectionChange) => Promise<void>;
}

const methods: ImageLoaderMethods = {
  type: TYPE,

  extend(component: ComponentData, change: AsepriteSelectionChange): Promise<void> {
    return withSession(component, 'extend', (s) => s.extend(change));
  },

  release(component: ComponentData, change: AsepriteSelectionChange): Promise<void> {
    return withSession(component, 'release', (s) => s.release(change));
  },

  async init(component: ComponentData): Promise<void> {
    const a = component as ImageLoaderT;
    // A re-init replaces the previous import: give its frames back first.
    const previous = sessions.get(component);
    sessions.delete(component);
    if (previous) (await previous)?.dispose();
    if (!a.parent) {
      console.warn(
        `[image-loader] Cannot initialize '${a.name}' - no parent nexus`,
      );
      return;
    }
    const parent = castTo(a.parent);

    const scene = getActiveScene();
    if (!scene) {
      console.warn(
        `[image-loader] Cannot initialize '${a.name}' - no active scene`,
      );
      return;
    }
    const atlasManager = scene.getComponentByType('atlas-manager', true);
    if (!atlasManager) {
      console.warn(
        `[image-loader] '${a.name}' found no atlas-manager in the scene; cannot ingest`,
      );
      return;
    }

    try {
      if (a.images && Object.keys(a.images).length > 0) {
        await importImages({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          parent: parent as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          atlasManager: atlasManager as any,
          packageId: a.packageId,
          images: a.images,
          imageType: a.imageType,
          anchorMode: a.anchorMode,
        });
      } else {
        const pending = startSession(a, parent, atlasManager, scene).catch((error: unknown) => {
          console.error(`[image-loader] Failed to import '${a.name}'`, error);
          return null;
        });
        sessions.set(component, pending);
        const session = await pending;
        // Disposed while loading: hand back whatever the import just took.
        if (session && component._disposed) session.dispose();
      }
    } catch (error) {
      console.error(`[image-loader] Failed to import '${a.name}'`, error);
    }
  },

  dispose(component: ComponentData): void {
    component._disposed = true;
    const pending = sessions.get(component);
    sessions.delete(component);
    // Gives every frame reference back, so shared frames no other entity uses
    // leave their texture-maps (and the atlas reclaims them on its next compile).
    if (pending) void pending.then((s) => s?.dispose());
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serialize(component: ComponentData): any {
  const a = component as ImageLoaderT;
  return {
    type: TYPE,
    name: a.name,
    filePath: a.filePath,
    // URL-only by construction (see ImageLoaderOptions.images) so this round-trips.
    images: a.images,
    // `ImageType` is duck-typed on both sides (isFrameMap/isGridConfig test for
    // Array-ness and for `cellSize`/`gridSize` keys), and every reader touches
    // only .x/.y/.z/.w — so plain JSON objects survive the trip as-is.
    imageType: a.imageType,
    sources: serializableSources(a.sources),
    flatten: a.flatten,
    visibleOnly: a.visibleOnly,
    // The declared selection only — runtime `extend`/`release` changes aren't
    // saved, and a predicate `layers` can't be (the load falls back to visibleOnly).
    layers: serializableLayers(a.layers),
    frames: a.frames,
    packageId: a.packageId,
    layerSlots: a.layerSlots,
    anchorMode: a.anchorMode,
  };
}

function serializableLayers(layers: LayerSelection | undefined): string[] | undefined {
  return Array.isArray(layers) ? [...layers] : undefined;
}

function serializableSources(
  sources: Record<string, string | AsepriteSourceOptions> | undefined,
): Record<string, string | AsepriteSourceOptions> | undefined {
  if (!sources) return sources;
  const out: Record<string, string | AsepriteSourceOptions> = {};
  for (const [key, s] of Object.entries(sources)) {
    out[key] = typeof s === 'string' ? s : { ...s, layers: serializableLayers(s.layers) };
  }
  return out;
}

function isNonEmptyMap(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length > 0
  );
}

function deserialize(data: unknown): {
  component: ImageLoaderT | null;
  errors: { code: string; message: string }[];
} {
  if (!data || typeof data !== 'object') {
    return {
      component: null,
      errors: [
        {
          code: 'INVALID_DATA',
          message: 'image-loader deserialize received non-object data',
        },
      ],
    };
  }
  const d = data as Partial<ImageLoaderT>;
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
        { code: 'MISSING_NAME', message: 'image-loader requires a name' },
      ],
    };
  }
  const hasFilePath = typeof d.filePath === 'string' && d.filePath.length > 0;
  const hasSources = isNonEmptyMap(d.sources);
  const hasImages = isNonEmptyMap(d.images);
  if (!hasFilePath && !hasSources && !hasImages) {
    return {
      component: null,
      errors: [
        {
          code: 'MISSING_FILEPATH',
          message:
            'image-loader requires a filePath, a non-empty sources map, or a non-empty images map',
        },
      ],
    };
  }
  return {
    component: builder({
      name: d.name,
      filePath: d.filePath,
      images: d.images,
      imageType: d.imageType,
      sources: d.sources,
      flatten: d.flatten,
      visibleOnly: d.visibleOnly,
      layers: Array.isArray(d.layers) ? d.layers : undefined,
      frames: Array.isArray(d.frames) ? d.frames : undefined,
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
 * `Omosuen.init({ plugins: [imageLoaderDefinition] })` (TS path) or register
 * it from the self-registering JS file (see browser.ts).
 */
export const imageLoaderDefinition: ComponentTypeDefinition = {
  type: TYPE,
  // builder requires `filePath`; the registry's builder type takes the looser
  // ComponentOptions, so bridge through unknown (runtime options carry filePath).
  builder: builder as unknown as ComponentTypeDefinition['builder'],
  methods,
  propertyAllowlist: PROPERTY_ALLOWLIST,
  serializer,
};
