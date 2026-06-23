import type { ComponentData, ComponentOptions, ComponentTypeDefinition } from 'omosuen';
export interface AsepriteLoaderOptions extends ComponentOptions {
    filePath: string;
    flatten?: boolean;
    visibleOnly?: boolean;
    packageId?: string;
    layerSlots?: Record<string, string>;
}
export interface AsepriteLoaderT extends ComponentData {
    type: 'aseprite-loader';
    filePath: string;
    flatten: boolean;
    visibleOnly: boolean;
    packageId: string;
    layerSlots?: Record<string, string>;
}
/**
 * The full plugin definition. Pass to
 * `Omosuen.init({ plugins: [asepriteLoaderDefinition] })` (TS path) or register
 * it from the self-registering JS file (see browser.ts).
 */
export declare const asepriteLoaderDefinition: ComponentTypeDefinition;
