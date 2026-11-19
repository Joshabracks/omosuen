import type { ComponentData, ComponentOptions, ComponentSerializer } from '../types';
import { ComponentUnique } from '../types';
import type { AtlasManagerMethods } from './methods';
import type { ComponentInstanceMethods } from '../types';
import type { PackerState, PackedRegion, AtlasDirtyRegion } from './types';
import type { TextureMapT } from '../texture-map/data';
export type AtlasSize = 1024 | 2048 | 4096 | 8192;
export interface AtlasManagerConfig {
    atlasSize?: AtlasSize;
    maxAtlases?: number;
    padding?: number;
    retainAtlas?: boolean;
}
export interface AtlasManagerT extends ComponentData, ComponentInstanceMethods<AtlasManagerMethods> {
    type: 'atlas-manager';
    unique: ComponentUnique.GLOBAL;
    textureMapIds: Set<string>;
    textureMapsByKey: Map<string, TextureMapT>;
    atlases: ImageData[];
    compiled: boolean;
    atlasVersion: number;
    config: Required<AtlasManagerConfig>;
    imageCache: Map<string, CanvasImageSource>;
    imageLoading: Map<string, Promise<HTMLImageElement>>;
    atlasCanvases: HTMLCanvasElement[];
    packState: PackerState | null;
    packedByKey: Map<string, PackedRegion>;
    _releaseScheduled: boolean;
    dirtyRegions: AtlasDirtyRegion[];
    fullVersion: number;
}
export declare const PROPERTY_ALLOWLIST: string[];
export interface AtlasManagerOptions extends ComponentOptions {
    config?: AtlasManagerConfig;
}
export declare function builder(options: AtlasManagerOptions): AtlasManagerT;
export declare const AtlasManagerSerializer: ComponentSerializer;
//# sourceMappingURL=data.d.ts.map