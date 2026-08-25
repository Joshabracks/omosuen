export type ColdStorageEntrySnapshot = {
    cx: number;
    cy: number;
    cz: number;
    kind: 'rle';
    values: number[];
    counts: number[];
} | {
    cx: number;
    cy: number;
    cz: number;
    kind: 'dense';
    cells: number[];
};
export interface ChunkColdStorageConfig {
    chunkCellCount: number;
    maxRunsPerSlot?: number;
    initialCapacitySlots?: number;
}
export declare class ChunkColdStorage {
    private readonly chunkCellCount;
    private readonly maxRuns;
    private readonly rlePool;
    private readonly densePool;
    private readonly index;
    constructor(config: ChunkColdStorageConfig);
    has(cx: number, cy: number, cz: number): boolean;
    get(cx: number, cy: number, cz: number): Uint32Array | null;
    set(cx: number, cy: number, cz: number, cells: Uint32Array): void;
    delete(cx: number, cy: number, cz: number): void;
    get size(): number;
    dumpEntries(): ColdStorageEntrySnapshot[];
    loadEntries(entries: ColdStorageEntrySnapshot[]): void;
    clear(): void;
}
//# sourceMappingURL=cold-storage.d.ts.map