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
 * Parses an Aseprite buffer and builds a fully-animated, optionally-layered
 * entity into `config.parent`: composited texture-maps + sprites + an
 * animation-controller (tags → animations with per-frame durations). Browser-only
 * (uses canvas); the parser it calls is environment-agnostic.
 */
export declare function importAseprite(buffer: ArrayBuffer, config: AsepriteImportConfig): Promise<AsepriteImportResult>;
