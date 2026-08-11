import { ComponentData, ComponentOptions, ComponentSerializer, ComponentUnique } from '../types';
import { Array3D, Array3Di, Vector3D } from '../../math';
import { Material, Mesh, ChunkMesh } from './types';
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
export declare let cmEmissionColorDirty: boolean;
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
    emissionColorDirty: boolean;
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
export declare function invalidateCachedChunk(wcx: number, wcy: number, wcz: number): void;
export declare function reassembleChunks(oldChunks: ChunkMesh[], oldOrigin: ChunkCoord | null, newOrigin: ChunkCoord, newGridDims: {
    x: number;
    y: number;
    z: number;
}): ChunkMesh[];
export declare function builder(options: CellMapOptions): Promise<CellMapT>;
export declare const CellMapSerializer: ComponentSerializer;
//# sourceMappingURL=data.d.ts.map