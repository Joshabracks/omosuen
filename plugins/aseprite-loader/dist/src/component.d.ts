import type { ComponentData, ComponentOptions, ComponentTypeDefinition } from 'omosuen';
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
/**
 * The full plugin definition. Pass to
 * `Omosuen.init({ plugins: [asepriteLoaderDefinition] })` (TS path) or register
 * it from the self-registering JS file (see browser.ts).
 */
export declare const asepriteLoaderDefinition: ComponentTypeDefinition;
