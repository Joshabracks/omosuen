import type { ResolvedSource } from '../../fog-of-war/sweep';
export interface ExploredWindow {
    mask: Uint8Array;
    originCell: {
        x: number;
        y: number;
        z: number;
    };
    cellDims: {
        x: number;
        y: number;
        z: number;
    };
}
export declare function markExploredCells(pos: {
    x: number;
    y: number;
    z: number;
}, sources: ResolvedSource[], outerWorld: number, cellSize: {
    x: number;
    y: number;
    z: number;
}, window: ExploredWindow, isExplored: (x: number, y: number, z: number) => boolean, mark: (x: number, y: number, z: number) => void, requireLineOfSight?: boolean): void;
//# sourceMappingURL=explored-cells.d.ts.map