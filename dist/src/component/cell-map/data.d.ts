import { ComponentData, ComponentOptions, ComponentSerializer, ComponentUnique } from '../types';
import { Array3D, Array3Di, Vector3D } from '../../math';
import { Material, Mesh, ChunkMesh, CellEmissionColorDirtyRegion, ChunkExploredDirtyRegion, MemoryMaterialDirtyRegion } from './types';
import { CellWindow } from './window';
import type { ChunkCoord } from './window';
import { ChunkColdStorage } from './cold-storage';
import type { CellData } from './types';
import { AuxiliaryChannel } from './auxiliary-channel';
export interface CellPackedReadView {
    forEach(cb: (value: number, x: number, y: number, z: number, index: number) => void): void;
    get(coord: Vector3D): number;
}
export declare let cmMaterials: Material[];
export declare let cmMaterialMap: Array3D<number>;
export declare let cmShapeMap: Array3D<number>;
export declare let cmMeshes: Mesh[];
export declare let cmEmissionMap: Array3D<number>;
export declare let cmEmissionColorMap: Array3D<number>;
export declare let cmEmissionColorVersion: number;
export declare let cmEmissionColorFullVersion: number;
export declare let cmEmissionColorDirtyRegions: CellEmissionColorDirtyRegion[];
export declare let cmExploredMap: Array3D<number>;
export declare let cmExploredVersion: number;
export declare let cmExploredFullVersion: number;
export declare let cmExploredDirtyRegions: ChunkExploredDirtyRegion[];
export declare let cmFarMaterialMap: Array3D<number>;
export declare let cmFarMaterialVersion: number;
export declare let cmFarMaterialFullVersion: number;
export declare let cmFarMaterialDirtyRegions: ChunkExploredDirtyRegion[];
export declare let cmMemoryMaterialMap: Array3D<number>;
export declare let cmMemoryMaterialVersion: number;
export declare let cmMemoryMaterialFullVersion: number;
export declare let cmMemoryMaterialDirtyRegions: MemoryMaterialDirtyRegion[];
export declare let cmCustomShapesPendingIndices: number[];
export declare let cmCustomShapesFullResync: boolean;
export declare let cmVisibilityMap: Array3D<boolean>;
export declare let cmCellSize: Vector3D;
export declare let cmMapSize: Vector3D;
export declare let cmChunkSize: Vector3D;
export declare let cmSmoothing: number;
export declare let cmSmoothingWeights: Array3Di;
export declare let cmNormalSmoothing: number;
export declare let cmNeedsGPUUpdate: boolean;
export declare let cmChunks: ChunkMesh[];
export declare let cmChunkGridSize: {
    x: number;
    y: number;
    z: number;
};
export declare let cmRevealExempt: boolean;
export declare let cmAutoFocusFromCamera: boolean;
export declare let cmAutoResizeFromZoom: boolean;
export declare let cmMaxTerrainLoadDimensions: {
    x: number;
    y: number;
    z: number;
};
export declare let cmRenderDistance: {
    x: number;
    y: number;
    z: number;
};
export declare let cmFrustumPadding: {
    x: number;
    y: number;
    z: number;
};
export declare let cmWindow: CellWindow | undefined;
export declare let cmColdStorage: ChunkColdStorage | undefined;
export declare let cmGeneratorKey: {
    generateCell?: string;
    generateChunk?: string;
} | undefined;
export declare let cmEmissionColorChannel: AuxiliaryChannel | undefined;
export declare let cmSmoothingWeightsChannel: AuxiliaryChannel | undefined;
export declare let cmExploredChannel: AuxiliaryChannel | undefined;
export declare let cmFarMaterialChannel: AuxiliaryChannel | undefined;
export declare let cmMemoryMaterialChannel: AuxiliaryChannel | undefined;
export declare function resetCellMapState(): void;
export interface CellMapOptions extends ComponentOptions {
    materials: Material[];
    materialMap?: Array3D<number>;
    shapeMap?: Array3D<number>;
    meshes?: Mesh[];
    emissionMap?: Array3D<number>;
    emissionColorMap?: Array3D<number>;
    visibilityMap?: Array3D<boolean>;
    cellSize: Vector3D;
    mapSize?: Vector3D;
    chunkSize?: Vector3D;
    windowRadius?: {
        x: number;
        y: number;
        z: number;
    };
    generateCell?: ((worldX: number, worldY: number, worldZ: number) => CellData | undefined) | string;
    generateChunk?: ((cx: number, cy: number, cz: number) => CellData[]) | string;
    smoothing?: number;
    smoothingWeights?: number | Array3D<number>;
    normalSmoothing?: number;
    revealExempt?: boolean;
    autoFocusFromCamera?: boolean;
    autoResizeFromZoom?: boolean;
    maxTerrainLoadDimensions?: {
        x: number;
        y: number;
        z: number;
    };
    renderDistance?: {
        x: number;
        y: number;
        z: number;
    };
    frustumPadding?: {
        x: number;
        y: number;
        z: number;
    };
}
export interface CellMapT extends ComponentData {
    type: 'cell-map';
    unique: ComponentUnique.FALSE;
    materials: Material[];
    materialMap: Array3D<number>;
    shapeMap: Array3D<number>;
    meshes: Mesh[];
    emissionMap: Array3D<number>;
    emissionColorMap: Array3D<number>;
    emissionColorVersion: number;
    emissionColorFullVersion: number;
    emissionColorDirtyRegions: CellEmissionColorDirtyRegion[];
    exploredMap: Array3D<number>;
    exploredVersion: number;
    exploredFullVersion: number;
    exploredDirtyRegions: ChunkExploredDirtyRegion[];
    farMaterialMap: Array3D<number>;
    farMaterialVersion: number;
    farMaterialFullVersion: number;
    farMaterialDirtyRegions: ChunkExploredDirtyRegion[];
    memoryMaterialMap: Array3D<number>;
    memoryMaterialVersion: number;
    memoryMaterialFullVersion: number;
    memoryMaterialDirtyRegions: MemoryMaterialDirtyRegion[];
    customShapesPendingIndices: number[];
    customShapesFullResync: boolean;
    visibilityMap: Array3D<boolean>;
    cellSize: Vector3D;
    mapSize: Vector3D;
    chunkSize: Vector3D;
    packedData: CellPackedReadView;
    window: CellWindow;
    smoothing: number;
    smoothingWeights: Array3Di;
    normalSmoothing: number;
    needsGPUUpdate: boolean;
    chunks: ChunkMesh[];
    chunkGridSize: {
        x: number;
        y: number;
        z: number;
    };
    revealExempt: boolean;
    autoFocusFromCamera: boolean;
    autoResizeFromZoom: boolean;
    maxTerrainLoadDimensions: {
        x: number;
        y: number;
        z: number;
    };
    renderDistance: {
        x: number;
        y: number;
        z: number;
    };
    frustumPadding: {
        x: number;
        y: number;
        z: number;
    };
}
export declare function generateDefaultCubeMesh(): Mesh;
export declare const PROPERTY_ALLOWLIST: string[];
export declare function initChunks(cgs: {
    x: number;
    y: number;
    z: number;
}): ChunkMesh[];
export declare function queueBufferCleanup(chunks: ChunkMesh[]): void;
export declare function takePendingBufferCleanup(): ChunkMesh[];
export declare const DEFAULT_SET_CELLS_BUDGET_MS = 4;
interface PendingSetCellsEntry {
    x: number;
    y: number;
    z: number;
    data: CellData;
}
interface PendingSetCellsWaiter {
    targetCursor: number;
    resolve: () => void;
    reject: (err: Error) => void;
}
interface PendingSetCells {
    entries: PendingSetCellsEntry[];
    cursor: number;
    budgetMs: number;
    waiters: PendingSetCellsWaiter[];
}
export declare function enqueuePendingSetCells(entries: PendingSetCellsEntry[], budgetMs: number | undefined): Promise<void>;
export declare function getPendingSetCells(): PendingSetCells | null;
export declare function clearPendingSetCells(): void;
export declare function invalidateCachedChunk(wcx: number, wcy: number, wcz: number): void;
export declare function reassembleChunks(oldChunks: ChunkMesh[], oldOrigin: ChunkCoord | null, newOrigin: ChunkCoord, newGridDims: {
    x: number;
    y: number;
    z: number;
}): ChunkMesh[];
export declare function builder(options: CellMapOptions): Promise<CellMapT>;
export declare const CellMapSerializer: ComponentSerializer;
export {};
//# sourceMappingURL=data.d.ts.map