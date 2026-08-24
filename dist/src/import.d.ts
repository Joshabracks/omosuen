import { Vector2D, Vector3D } from 'omosuen';
/**
 * Configuration for ingesting an Aseprite file into an entity nexus. `parent`
 * and `atlasManager` are live engine component proxies.
 */
export interface AsepriteImportConfig {
    /** Nexus to populate (the `aseprite` component's own parent). */
    parent: any;
    /** Atlas manager the composited frames are packed into. */
    atlasManager: any;
    /** Unique namespace for texture keys / synthetic source paths. */
    packageId: string;
    /** Composite all layers into one sprite (default true) vs one per layer. */
    flatten?: boolean;
    /** Only include layers whose Aseprite visible flag is set (default true). */
    visibleOnly?: boolean;
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
}
/**
 * One resolved source for `importAsepriteSources`: a fetched .aseprite buffer's
 * effective (loader-default-resolved) options, keyed externally by its source id
 * (see `importAsepriteSources`'s `entries` param). The component's `init` builds
 * these from its `sources` map.
 */
export interface AsepriteSourceEntry {
    /** Static URL of the .aseprite file. Fetched lazily, ONLY on a full import. */
    filePath: string;
    visibleOnly: boolean;
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
 * animation-controller (tags → animations with per-frame durations). Browser-only
 * (uses canvas); the parser it calls is environment-agnostic.
 */
export declare function importAseprite(buffer: ArrayBuffer, config: AsepriteImportConfig): Promise<AsepriteImportResult>;
/**
 * Multi-source variant: ingests several .aseprite files into ONE entity nexus by
 * "horizontal" ingestion — one sprite (and one texture-map) per unique LAYER
 * NAME across the whole set, not one per source. A set where every source has
 * `main`/`outline` layers produces exactly 2 sprites total, however many sources
 * are in the set. Each layer's texture-map holds every contributing source's
 * frames concatenated left-to-right in one canvas.
 *
 * Naming (vs the single-source `importAseprite`, which stays un-prefixed):
 *   - sprite / layer name : `${layerName}`  (flattened set: `${packageId}`) — shared, not per-source
 *   - texture key         : `aseprite:${artSetKey}:${layerName}`
 *   - synthetic filePath  : `aseprite://${artSetKey}/${layerName}`
 *   - animation name      : `${sourceKey}-${tagName}` — still per-source; this is how a caller
 *     "swaps costumes": play `${key}-walk` on the same small shared sprite set.
 *
 * Frame-index allocation: every source is assigned a disjoint block of the
 * SHARED frame-index space, `[frameOffset, frameOffset + ase.frameCount)`, in
 * source order. Every layer's texture-map reserves that same block for that
 * source — the engine's `AnimationController` applies one frame index to every
 * layer in lockstep (`updateSpriteFrames`), so a source's frames must land at
 * the same offset in every layer, not just within one. A layer some source
 * doesn't contribute to simply has no frame data in that source's block —
 * `originalFrames` is sparse (safe: atlas-manager resolves frames by
 * position/size key, not array position). If a caller leaves such a layer
 * visible while that source's animation plays, the renderer warns and skips
 * drawing that frame rather than crashing — hide layers the active source
 * doesn't use, same as any other layer-visibility toggle.
 *
 * `layerSlots`/`flatten` are set-level (apply to the whole set), not per-source
 * — a flattened source has no real layer name to union against others', so
 * mixed flatten states have no clean shared-sprite meaning.
 *
 * The once-per-loader steps (removeGeneratedChildren, ensure transform,
 * processTextureMaps) run exactly once around the per-layer loop.
 */
export declare function importAsepriteSources(entries: Record<string, AsepriteSourceEntry>, config: AsepriteSourcesConfig): Promise<AsepriteImportResult>;
