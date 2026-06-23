import type { ComponentData, ComponentOptions, ComponentTypeDefinition } from 'omosuen';
export type AnchorMode = 'center' | 'bottom-center';
export interface AsepriteLoaderOptions extends ComponentOptions {
    filePath: string;
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
    filePath: string;
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
