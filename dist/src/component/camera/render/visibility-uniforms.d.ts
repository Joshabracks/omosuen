import type { VisionSourceT } from '../../vision-source/data';
import type { VisibilityVolumeT } from '../../visibility-volume/data';
import type { ResolvedSource } from '../../fog-of-war/sweep';
import type { Vector3D } from '../../../math';
import type { ShapeGrid } from './visibility-shapes';
import type { ShapeProjection } from './vision-selection';
export interface VisibilityCandidate {
    kind: 'vision-source' | 'visibility-volume';
    component: VisionSourceT | VisibilityVolumeT;
    position: Vector3D;
    score: number;
    priority: number;
}
export type VisibilitySelector = (candidates: VisibilityCandidate[], capacity: number) => void;
export interface VisibilityStats {
    capacity: number;
    resolved: number;
    uploaded: number;
    dropped: number;
}
export interface VisibilityCellInfo {
    cellSize: {
        x: number;
        y: number;
        z: number;
    };
    windowOriginLocalCell: {
        x: number;
        y: number;
        z: number;
    };
    windowSize: {
        x: number;
        y: number;
        z: number;
    };
}
export interface VisibilityFrameOptions {
    capacity: number;
    selector: VisibilitySelector | null;
    projection: ShapeProjection;
    cell: VisibilityCellInfo | null;
}
export interface VisibilityFrame {
    shapes: ResolvedSource[];
    count: number;
    grid: ShapeGrid;
    resolved: number;
}
export declare function cacheVisibilityUniformLocations(gl: WebGL2RenderingContext, program: WebGLProgram, cameraId: number): void;
export declare function clearVisibilityUniformCache(gl: WebGL2RenderingContext | null, cameraId: number): void;
export declare function deviceShapeLimit(gl: WebGL2RenderingContext): number;
export declare function prepareVisibilityFrame(gl: WebGL2RenderingContext, cameraId: number, visionSources: readonly VisionSourceT[], volumes: readonly VisibilityVolumeT[], options: VisibilityFrameOptions): void;
export declare function bindVisibilityUniforms(gl: WebGL2RenderingContext, cameraId: number, useLineOfSight: boolean): void;
export declare function getVisibilityFrame(): VisibilityFrame;
export declare function getVisibilityStats(): VisibilityStats;
//# sourceMappingURL=visibility-uniforms.d.ts.map