import { Vector3D } from '../../math';
export interface MaterialSideFrames {
    albedoFrame?: number;
    normalFrame?: number;
    emissionFrame?: number;
}
export interface Material {
    albedoTextureKey: string;
    normalTextureKey: string;
    emissionTextureKey: string;
    materialTextureKey: string;
    albedoFrame: number;
    normalFrame: number;
    emissionFrame: number;
    materialFrame: number;
    sides?: {
        up?: MaterialSideFrames;
        southEast?: MaterialSideFrames;
        southWest?: MaterialSideFrames;
    };
    smoothness?: number;
}
export interface Mesh {
    vertices: Float32Array;
    uvs: Float32Array;
    indices: Uint16Array;
    faceCover?: {
        posX?: boolean;
        negX?: boolean;
        posY?: boolean;
        negY?: boolean;
        posZ?: boolean;
        negZ?: boolean;
    };
}
export interface CellData {
    materialIndex: number;
    shapeIndex: number;
    emissionIntensity: number;
    visible: boolean;
}
export declare function createDefaultCellData(): CellData;
export declare function packCell(data: CellData): number;
export declare function unpackCell(packed: number): CellData;
export declare const CHUNK_SIZE = 16;
export interface DrawRange {
    materialIndex: number;
    useMeshUV: boolean;
    indexOffset: number;
    indexCount: number;
}
export interface ChunkMesh {
    cx: number;
    cy: number;
    cz: number;
    dirty: boolean;
    vertices: Float32Array | null;
    stride: number;
    indices: Uint32Array | null;
    drawRanges: DrawRange[];
    faceCount: number;
    glVertexBuffer: WebGLBuffer | null;
    glIndexBuffer: WebGLBuffer | null;
}
export interface RaycastHit {
    point: Vector3D;
    normal: Vector3D;
    cell: Vector3D;
    distance: number;
}
export interface SurfaceHit {
    point: Vector3D;
    normal: Vector3D;
}
export interface RaycastOptions {
    maxDistance?: number;
    smoothNormal?: boolean;
}
//# sourceMappingURL=types.d.ts.map