export {
  builder,
  PROPERTY_ALLOWLIST,
  generateDefaultCubeMesh,
  CellMapSerializer,
  resetCellMapState,
  // Module-level singleton data (prefixed to avoid naming conflicts)
  cmMaterials,
  cmMaterialMap,
  cmShapeMap,
  cmMeshes,
  cmEmissionMap,
  cmVisibilityMap,
  cmCellSize,
  cmMapSize,
  cmSmoothing,
  cmSmoothingWeights,
  cmNormalSmoothing,
  cmNeedsGPUUpdate,
  cmChunks,
  cmChunkGridSize,
  cmRevealExempt,
} from './data';
export type { CellMapT, CellMapOptions } from './data';
export { CellMap } from './methods';
export type { CellMapMethods } from './methods';
export type { Material, Mesh, CellData, ChunkMesh, DrawRange } from './types';
export {
  createDefaultCellData,
  packCell,
  unpackCell,
  CHUNK_SIZE,
} from './types';
export { rebuildDirtyChunks, markChunksDirty } from './mesh-builder';
