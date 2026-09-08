import type { CellMapT } from './data';
import type { Vector3D } from '../../math';
export type CellObservationPredicate = (worldX: number, worldY: number, worldZ: number) => boolean;
export declare function setCellObservationPredicate(predicate: CellObservationPredicate | null): void;
export declare function isDeferredPresentationActive(): boolean;
export declare function deferredCellCount(): number;
export declare function clearDeferredCells(component?: CellMapT): void;
export declare function deferCellWriteIfUnobserved(component: CellMapT, coordinates: Vector3D): boolean;
export declare function revealObservedCells(component: CellMapT): void;
//# sourceMappingURL=deferred-presentation.d.ts.map