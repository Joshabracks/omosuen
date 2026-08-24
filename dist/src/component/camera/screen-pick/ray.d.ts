import { Vector3D } from '../../../math';
import { CameraT } from '../data';
import { ProjectionParams } from './projection-math';
export type { ProjectionParams } from './projection-math';
export { rawDepth, worldToScreen, screenToWorldAtHeight, viewDirInto, } from './projection-math';
export declare function resolveProjection(camera: CameraT, out: ProjectionParams): boolean;
export declare function screenToWorldRayInto(p: ProjectionParams, px: number, py: number, outOrigin: Vector3D, outDir: Vector3D): void;
export declare function screenToWorldRay(camera: CameraT, px: number, py: number, outOrigin: Vector3D, outDir: Vector3D): boolean;
//# sourceMappingURL=ray.d.ts.map