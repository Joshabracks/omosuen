import { Vector3D } from '../../math';
import type { CellMapT } from './data';
import type { RaycastHit, SurfaceHit, RaycastOptions } from './types';
export declare function getChunkTrianglesInBounds(cellMap: CellMapT, bounds: {
    min: Vector3D;
    max: Vector3D;
}): Array<[Vector3D, Vector3D, Vector3D]>;
export declare function raycastCellMap(cellMap: CellMapT, origin: Vector3D, dir: Vector3D, opts?: RaycastOptions): RaycastHit | null;
export declare function cellSurfacePoint(cellMap: CellMapT, cell: Vector3D, opts?: RaycastOptions): Vector3D;
export declare function sampleSurfaceHeight(cellMap: CellMapT, worldX: number, worldZ: number, opts?: RaycastOptions): SurfaceHit | null;
//# sourceMappingURL=raycast.d.ts.map