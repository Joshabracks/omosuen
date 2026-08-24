import type { ComponentData, ComponentOptions, ComponentTypeDefinition } from 'omosuen';
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
/**
 * The full plugin definition. Pass to
 * `Omosuen.init({ plugins: [asepriteLoaderDefinition] })` (TS path) or register
 * it from the self-registering JS file (see browser.ts).
 */
export declare const asepriteLoaderDefinition: ComponentTypeDefinition;
