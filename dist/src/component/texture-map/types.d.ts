import { Vector2D, Vector4D } from '../../math';
export type FrameMap = Vector4D[];
export interface GridConfig {
    cellSize: Vector2D;
    gridSize: Vector2D;
    cellCount?: number;
}
export type ImageType = FrameMap | GridConfig | undefined;
export interface OriginalFrame {
    frameIndex: number;
    position: Vector2D;
    size: Vector2D;
}
export interface PackedFrame {
    frameIndex: number;
    atlasPosition: Vector2D;
    atlasIndex: number;
    size: Vector2D;
}
export declare function isFrameMap(imageType: ImageType): imageType is FrameMap;
export declare function isGridConfig(imageType: ImageType): imageType is GridConfig;
//# sourceMappingURL=types.d.ts.map