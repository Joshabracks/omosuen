import type { ComponentData, ComponentOptions, ComponentTypeDefinition } from 'omosuen';
import { ImageChannelSpec, SpriteChannel } from './images.js';
import type { FrameSelector, LayerSelection } from './selection.js';
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
/**
 * The full plugin definition. Pass to
 * `Omosuen.init({ plugins: [imageLoaderDefinition] })` (TS path) or register
 * it from the self-registering JS file (see browser.ts).
 */
export declare const imageLoaderDefinition: ComponentTypeDefinition;
