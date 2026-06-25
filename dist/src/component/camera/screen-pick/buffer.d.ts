import { Vector3D } from '../../../math';
import { ComponentData } from '../../types';
import { CellMapT } from '../../cell-map/data';
export declare const PickKind: {
    readonly Sprite: "sprite";
    readonly Collider: "collider";
    readonly EventCollider: "event-collider";
    readonly Cell: "cell";
};
export type PickKindValue = (typeof PickKind)[keyof typeof PickKind];
export interface PickHit {
    kind: PickKindValue;
    component: ComponentData | null;
    cellMap: CellMapT | null;
    cellX: number;
    cellY: number;
    cellZ: number;
    worldPoint: Vector3D;
    depth: number;
}
export declare class PickBuffer {
    readonly hits: PickHit[];
    count: number;
    reset(): void;
    push(): PickHit;
}
export declare function createPickBuffer(): PickBuffer;
//# sourceMappingURL=buffer.d.ts.map