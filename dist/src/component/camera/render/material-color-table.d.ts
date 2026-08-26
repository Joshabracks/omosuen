import type { Material } from '../../cell-map/types';
import type { TextureMapT } from '../../texture-map';
export declare const MAX_MEMORY_MATERIALS = 64;
export declare function getMaterialAverageColor(material: Material, textureMapCache: Map<string, TextureMapT>, imageCache?: Map<string, CanvasImageSource>): [number, number, number];
export declare function buildMaterialColorTable(materials: Material[], textureMapCache: Map<string, TextureMapT>, imageCache?: Map<string, CanvasImageSource>): Float32Array;
//# sourceMappingURL=material-color-table.d.ts.map