import { CellMapT } from '../../cell-map';
import { VisionSourceT } from '../../vision-source';
import { VisibilityVolumeT } from '../../visibility-volume';
export { isRayBlockedTS } from './ray-blocked';
export declare function sweepExploredCells(cellMap: CellMapT, visionSources: VisionSourceT[], volumes: VisibilityVolumeT[], mask: Uint8Array, requireLineOfSight?: boolean): void;
export declare function clearExploredSweepCache(componentId: number): void;
//# sourceMappingURL=explored-sweep.d.ts.map