import type { CellMapT } from './data';
import { invalidateCachedChunk } from './data';
import type { Mesh } from './types';
import type { Array3Di } from '../../math';
import {
  setMeshCellSize,
  setMeshEdgeOccludes,
  setMeshSmoothing,
  setMeshMaterialWeights,
  setCustomShape,
  clearCustomShapes,
  buildChunkMeshWasm,
  buildChunkMeshSmoothedWasm,
} from '../camera/render/wasm';

/**
 * Default per-frame time budget for (re)meshing dirty chunks, in
 * milliseconds. A window shift/resize can dirty hundreds of chunks at once;
 * spreading their WASM meshing calls across multiple frames (instead of
 * looping every dirty chunk synchronously in one call) is what keeps a pan/
 * zoom from stalling a single frame.
 */
export const DEFAULT_CHUNK_GEN_BUDGET_MS = 4;

/**
 * Last smoothing configuration actually sent to WASM. `smoothingWeights.expand()` unpacks
 * a bit-packed `Array3Di` into a dense array sized `mapSize.x*y*z` -- tens of millions of
 * cells at a large window -- and `setMeshSmoothing` then copies that whole array across the
 * WASM boundary. Both are skipped when nothing has actually changed since the last call
 * (the overwhelmingly common case: `rebuildDirtyChunks` runs every frame while any chunk is
 * dirty, but the smoothing configuration itself rarely changes frame-to-frame). Safe to
 * cache by reference: `Array3Di` has no in-place mutator (only `expand()`), and
 * `cellMap.smoothingWeights` is only ever reassigned to a brand-new instance, never mutated.
 */
let lastSmoothingWeights: Array3Di | undefined;
let lastSmoothing: number | undefined;
let lastNormalSmoothing: number | undefined;

/**
 * `buildChunkMeshWasm`/`buildChunkMeshSmoothedWasm` return vertex positions
 * in WINDOW-LOCAL space (the chunk's local `cx/cy/cz` offset is already
 * baked in, but not the window's own world-space origin). Baking the
 * window's *current* origin in too, once, right here, makes the stored
 * vertex data absolute world-space forever -- a chunk's true world position
 * never changes, only which local array slot currently holds it does, so a
 * chunk reused across a later shift never needs its vertices touched or
 * re-uploaded again (see `reassembleChunks` in `data.ts`, which relies on
 * this). Only the position fields need it -- pos3 at offset 0 and origPos3
 * at offset 6 in the stride-10/12 interleaved layout; normal3, emission,
 * and uv are orientation/material data, unaffected.
 */
function bakeWorldOffsetInPlace(
  vertices: Float32Array,
  stride: number,
  dx: number,
  dy: number,
  dz: number,
): void {
  for (let i = 0; i < vertices.length; i += stride) {
    vertices[i] += dx;
    vertices[i + 1] += dy;
    vertices[i + 2] += dz;
    vertices[i + 6] += dx;
    vertices[i + 7] += dy;
    vertices[i + 8] += dz;
  }
}

/**
 * Rebuilds dirty chunks in a cell map via the render WASM module
 * (`omosuen-render`), up to `budgetMs` of wall-clock time (always processing
 * at least one chunk, so a single expensive chunk can't stall progress
 * forever). Chunks are processed nearest-to-focus first -- the window is
 * centered on the focus point by construction (`CellWindow.setFocus`), so
 * sorting by distance from the window's own local-grid center means visible/
 * near chunks pop in before distant buffer-zone ones whenever the budget
 * can't cover every dirty chunk in one call. Chunks left dirty after the
 * budget runs out are picked up by the next call -- this function already
 * runs once per frame from the render loop, so no separate scheduler is
 * needed. Both greedy meshing (smoothing == 0) and smoothed / Laplacian
 * meshing (smoothing > 0) run in WASM — single source of truth, no JS
 * fallback. Call before rendering when any chunks are dirty.
 */
export function rebuildDirtyChunks(
  cellMap: CellMapT,
  budgetMs: number = DEFAULT_CHUNK_GEN_BUDGET_MS,
): void {
  const dirtyChunks = cellMap.chunks.filter((c) => c.dirty);
  if (dirtyChunks.length === 0) return;

  // The packed cells are resident in the canonical WASM store (mutated via
  // setCellData), so there is no upload/expand here — just set the cell size,
  // and the smoothing inputs when smoothing is enabled.
  setMeshCellSize(cellMap.cellSize.x, cellMap.cellSize.y, cellMap.cellSize.z);
  // CellMap always meshes out of CellWindow's shiftable hot window, never a
  // complete/bounded store -- "outside the resident window" means "not
  // loaded yet," not "nothing there," so an edge chunk's face-culling should
  // treat an out-of-window neighbor as occluding rather than exposing an
  // interior cross-section before the real neighbor streams in.
  setMeshEdgeOccludes(true);

  const smoothed = cellMap.smoothing > 0;
  if (smoothed) {
    const smoothingChanged =
      cellMap.smoothingWeights !== lastSmoothingWeights ||
      cellMap.smoothing !== lastSmoothing ||
      cellMap.normalSmoothing !== lastNormalSmoothing;
    if (smoothingChanged) {
      const weights = cellMap.smoothingWeights.expand();
      const total = cellMap.mapSize.x * cellMap.mapSize.y * cellMap.mapSize.z;
      setMeshSmoothing(
        weights.value,
        total,
        cellMap.smoothing,
        cellMap.normalSmoothing,
      );
      lastSmoothingWeights = cellMap.smoothingWeights;
      lastSmoothing = cellMap.smoothing;
      lastNormalSmoothing = cellMap.normalSmoothing;
    }

    // Per-material smoothing overrides: a material's `smoothness` (0-15) wins
    // over the per-cell/map weight; -1 means "no override". Cells of a harder
    // (lower-weight) type pin shared vertices so softer neighbors snap to them.
    const materialWeights = new Int32Array(cellMap.materials.length);
    for (let i = 0; i < cellMap.materials.length; i++) {
      const s = cellMap.materials[i].smoothness;
      materialWeights[i] =
        s === undefined ? -1 : Math.max(0, Math.min(15, Math.round(s)));
    }
    setMeshMaterialWeights(materialWeights);
  }

  // Upload custom cell meshes (shapeIndex >= 2) so the WASM mesher emits them
  // into the same vertex pool as cubes (smoothed/deduped together — no seams).
  // Indices 0 (air) and 1 (default cube) are built in; only 2+ are custom.
  // A non-empty mesh.uvs (one uv per vertex) enables UV texturing for that shape;
  // mesh.faceCover lets a side opt out of occluding its neighbor.
  clearCustomShapes();
  for (let i = 2; i < cellMap.meshes.length; i++) {
    const mesh = cellMap.meshes[i];
    if (mesh && mesh.indices.length > 0) {
      setCustomShape(
        i,
        mesh.vertices,
        mesh.indices,
        mesh.uvs,
        packFaceCover(mesh),
      );
    }
  }

  const { x: gx, y: gy, z: gz } = cellMap.chunkGridSize;
  const centerX = (gx - 1) / 2;
  const centerY = (gy - 1) / 2;
  const centerZ = (gz - 1) / 2;
  dirtyChunks.sort((a, b) => {
    const da =
      (a.cx - centerX) ** 2 + (a.cy - centerY) ** 2 + (a.cz - centerZ) ** 2;
    const db =
      (b.cx - centerX) ** 2 + (b.cy - centerY) ** 2 + (b.cz - centerZ) ** 2;
    return da - db;
  });

  const windowOrigin = cellMap.window.origin;
  const worldOffsetX =
    (windowOrigin?.cx ?? 0) * cellMap.chunkSize.x * cellMap.cellSize.x;
  const worldOffsetY =
    (windowOrigin?.cy ?? 0) * cellMap.chunkSize.y * cellMap.cellSize.y;
  const worldOffsetZ =
    (windowOrigin?.cz ?? 0) * cellMap.chunkSize.z * cellMap.cellSize.z;

  const deadline = performance.now() + budgetMs;
  for (let i = 0; i < dirtyChunks.length; i++) {
    if (i > 0 && performance.now() > deadline) break;
    const chunk = dirtyChunks[i];
    const result = smoothed
      ? buildChunkMeshSmoothedWasm(chunk.cx, chunk.cy, chunk.cz)
      : buildChunkMeshWasm(chunk.cx, chunk.cy, chunk.cz);
    chunk.vertices = result.vertices;
    chunk.stride = result.stride;
    chunk.indices = result.indices;
    chunk.drawRanges = result.ranges;
    chunk.faceCount = result.indices ? result.indices.length / 6 : 0;
    if (chunk.vertices) {
      bakeWorldOffsetInPlace(
        chunk.vertices,
        chunk.stride,
        worldOffsetX,
        worldOffsetY,
        worldOffsetZ,
      );
    }
    chunk.dirty = false;
    chunk.gpuDirty = true;
    // Whether any of this chunk's faces may have been culled against an
    // unknown (not-yet-loaded) neighbor via EDGE_OCCLUDES, rather than real
    // data -- true if it sits at the resident window's own edge on any
    // axis. See ChunkMesh.meshedAtEdge's doc comment (types.ts) and the
    // mesh cache's use of this in reassembleChunks (data.ts).
    chunk.meshedAtEdge =
      chunk.cx === 0 ||
      chunk.cx === cellMap.chunkGridSize.x - 1 ||
      chunk.cy === 0 ||
      chunk.cy === cellMap.chunkGridSize.y - 1 ||
      chunk.cz === 0 ||
      chunk.cz === cellMap.chunkGridSize.z - 1;
  }
}

/**
 * Packs a mesh's optional `faceCover` into the 6-bit mask the WASM mesher expects,
 * in FACE_DIRS order [+Z, -Z, +Y, -Y, +X, -X]. Each side defaults to covered (1).
 */
function packFaceCover(mesh: Mesh): number {
  const fc = mesh.faceCover;
  if (!fc) return 0x3f;
  const bit = (v: boolean | undefined, shift: number): number =>
    (v === false ? 0 : 1) << shift;
  return (
    bit(fc.posZ, 0) |
    bit(fc.negZ, 1) |
    bit(fc.posY, 2) |
    bit(fc.negY, 3) |
    bit(fc.posX, 4) |
    bit(fc.negX, 5)
  );
}

/**
 * Marks chunks as dirty that contain or border the given WORLD cell
 * coordinate. Call when a cell is modified so its chunk mesh gets rebuilt.
 * Also purges the mesh cache (`.design/chunk-buffering/05-mesh-cache.md`)
 * for the same coordinates, unconditionally -- a chunk's cell data can
 * change while it's outside the window (`CellWindow.setCell`'s cold-storage
 * path, bypassing the resident chunk array entirely), so a currently-cached
 * chunk needs the same invalidation a resident one gets, or it could later
 * be served as a stale mesh when it re-enters the window. The resident
 * dirty-marking below still no-ops if the coordinate (or its window-local
 * neighbors) are currently outside the window — that part of the edit
 * already went through the cold-storage path instead of the live store, so
 * there's no resident chunk mesh to dirty. See
 * `.design/cell-map-overhaul/09-chunk-grid-and-dirty-marking.md`.
 */
export function markChunksDirty(
  cellMap: CellMapT,
  x: number,
  y: number,
  z: number,
): void {
  const { chunkGridSize, chunkSize, window } = cellMap;

  const worldChunkX = Math.floor(x / chunkSize.x);
  const worldChunkY = Math.floor(y / chunkSize.y);
  const worldChunkZ = Math.floor(z / chunkSize.z);

  // Position within its chunk -- origin-independent, so compute this from
  // the world chunk coordinate before translating to window-local below.
  const localX = x - worldChunkX * chunkSize.x;
  const localY = y - worldChunkY * chunkSize.y;
  const localZ = z - worldChunkZ * chunkSize.z;

  // Mesh-cache invalidation: world-coordinate-based, no window-bounds guard
  // (unlike the resident dirty-marking below) -- the whole point is covering
  // off-window/cached chunks too. invalidateCachedChunk no-ops on a miss.
  invalidateCachedChunk(worldChunkX, worldChunkY, worldChunkZ);
  if (localX === 0)
    invalidateCachedChunk(worldChunkX - 1, worldChunkY, worldChunkZ);
  if (localX === chunkSize.x - 1)
    invalidateCachedChunk(worldChunkX + 1, worldChunkY, worldChunkZ);
  if (localY === 0)
    invalidateCachedChunk(worldChunkX, worldChunkY - 1, worldChunkZ);
  if (localY === chunkSize.y - 1)
    invalidateCachedChunk(worldChunkX, worldChunkY + 1, worldChunkZ);
  if (localZ === 0)
    invalidateCachedChunk(worldChunkX, worldChunkY, worldChunkZ - 1);
  if (localZ === chunkSize.z - 1)
    invalidateCachedChunk(worldChunkX, worldChunkY, worldChunkZ + 1);

  const origin = window.origin;
  if (!origin) return; // no window loaded yet -- nothing resident to dirty

  // Window-local chunk-grid position (cmChunks is indexed by this, not by
  // world chunk coordinate -- see doc 09).
  const chunkX = worldChunkX - origin.cx;
  const chunkY = worldChunkY - origin.cy;
  const chunkZ = worldChunkZ - origin.cz;

  if (
    chunkX < 0 ||
    chunkX >= chunkGridSize.x ||
    chunkY < 0 ||
    chunkY >= chunkGridSize.y ||
    chunkZ < 0 ||
    chunkZ >= chunkGridSize.z
  ) {
    return; // outside the current window
  }

  markSingleChunkDirty(cellMap, chunkX, chunkY, chunkZ);

  // Mark adjacent chunks if cell is on a chunk boundary
  // (face culling depends on cross-chunk neighbors)
  if (localX === 0 && chunkX > 0)
    markSingleChunkDirty(cellMap, chunkX - 1, chunkY, chunkZ);
  if (localX === chunkSize.x - 1 && chunkX < chunkGridSize.x - 1)
    markSingleChunkDirty(cellMap, chunkX + 1, chunkY, chunkZ);
  if (localY === 0 && chunkY > 0)
    markSingleChunkDirty(cellMap, chunkX, chunkY - 1, chunkZ);
  if (localY === chunkSize.y - 1 && chunkY < chunkGridSize.y - 1)
    markSingleChunkDirty(cellMap, chunkX, chunkY + 1, chunkZ);
  if (localZ === 0 && chunkZ > 0)
    markSingleChunkDirty(cellMap, chunkX, chunkY, chunkZ - 1);
  if (localZ === chunkSize.z - 1 && chunkZ < chunkGridSize.z - 1)
    markSingleChunkDirty(cellMap, chunkX, chunkY, chunkZ + 1);
}

function markSingleChunkDirty(
  cellMap: CellMapT,
  cx: number,
  cy: number,
  cz: number,
): void {
  const { chunkGridSize } = cellMap;
  const index =
    cz * chunkGridSize.y * chunkGridSize.x + cy * chunkGridSize.x + cx;
  if (index >= 0 && index < cellMap.chunks.length) {
    cellMap.chunks[index].dirty = true;
  }
}
