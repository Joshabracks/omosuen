import { Vector3D } from '../../../math';
import { CameraT } from '../data';
export interface ProjectionParams {
    viewportWidth: number;
    viewportHeight: number;
    zoom: number;
    projScale: number;
    sinA: number;
    heightScale: number;
    camIsoX: number;
    camIsoY: number;
    degenerate: boolean;
}
export declare function resolveProjection(camera: CameraT, out: ProjectionParams): boolean;
export declare function rawDepth(p: ProjectionParams, x: number, y: number, z: number): number;
export declare function worldToScreen(p: ProjectionParams, x: number, y: number, z: number, out: {
    x: number;
    y: number;
}): void;
export declare function screenToWorldAtHeight(p: ProjectionParams, px: number, py: number, wy: number, out: Vector3D): void;
export declare function viewDirInto(p: ProjectionParams, out: Vector3D): void;
export declare function screenToWorldRayInto(p: ProjectionParams, px: number, py: number, outOrigin: Vector3D, outDir: Vector3D): void;
export declare function screenToWorldRay(camera: CameraT, px: number, py: number, outOrigin: Vector3D, outDir: Vector3D): boolean;
//# sourceMappingURL=ray.d.ts.map