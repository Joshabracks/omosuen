import { CellMapT } from '../../cell-map';
import { VisionSourceT } from '../../vision-source';
export declare function isRayBlockedTS(mask: Uint8Array, dims: {
    x: number;
    y: number;
    z: number;
}, originX: number, originY: number, originZ: number, destX: number, destY: number, destZ: number): boolean;
export declare function sweepExploredChunks(cellMap: CellMapT, visionSources: VisionSourceT[], mask: Uint8Array, nearBufferCells: number): void;
export declare function clearExploredSweepCache(sourceId: number): void;
//# sourceMappingURL=explored-sweep.d.ts.map