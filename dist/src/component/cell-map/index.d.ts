export { builder, PROPERTY_ALLOWLIST, generateDefaultCubeMesh, CellMapSerializer, resetCellMapState, cmMaterials, cmMaterialMap, cmShapeMap, cmMeshes, cmEmissionMap, cmVisibilityMap, cmCellSize, cmMapSize, cmChunkSize, cmSmoothing, cmSmoothingWeights, cmNormalSmoothing, cmNeedsGPUUpdate, cmChunks, cmChunkGridSize, cmRevealExempt, } from './data';
export type { CellMapT, CellMapOptions } from './data';
export { CellMap } from './methods';
export type { CellMapMethods } from './methods';
export type { Material, Mesh, CellData, ChunkMesh, DrawRange } from './types';
export type { RaycastHit, SurfaceHit, RaycastOptions } from './types';
export { raycastCellMap, cellSurfacePoint, sampleSurfaceHeight, getChunkTrianglesInBounds, } from './raycast';
export { createDefaultCellData, packCell, unpackCell, DEFAULT_CHUNK_SIZE, } from './types';
export { rebuildDirtyChunks, markChunksDirty } from './mesh-builder';
//# sourceMappingURL=index.d.ts.map