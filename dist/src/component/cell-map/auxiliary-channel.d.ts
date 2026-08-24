import { ChunkColdStorage } from './cold-storage';
import type { ColdStorageEntrySnapshot } from './cold-storage';
import type { ChunkCoord } from './window';
export interface AuxiliaryChannelConfig {
    chunkSize: {
        x: number;
        y: number;
        z: number;
    };
    baselineValue: number;
    trackDivergence: boolean;
    initialCellDims: {
        x: number;
        y: number;
        z: number;
    };
}
export declare class AuxiliaryChannel {
    readonly coldStorage: ChunkColdStorage;
    private readonly chunkSize;
    private readonly baselineValue;
    private readonly touchedSinceBaseline;
    private resident;
    private currentOrigin;
    private currentGridDims;
    private currentCellDims;
    constructor(config: AuxiliaryChannelConfig);
    get value(): Uint32Array;
    get canDiverge(): boolean;
    get isEntirelyBaseline(): boolean;
    get cellDims(): {
        x: number;
        y: number;
        z: number;
    };
    get gridDims(): {
        x: number;
        y: number;
        z: number;
    };
    get origin(): ChunkCoord | null;
    get(worldX: number, worldY: number, worldZ: number, local: {
        x: number;
        y: number;
        z: number;
    } | null): number;
    set(worldX: number, worldY: number, worldZ: number, local: {
        x: number;
        y: number;
        z: number;
    } | null, value: number): void;
    onWindowChange(old: {
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
    }): void;
    seedFromDense(dense: ArrayLike<number>, dims: {
        x: number;
        y: number;
        z: number;
    }, originChunk?: ChunkCoord): void;
    dumpEntries(): ColdStorageEntrySnapshot[];
    loadEntries(entries: ColdStorageEntrySnapshot[]): void;
}
//# sourceMappingURL=auxiliary-channel.d.ts.map