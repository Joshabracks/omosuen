export { builder, PROPERTY_ALLOWLIST, generateDefaultCubeMesh } from './data';
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
