import { CameraT } from '../data';
import { PickBuffer } from './buffer';
export { PickBuffer, PickKind, createPickBuffer } from './buffer';
export type { PickHit, PickKindValue } from './buffer';
export { screenToWorldRay } from './ray';
export interface PickTargets {
    sprites?: boolean;
    colliders?: boolean;
    eventColliders?: boolean;
    cells?: boolean;
}
export interface PickOptions {
    mode?: 'first' | 'all';
    types?: PickTargets;
    lineThickness?: number;
}
export declare function screenPick(camera: CameraT, pointsXY: number[], pointCount: number, out: PickBuffer, options?: PickOptions): number;
//# sourceMappingURL=index.d.ts.map