import type { Vector2D, Vector3D } from 'omosuen';
import { type AsepriteLoaderHandle } from './session.js';
import type { FrameSelector, LayerSelection } from './selection.js';
/**
 * Configuration for ingesting an Aseprite file into an entity nexus. `parent`
 * and `atlasManager` are live engine component proxies.
 */
export interface AsepriteImportConfig {
    /** Nexus to populate (the `image-loader` component's own parent). */
    parent: any;
    /** Atlas manager the composited frames are packed into. */
    atlasManager: any;
    /** Unique namespace for texture keys / synthetic source paths. */
    packageId: string;
    /** Composite all layers into one sprite (default true) vs one per layer. */
    flatten?: boolean;
    /** Only include layers whose Aseprite visible flag is set (default true). Ignored when `layers` is given. */
    visibleOnly?: boolean;
    /**
     * Layers to load: names (every same-named layer matches) or a predicate.
     * Only these are decoded and composited; overrides `visibleOnly`.
     */
    layers?: LayerSelection;
    /**
     * Tags / frames to load: `'walk'` (a tag), `117` (an absolute frame),
     * `'walk:3'` / `{ tag: 'walk', frame: 3 }` (a tag-local frame). Only these
     * frames are decoded, composited and packed; only these animations exist.
     * Default: every frame, one animation per tag.
     */
    frames?: FrameSelector[];
    /** Sprite anchor in pixels (default: canvas center). Wins over `anchorMode`. */
    anchor?: Vector2D;
    /**
     * Named anchor, resolved to pixels against the parsed canvas size — so callers
     * needn't know the .ase dimensions. 'center' (default) = (w/2, h/2);
     * 'bottom-center' = (w/2, h) for ground-standing billboards.
     */
    anchorMode?: 'center' | 'bottom-center';
    /** Transform position, if a transform must be created (default 0,0,0). */
    position?: Vector3D;
    /** Transform scale, if a transform must be created (default 1,1,1). */
    scale?: Vector3D;
    /** Optional layer-name → slot map; layers sharing a slot are mutually exclusive. */
    layerSlots?: Record<string, string>;
}
/** What the import produced. */
export interface AsepriteImportResult {
    controller: any | null;
    sprites: any[];
    /** Live handle: `extend` / `release` the selection, or `dispose` to give it all back. */
    loader: AsepriteLoaderHandle;
}
/**
 * One source for `importAsepriteSources`: a .aseprite file's effective
 * (loader-default-resolved) options, keyed externally by its source id (see
 * `importAsepriteSources`'s `entries` param). The component's `init` builds
 * these from its `sources` map.
 */
export interface AsepriteSourceEntry {
    /** Static URL of the .aseprite file. Fetched and indexed once per URL, then cached. */
    filePath: string;
    visibleOnly: boolean;
    /** Layers to load from this source (see `AsepriteImportConfig.layers`). */
    layers?: LayerSelection;
    /** Tags / frames to load from this source (see `AsepriteImportConfig.frames`). */
    frames?: FrameSelector[];
}
/** Shared config for the multi-source orchestrator. */
export interface AsepriteSourcesConfig {
    /** The entity nexus that gets the per-instance sprites + controller. */
    parent: any;
    atlasManager: any;
    /**
     * Stable owner (typically the scene root) for the SHARED texture-maps +
     * animation-map, so they outlive any single entity's dispose/re-skin.
     */
    sharedParent: any;
    /** Atlas-namespace root; also names the transform and controller. */
    packageId: string;
    /** Composite all layers into one shared sprite (default true) vs one per layer name. Set-level: applies to every source in the set. */
    flatten?: boolean;
    anchor?: Vector2D;
    anchorMode?: 'center' | 'bottom-center';
    position?: Vector3D;
    scale?: Vector3D;
    /** Layer-name → slot map; layers sharing a slot are mutually exclusive. Set-level: keyed by the shared layer name, not by source. */
    layerSlots?: Record<string, string>;
}
/**
 * Parses an Aseprite buffer and builds a fully-animated, optionally-layered
 * entity into `config.parent`: composited texture-maps + sprites + an
 * animation-controller (tags → animations with per-frame durations). Only the
 * selected `layers` × `frames` are decoded. Browser-only (uses canvas); the
 * parser it calls is environment-agnostic.
 */
export declare function importAseprite(buffer: ArrayBuffer, config: AsepriteImportConfig): Promise<AsepriteImportResult>;
/**
 * Multi-source variant: ingests several .aseprite files into ONE entity nexus by
 * "horizontal" ingestion — one sprite (and one texture-map) per unique LAYER
 * NAME across the whole set, not one per source. A set where every source has
 * `main`/`outline` layers produces exactly 2 sprites total, however many sources
 * are in the set.
 *
 * Naming (vs the single-source `importAseprite`, which stays un-prefixed):
 *   - sprite / layer name : `${layerName}`  (flattened set: `${packageId}`) — shared, not per-source
 *   - texture key         : `aseprite:${artSetKey}:${layerName}`
 *   - animation name      : `${sourceKey}-${tagName}` — still per-source; this is how a caller
 *     "swaps costumes": play `${key}-walk` on the same small shared sprite set.
 *
 * Frame-index allocation: every source is assigned a disjoint block of the
 * SHARED frame-index space, `[offset, offset + frameCount)`, in source order;
 * every layer's texture-map uses those same indices, since the engine's
 * `AnimationController` applies one frame index to every layer in lockstep. A
 * texture-map holds only the frames some entity has selected, so a layer some
 * source doesn't contribute to has no frame data in that source's block — if a
 * caller leaves such a layer visible while that source's animation plays, the
 * renderer warns and skips drawing that frame rather than crashing.
 *
 * Texture-maps are shared by every entity of the same art set and hold the
 * union of their selections; each frame is reference counted, so entities with
 * different `layers` / `frames` coexist and the last one to let go of a frame
 * frees it. Files are fetched + indexed once per URL.
 */
export declare function importAsepriteSources(entries: Record<string, AsepriteSourceEntry>, config: AsepriteSourcesConfig): Promise<AsepriteImportResult>;
