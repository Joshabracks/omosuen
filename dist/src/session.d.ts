import { Vector2D, Vector3D } from 'omosuen';
import type { AseFile } from './parser/types.js';
import { type FrameSelector, type LayerSelection } from './selection.js';
/** One file in a session. */
export interface AsepriteSourceSpec {
    /** Source id; prefixes animation names in a multi-source set ('' for single-file). */
    key: string;
    /** Static URL (fetched + indexed once per URL, then cached). */
    filePath?: string;
    /** Raw bytes instead of a URL (programmatic single-file import). */
    buffer?: ArrayBuffer;
    /** Default layer selection: only Aseprite-visible layers. Ignored when `layers` is set. */
    visibleOnly: boolean;
    /** Layers to load (names or predicate). Overrides `visibleOnly`. */
    layers?: LayerSelection;
    /** Tags / frames to load. Default: every frame, one animation per tag. */
    frames?: FrameSelector[];
}
export interface AsepriteSessionConfig {
    /** 'single': un-prefixed names, private texture-maps. 'set': shared by layer name. */
    mode: 'single' | 'set';
    /** Entity nexus that gets the sprites + controller (+ private texture-maps). */
    parent: any;
    atlasManager: any;
    /** Owner of shared texture-maps / animation-map (set mode; typically the scene root). */
    sharedParent?: any;
    packageId: string;
    flatten: boolean;
    anchor?: Vector2D;
    anchorMode?: 'center' | 'bottom-center';
    position?: Vector3D;
    scale?: Vector3D;
    layerSlots?: Record<string, string>;
}
/** A change to an entity's selection (`extend` adds it, `release` removes it). */
export interface AsepriteSelectionChange {
    /** Layer names. Not supported on a flattened loader. */
    layers?: string[];
    /** Tags / frames, in the same forms as the `frames` option. */
    frames?: FrameSelector[];
    /** Multi-source only: limit the change to one source id. Default: every source. */
    source?: string;
}
/** The handle a caller keeps to change or tear down an import. */
export interface AsepriteLoaderHandle {
    readonly controller: any | null;
    readonly sprites: any[];
    extend(change: AsepriteSelectionChange): Promise<void>;
    release(change: AsepriteSelectionChange): Promise<void>;
    dispose(): void;
}
/**
 * Forgets every cached file index (and the bytes it holds). Entities already
 * built keep working; the next import or `extend` of a file re-fetches it.
 */
export declare function clearAsepriteCache(): void;
export declare class AsepriteSession implements AsepriteLoaderHandle {
    private readonly config;
    controller: any | null;
    private readonly sources;
    private readonly setKey;
    private readonly cellW;
    private readonly cellH;
    private readonly layerOrder;
    private readonly ownTextures;
    private held;
    private readonly spriteByName;
    private flatSuffix;
    private disposed;
    private constructor();
    /** Fetches/indexes the sources, then builds the entity into `config.parent`. */
    static create(specs: AsepriteSourceSpec[], config: AsepriteSessionConfig): Promise<AsepriteSession>;
    get sprites(): any[];
    extend(change: AsepriteSelectionChange): Promise<void>;
    release(change: AsepriteSelectionChange): Promise<void>;
    /**
     * Gives back every frame reference and drops this entity's own texture-maps.
     * Shared frames nobody else holds leave their texture-map now; the atlas
     * reclaims their space on its next compile.
     */
    dispose(): void;
    private build;
    private change;
    private selectedLayers;
    /** Every (texture name → absolute frame → what to draw) the selection needs. */
    private desired;
    private textureOwner;
    private textureKey;
    private textureFor;
    /** Brings textures, sprites and the atlas in line with the current selection. */
    private apply;
    /** Sprite/layer names in stable draw order (file layer order across the set). */
    private orderedNames;
    private layerBinding;
    private syncSprites;
    /** The animations the selection exposes, in absolute frame numbers. */
    private animations;
    /** Adds/removes controller animations to match the selection. */
    private syncAnimations;
    private currentFrame;
    private firstHeldFrame;
}
/**
 * Resolves the sprite anchor: an explicit pixel `anchor` wins; else the named
 * mode against the file's canvas size ('bottom-center' = foot-anchored); else
 * center.
 */
export declare function resolveAnchor(ase: AseFile, config: {
    anchor?: Vector2D;
    anchorMode?: 'center' | 'bottom-center';
}): Vector2D;
/**
 * Disposes and removes this nexus's loader-generated children. Children are
 * engine component proxies, so `child.dispose()` dispatches the right teardown.
 */
export declare function removeGeneratedChildren(parent: any): void;
