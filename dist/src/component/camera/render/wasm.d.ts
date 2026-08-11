export interface MeshDrawRange {
    materialIndex: number;
    useMeshUV: boolean;
    indexOffset: number;
    indexCount: number;
}
export interface ChunkMeshResult {
    vertices: Float32Array | null;
    indices: Uint32Array | null;
    ranges: MeshDrawRange[];
    stride: number;
}
export declare function initRenderWasm(wasmBytes?: Uint8Array): Promise<void>;
export declare function isRenderWasmReady(): boolean;
export declare function loadCellStore(packedFlat: ArrayLike<number>, total: number, mapX: number, mapY: number, mapZ: number): void;
export declare function cellStoreGet(x: number, y: number, z: number): number;
export declare function cellStoreSet(x: number, y: number, z: number, packed: number): void;
export declare function cellStoreFlush(): void;
export declare function cellStoreDump(): Uint32Array;
export declare function getExpandedStoreView(): Uint32Array;
export declare function getReassembleViews(destTotal: number): {
    source: Uint32Array;
    dest: Uint32Array;
};
export declare function commitCellStore(mx: number, my: number, mz: number): void;
export declare function solidity(): Uint8Array;
export declare function setMeshCellSize(cx: number, cy: number, cz: number): void;
export declare function setChunkSize(x: number, y: number, z: number): void;
export declare function setMeshEdgeOccludes(occludes: boolean): void;
export declare function setMeshSmoothing(weightsFlat: ArrayLike<number>, cellCount: number, smoothing: number, normalSmoothing: number): void;
export declare function setMeshMaterialWeights(weights: ArrayLike<number>): void;
export declare function clearCustomShapes(): void;
export declare function setCustomShape(shapeIndex: number, vertices: ArrayLike<number>, indices: ArrayLike<number>, uvs?: ArrayLike<number>, coverMask?: number): void;
export declare function buildChunkMeshWasm(cx: number, cy: number, cz: number): ChunkMeshResult;
export declare function buildChunkMeshSmoothedWasm(cx: number, cy: number, cz: number): ChunkMeshResult;
//# sourceMappingURL=wasm.d.ts.map