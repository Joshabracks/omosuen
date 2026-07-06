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
 * One resolved source for `importAsepriteSources`: a fetched .aseprite buffer
 * plus its namespace `id` and effective (loader-default-resolved) options. The
 * component's `init` builds these from its `sources` array.
 */
export interface AsepriteSourceEntry {
    buffer: ArrayBuffer;
    /** Namespace prefix for this source's sprites / tags / texture keys. */
    id: string;
    flatten: boolean;
    visibleOnly: boolean;
    /** Within-source mutually-exclusive layers (raw layer name → slot name). */
    layerSlots?: Record<string, string>;
}
/** Shared config for the multi-source orchestrator. */
export interface AsepriteSourcesConfig {
    parent: any;
    atlasManager: any;
    /** Atlas-namespace root; also names the transform and controller. */
    packageId: string;
    anchor?: Vector2D;
    anchorMode?: 'center' | 'bottom-center';
    position?: Vector3D;
    scale?: Vector3D;
}
/**
 * Parses an Aseprite buffer and builds a fully-animated, optionally-layered
 * entity into `config.parent`: composited texture-maps + sprites + an
 * animation-controller (tags → animations with per-frame durations). Browser-only
 * (uses canvas); the parser it calls is environment-agnostic.
 */
export declare function importAseprite(buffer: ArrayBuffer, config: AsepriteImportConfig): Promise<AsepriteImportResult>;
/**
 * Multi-source variant: ingests several .aseprite files into ONE entity nexus —
 * one merged animation-controller, one atlas pass — with every source's sprites,
 * layers, and tags namespaced by its `id` so nothing collides.
 *
 * Namespacing (vs the single-source `importAseprite`, which stays un-prefixed):
 *   - sprite / layer name : `${id}:${layerName}`  (flattened source: `${id}`)
 *   - texture key         : `aseprite:${id}:${build}`
 *   - synthetic filePath  : `aseprite://${id}/${build}`
 *   - animation name      : `${id}-${tagName}`
 *
 * The engine `slot` is used ONLY for per-source `layerSlots` (mutually-exclusive
 * layers within one source, e.g. hair A/B/C) and its value is itself id-namespaced
 * so two sources' identically-named slots don't become cross-source exclusive.
 * Source-group visibility (show one variant, hide the rest) is the caller's job,
 * done by toggling every layer whose name starts with `${id}:` — NOT via `slot`.
 *
 * The once-per-loader steps (removeGeneratedChildren, ensure transform,
 * processTextureMaps) run exactly once around the per-source loop.
 */
export declare function importAsepriteSources(entries: AsepriteSourceEntry[], config: AsepriteSourcesConfig): Promise<AsepriteImportResult>;
