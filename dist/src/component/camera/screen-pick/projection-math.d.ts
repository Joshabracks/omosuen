import { Vector3D } from '../../../math';
export declare const ISO_H = 0.8660254;
export interface ProjectionParams {
    viewportWidth: number;
    viewportHeight: number;
    zoom: number;
    projScale: number;
    sinA: number;
    heightScale: number;
    cosYaw: number;
    sinYaw: number;
    camIsoX: number;
    camIsoY: number;
    degenerate: boolean;
}
export declare function rawDepth(p: ProjectionParams, x: number, y: number, z: number): number;
export declare function worldToScreen(p: ProjectionParams, x: number, y: number, z: number, out: {
    x: number;
    y: number;
}): void;
export declare function screenToWorldAtHeight(p: ProjectionParams, px: number, py: number, wy: number, out: Vector3D): void;
export declare function viewDirInto(p: ProjectionParams, out: Vector3D): void;
//# sourceMappingURL=projection-math.d.ts.map