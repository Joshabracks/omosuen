import { ComponentData, ComponentMethods } from '../types';
import { ColliderT } from './data';
import { CellMapT } from '../cell-map';
import { Vector3D } from '../../math';
export interface CellMapCollisionResult {
    hit: boolean;
    cells: Vector3D[];
    center: Vector3D | null;
}
export interface CollisionPipelineResult {
    occupiedCells: Map<ColliderT, Vector3D[]>;
    colliderPairs: Array<{
        a: ColliderT;
        b: ColliderT;
    }>;
    solidCellOverlaps: Map<ColliderT, Vector3D[]>;
    cellMapCollisions: Map<ColliderT, CellMapCollisionResult>;
}
export interface ProcessCollisionsOptions {
    skipMeshCheck?: boolean;
}
export interface ColliderMethods extends ComponentMethods {
    init: (component: ComponentData) => Promise<void>;
    getWorldCenter: (collider: ColliderT) => Vector3D;
    getWorldBounds: (collider: ColliderT) => {
        min: Vector3D;
        max: Vector3D;
    };
    intersectsCollider: (collider: ColliderT, other: ColliderT) => boolean;
    getOccupiedCells: (collider: ColliderT, cellMap: CellMapT) => Vector3D[];
    getOccupiedSolidCells: (collider: ColliderT, cellMap: CellMapT) => Vector3D[];
    intersectsCellMap: (collider: ColliderT, cellMap: CellMapT, options?: ProcessCollisionsOptions) => CellMapCollisionResult;
    processCollisions: (collider: ColliderT, cellMap: CellMapT, options?: ProcessCollisionsOptions) => CollisionPipelineResult;
    setShape: (collider: ColliderT, shape: 'box' | 'sphere') => void;
    setSize: (collider: ColliderT, x: number, y: number, z: number) => void;
    setRadius: (collider: ColliderT, radius: number) => void;
    setOffset: (collider: ColliderT, x: number, y: number, z: number) => void;
}
export declare const Collider: ColliderMethods;
//# sourceMappingURL=methods.d.ts.map