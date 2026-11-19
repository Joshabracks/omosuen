import type { ResolvedSource } from '../../fog-of-war/sweep';
export declare const MAX_BINS_PER_AXIS = 256;
export declare const VIS_TEX_WIDTH = 1024;
export declare const TEXELS_PER_SHAPE = 2;
export declare function isBoxShape(s: ResolvedSource): boolean;
export declare function boxVisibility(cx: number, cy: number, cz: number, center: {
    x: number;
    y: number;
    z: number;
}, half: {
    x: number;
    y: number;
    z: number;
}, fade: number): number;
export declare function cellCentreOf(p: number, cellSize: number): number;
export interface ShapeGrid {
    originX: number;
    originZ: number;
    binSize: number;
    binsX: number;
    binsZ: number;
    offsets: Uint32Array;
    indices: Uint32Array;
    indexCount: number;
    cursor: Uint32Array;
}
export declare function createShapeGrid(): ShapeGrid;
export interface GridClamp {
    minX: number;
    minZ: number;
    maxX: number;
    maxZ: number;
}
export declare function binCount(grid: ShapeGrid): number;
export declare function buildShapeGrid(grid: ShapeGrid, shapes: readonly ResolvedSource[], count: number, minBinSize: number, boxPad: number, clamp: GridClamp | null): void;
export declare function binIndexAt(grid: ShapeGrid, x: number, z: number): number;
export declare function gatherShapesAt(grid: ShapeGrid, shapes: readonly ResolvedSource[], x: number, z: number, out: ResolvedSource[]): ResolvedSource[];
export declare function gatherShapesInRect(grid: ShapeGrid, shapes: readonly ResolvedSource[], shapeCount: number, minX: number, minZ: number, maxX: number, maxZ: number, out: ResolvedSource[]): ResolvedSource[];
export declare function texRows(texels: number): number;
export declare function packShapeTexels(shapes: readonly ResolvedSource[], count: number, out: Float32Array): void;
export declare function packBinWords(grid: ShapeGrid, out: Uint32Array): number;
export declare function binWordCount(grid: ShapeGrid): number;
//# sourceMappingURL=visibility-shapes.d.ts.map