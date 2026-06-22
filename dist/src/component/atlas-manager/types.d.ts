import { Vector2D } from '../../math';
import type { SpaceTree } from './space-tree';
export interface UnpackedFrame {
    size: Vector2D;
    sourceImage: HTMLImageElement;
    sourcePosition: Vector2D;
    atlasPosition?: Vector2D;
    atlasIndex?: number;
}
export interface AtlasSpace {
    position: Vector2D;
    parent: AtlasSpace | null;
    size: Vector2D;
    slice: 'empty' | 'vertical' | 'horizontal';
    '0': UnpackedFrame | AtlasSpace | null;
    '1': AtlasSpace | null;
    rootIndex: number;
    uid: number;
}
export type FrameBucket = 'w' | 'h' | 's';
export interface PackedRegion {
    atlasIndex: number;
    atlasPosition: Vector2D;
    size: Vector2D;
}
export interface AtlasDirtyRegion {
    version: number;
    atlasIndex: number;
    x: number;
    y: number;
    w: number;
    h: number;
}
export interface SpaceBuckets {
    w: SpaceTree;
    h: SpaceTree;
    s: SpaceTree;
}
export interface PackerState {
    rootSpaces: AtlasSpace[];
    spaceBuckets: SpaceBuckets;
    currentAtlasIndex: number;
    atlasSize: number;
    maxAtlases: number;
    padding: number;
}
export declare function createRootAtlasSpace(index: number, size: Vector2D): AtlasSpace;
export declare function createChildAtlasSpace(parent: AtlasSpace, position: Vector2D, size: Vector2D): AtlasSpace;
export declare function getFrameBucket(frame: UnpackedFrame): FrameBucket;
export declare function compareByWidth(a: UnpackedFrame, b: UnpackedFrame): number;
export declare function compareByHeight(a: UnpackedFrame, b: UnpackedFrame): number;
export declare function compareBySize(a: UnpackedFrame, b: UnpackedFrame): number;
export declare function compareSpacesByWidth(a: AtlasSpace, b: AtlasSpace): number;
export declare function compareSpacesByHeight(a: AtlasSpace, b: AtlasSpace): number;
export declare function compareSpacesBySize(a: AtlasSpace, b: AtlasSpace): number;
//# sourceMappingURL=types.d.ts.map