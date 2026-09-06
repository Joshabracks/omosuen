import type { ComponentData, ComponentMethods } from '../types';
import type { AtlasManagerT } from './data';
import type { TextureMapT } from '../texture-map/data';
export interface AtlasManagerMethods extends ComponentMethods {
    type: 'atlas-manager';
    initProgressive: (component: ComponentData) => AsyncGenerator<void>;
    addTextureMap: (am: AtlasManagerT, textureMap: TextureMapT) => void;
    rekeyTextureMap: (am: AtlasManagerT, textureMap: TextureMapT, oldKey: string) => void;
    removeTextureMap: (am: AtlasManagerT, textureMap: TextureMapT) => void;
    getTextureMap: (am: AtlasManagerT, key: string) => TextureMapT | null;
    getOrCreateTextureMap: (am: AtlasManagerT, key: string, factory: () => Promise<TextureMapT | null>) => Promise<TextureMapT | null>;
    processTextureMaps: (am: AtlasManagerT) => Promise<void>;
    getAtlas: (am: AtlasManagerT, index: number) => ImageData | undefined;
    getAtlasCount: (am: AtlasManagerT) => number;
    rebuildAtlases: (am: AtlasManagerT) => void;
    clear: (am: AtlasManagerT) => void;
    loadImage: (am: AtlasManagerT, filePath: string) => Promise<HTMLImageElement>;
    getImage: (am: AtlasManagerT, filePath: string) => CanvasImageSource | null;
    hasImage: (am: AtlasManagerT, filePath: string) => boolean;
    isLoading: (am: AtlasManagerT, filePath: string) => boolean;
    removeImage: (am: AtlasManagerT, filePath: string) => void;
    getImageCacheSize: (am: AtlasManagerT) => number;
    dispose: (component: ComponentData) => void;
}
export declare const AtlasManager: AtlasManagerMethods;
//# sourceMappingURL=methods.d.ts.map