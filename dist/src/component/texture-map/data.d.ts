import type { ComponentData, ComponentOptions, ComponentSerializer } from '../types';
import { ComponentUnique } from '../types';
import type { ImageType, OriginalFrame, PackedFrame } from './types';
import type { TextureMapMethods } from './methods';
import type { ComponentInstanceMethods } from '../types';
import { Vector2D } from '../../math';
export interface TextureMapT extends ComponentData, ComponentInstanceMethods<TextureMapMethods> {
    type: 'texture-map';
    unique: ComponentUnique.FALSE;
    textureMapKey: string;
    filePath: string;
    sourceImage?: CanvasImageSource;
    imageType: ImageType;
    originalFrames: OriginalFrame[];
    packedFrames: PackedFrame[];
    frameIndexMap: Map<number, PackedFrame>;
}
export declare const PROPERTY_ALLOWLIST: string[];
export interface TextureMapOptions extends ComponentOptions {
    textureMapKey: string;
    filePath: string;
    sourceImage?: CanvasImageSource;
    imageType?: ImageType;
    atlasManager?: unknown;
}
export declare function extractOriginalFrames(imageType: ImageType, imageSize?: Vector2D): OriginalFrame[];
export declare function builder(options: TextureMapOptions): TextureMapT;
export declare const TextureMapSerializer: ComponentSerializer;
//# sourceMappingURL=data.d.ts.map