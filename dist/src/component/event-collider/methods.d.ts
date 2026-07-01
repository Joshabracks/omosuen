import { ComponentData, ComponentMethods } from '../types';
import { EventColliderT } from './data';
import { ColliderT } from '../collider/data';
import type { CellMapT } from '../cell-map';
import type { CellMapCollisionResult, CollisionPipelineResult, ProcessCollisionsOptions } from '../collider/methods';
import { Vector3D } from '../../math';
export interface EventColliderMethods extends ComponentMethods {
    init: (component: ComponentData) => Promise<void>;
    update: (component: ComponentData, deltaTime: number) => void;
    dispose: (component: ComponentData) => void;
    getWorldCenter: (ec: EventColliderT) => Vector3D;
    getWorldBounds: (ec: EventColliderT) => {
        min: Vector3D;
        max: Vector3D;
    };
    intersectsCollider: (ec: EventColliderT, other: ColliderT) => boolean;
    getOccupiedCells: (ec: EventColliderT, cellMap: CellMapT) => Vector3D[];
    getOccupiedSolidCells: (ec: EventColliderT, cellMap: CellMapT) => Vector3D[];
    intersectsCellMap: (ec: EventColliderT, cellMap: CellMapT, options?: ProcessCollisionsOptions) => CellMapCollisionResult;
    processCollisions: (ec: EventColliderT, cellMap: CellMapT, options?: ProcessCollisionsOptions) => CollisionPipelineResult;
    setShape: (ec: EventColliderT, shape: 'box' | 'sphere') => void;
    setSize: (ec: EventColliderT, x: number, y: number, z: number) => void;
    setRadius: (ec: EventColliderT, radius: number) => void;
    setOffset: (ec: EventColliderT, x: number, y: number, z: number) => void;
    addTrigger: (ec: EventColliderT, collider: ColliderT) => void;
    removeTrigger: (ec: EventColliderT, colliderId: number) => void;
    clearTriggers: (ec: EventColliderT) => void;
    setOnEnter: (ec: EventColliderT, callback: ((collider: ColliderT) => void) | null) => void;
    setOnExit: (ec: EventColliderT, callback: ((collider: ColliderT) => void) | null) => void;
    setWhile: (ec: EventColliderT, callback: ((collider: ColliderT, deltaTime: number) => void) | null) => void;
}
export declare const EventCollider: EventColliderMethods;
//# sourceMappingURL=methods.d.ts.map