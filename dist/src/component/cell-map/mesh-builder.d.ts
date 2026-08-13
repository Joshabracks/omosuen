import type { CellMapT } from './data';
export declare const DEFAULT_CHUNK_GEN_BUDGET_MS = 4;
export declare function rebuildDirtyChunks(cellMap: CellMapT, budgetMs?: number): void;
export declare function markChunksDirty(cellMap: CellMapT, x: number, y: number, z: number): void;
export declare function markChunkAndNeighborsDirty(cellMap: CellMapT, worldChunk: {
    cx: number;
    cy: number;
    cz: number;
}): void;
//# sourceMappingURL=mesh-builder.d.ts.map