import { ComponentData, ComponentOptions, ComponentSerializer, ComponentUnique, ComponentInstanceMethods } from '../types';
import { Vector2D, Vector4D } from '../../math';
import type { SpriteMethods } from './methods';
export interface SpriteT extends ComponentData, ComponentInstanceMethods<SpriteMethods> {
    type: 'sprite';
    unique: ComponentUnique.LOCAL;
    textureMapKeys: {
        albedo: string;
        normal: string;
        material: string;
        emission: string;
    };
    frame: {
        albedo: number;
        normal: number;
        emission: number;
        material: number;
    };
    anchor: Vector2D;
    tint: Vector4D;
    opacity: number;
    showSilhouette: boolean;
    silhouetteColor: Vector4D;
}
export interface SpriteOptions extends ComponentOptions {
    textureMapKeys?: {
        albedo?: string;
        normal?: string;
        material?: string;
        emission?: string;
    };
    frame?: {
        albedo?: number;
        normal?: number;
        emission?: number;
        material?: number;
    };
    anchor?: Vector2D;
    tint?: Vector4D;
    opacity?: number;
    showSilhouette?: boolean;
    silhouetteColor?: Vector4D;
}
export declare function builder(options: SpriteOptions): SpriteT;
export declare const SpriteSerializer: ComponentSerializer;
export declare const PROPERTY_ALLOWLIST: string[];
//# sourceMappingURL=data.d.ts.map