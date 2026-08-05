import { ComponentData, ComponentOptions, ComponentSerializer, ComponentUnique } from '../types';
import { Array3D, Array3Di, Vector3D } from '../../math';
import { Material, Mesh, ChunkMesh } from './types';
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
export declare function resetCellMapState(): void;
export interface CellMapOptions extends ComponentOptions {
    materials: Material[];
    materialMap: Array3D<number>;
    shapeMap?: Array3D<number>;
    meshes?: Mesh[];
    emissionMap?: Array3D<number>;
    emissionColorMap?: Array3D<number>;
    visibilityMap?: Array3D<boolean>;
    cellSize: Vector3D;
    mapSize: Vector3D;
    smoothing?: number;
    smoothingWeights?: number | Array3D<number>;
    normalSmoothing?: number;
    revealExempt?: boolean;
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
    packedData: CellPackedReadView;
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
}
export declare function generateDefaultCubeMesh(): Mesh;
export declare const PROPERTY_ALLOWLIST: string[];
export declare function builder(options: CellMapOptions): Promise<CellMapT>;
export declare const CellMapSerializer: ComponentSerializer;
//# sourceMappingURL=data.d.ts.map