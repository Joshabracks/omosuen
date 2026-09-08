import { CellMapT } from '../../cell-map';
import { VisionSourceT } from '../../vision-source';
export { isRayBlockedTS } from './ray-blocked';
export declare function sweepExploredCells(cellMap: CellMapT, visionSources: VisionSourceT[], mask: Uint8Array, requireLineOfSight?: boolean): void;
export declare function clearExploredSweepCache(sourceId: number): void;
//# sourceMappingURL=explored-sweep.d.ts.map