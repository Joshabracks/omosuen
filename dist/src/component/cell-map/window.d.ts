import type { ChunkColdStorage } from './cold-storage';
export declare const DEFAULT_CHUNK_DATA_GEN_BUDGET_MS = 4;
export interface ChunkCoord {
    cx: number;
    cy: number;
    cz: number;
}
export interface ChunkGenerator {
    generateCell?: (worldX: number, worldY: number, worldZ: number) => number | undefined;
    generateChunk?: (cx: number, cy: number, cz: number) => Uint32Array;
}
export interface WindowConfig {
    chunkSize: {
        x: number;
        y: number;
        z: number;
    };
    radius?: {
        x: number;
        y: number;
        z: number;
    };
    emptyCell: number;
    generator?: ChunkGenerator;
    warnOnOutOfWindowWrite?: boolean;
    onReassemble?: (old: {
        origin: ChunkCoord | null;
        gridDims: {
            x: number;
            y: number;
            z: number;
        };
        cellDims: {
            x: number;
            y: number;
            z: number;
        };
    }, next: {
        origin: ChunkCoord;
        gridDims: {
            x: number;
            y: number;
            z: number;
        };
        cellDims: {
            x: number;
            y: number;
            z: number;
        };
    }) => void;
}
export declare class CellWindow {
    private readonly chunkSize;
    private windowRadius;
    private readonly emptyCell;
    private readonly generator;
    private readonly coldStorage;
    private readonly warnOnOutOfWindowWrite;
    private readonly onReassemble;
    private readonly editedSinceBaseline;
    private pendingShift;
    private reassembleMsAccum;
    private gridDims;
    private cellDims;
    private originChunk;
    constructor(config: WindowConfig, coldStorage: ChunkColdStorage);
    get origin(): ChunkCoord | null;
    get cellDimensions(): {
        x: number;
        y: number;
        z: number;
    };
    get gridDimensions(): {
        x: number;
        y: number;
        z: number;
    };
    get radius(): {
        x: number;
        y: number;
        z: number;
    };
    worldToLocal(wx: number, wy: number, wz: number): {
        x: number;
        y: number;
        z: number;
    } | null;
    queryCell(worldX: number, worldY: number, worldZ: number): number;
    setCell(worldX: number, worldY: number, worldZ: number, value: number): void;
    setFocus(cellX: number, cellY: number, cellZ: number): boolean;
    resize(newRadius: {
        x: number;
        y: number;
        z: number;
    }): boolean;
    private effectiveTarget;
    private requestTarget;
    private beginOrRetarget;
    private neededForTarget;
    private extractLiveChunk;
    private resolveChunk;
    advance(budgetMs?: number): boolean;
    refreshChunkRange(minChunk: ChunkCoord | null, maxChunk: ChunkCoord | null): {
        refreshed: ChunkCoord[];
        skippedEdited: ChunkCoord[];
        clearedEvicted: ChunkCoord[];
    };
    private refreshOneChunk;
    private reassemble;
    drainReassembleMs(): number;
    private reassembleImpl;
    private chunkKey;
    private isWithin;
    private matchesBaseline;
    private baselineChunk;
    private extractChunk;
    private writeChunk;
}
//# sourceMappingURL=window.d.ts.map