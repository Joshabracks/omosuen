import { ComponentData, ComponentMethods, castTo } from '../types';
import { ColliderT } from './data';
import { CellMapT } from '../cell-map';
import { NexusT } from '../nexus';
import { TransformT } from '../transform';
import { Vector3D } from '../../math';
import { unpackCell, Mesh, CHUNK_SIZE } from '../cell-map/types';
import { cellStoreGet } from '../camera/render/wasm';

// ============================================================
// Result types
// ============================================================

export interface CellMapCollisionResult {
  hit: boolean;
  cells: Vector3D[];
  center: Vector3D | null;
}

export interface CollisionPipelineResult {
  occupiedCells: Map<ColliderT, Vector3D[]>;
  colliderPairs: Array<{ a: ColliderT; b: ColliderT }>;
  solidCellOverlaps: Map<ColliderT, Vector3D[]>;
  cellMapCollisions: Map<ColliderT, CellMapCollisionResult>;
}

export interface ProcessCollisionsOptions {
  skipMeshCheck?: boolean;
}

// ============================================================
// Internal OBB representation
// ============================================================

interface OBB {
  center: Vector3D;
  halfExtents: Vector3D;
  axes: [Vector3D, Vector3D, Vector3D];
  worldAABB: { min: Vector3D; max: Vector3D };
}

// ============================================================
// Methods interface
// ============================================================

export interface ColliderMethods extends ComponentMethods {
  init: (component: ComponentData) => Promise<void>;
  getWorldCenter: (collider: ColliderT) => Vector3D;
  getWorldBounds: (collider: ColliderT) => { min: Vector3D; max: Vector3D };
  intersectsCollider: (collider: ColliderT, other: ColliderT) => boolean;
  getOccupiedCells: (collider: ColliderT, cellMap: CellMapT) => Vector3D[];
  getOccupiedSolidCells: (collider: ColliderT, cellMap: CellMapT) => Vector3D[];
  intersectsCellMap: (
    collider: ColliderT,
    cellMap: CellMapT,
    options?: ProcessCollisionsOptions,
  ) => CellMapCollisionResult;
  processCollisions: (
    collider: ColliderT,
    cellMap: CellMapT,
    options?: ProcessCollisionsOptions,
  ) => CollisionPipelineResult;
  setShape: (collider: ColliderT, shape: 'box' | 'sphere') => void;
  setSize: (collider: ColliderT, x: number, y: number, z: number) => void;
  setRadius: (collider: ColliderT, radius: number) => void;
  setOffset: (collider: ColliderT, x: number, y: number, z: number) => void;
}

// ============================================================
// Vector math helpers
// ============================================================

function dot3(a: Vector3D, b: Vector3D): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross3(a: Vector3D, b: Vector3D): Vector3D {
  return new Vector3D(
    a.y * b.z - a.z * b.y,
    a.z * b.x - a.x * b.z,
    a.x * b.y - a.y * b.x,
  );
}

function distSq(a: Vector3D, b: Vector3D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  return dx * dx + dy * dy + dz * dz;
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

// Reused scratch for world-transform reads via Transform.getWorldInto — avoids
// the per-call Vector3D allocations the old getPosition/getScale/getRotation
// trio produced. Each is fully consumed within the calling function before the
// next getWorldInto call, so sharing is safe (synchronous, non-reentrant).
const worldPos = new Vector3D(0, 0, 0);
const worldRot = new Vector3D(0, 0, 0);
const worldScale = new Vector3D(0, 0, 0);

// Reusable scratch OBBs / sphere centers for the per-frame collider-vs-collider
// path. computeOBBInto / computeSphereWorldInto write in place, so
// intersectsCollider allocates nothing per test (vs. the old ~8 Vector3Ds per OBB).
function makeScratchObb(): OBB {
  return {
    center: new Vector3D(0, 0, 0),
    halfExtents: new Vector3D(0, 0, 0),
    axes: [new Vector3D(0, 0, 0), new Vector3D(0, 0, 0), new Vector3D(0, 0, 0)],
    worldAABB: { min: new Vector3D(0, 0, 0), max: new Vector3D(0, 0, 0) },
  };
}
const scratchObbA = makeScratchObb();
const scratchObbB = makeScratchObb();
const scratchSphereCenterA = new Vector3D(0, 0, 0);
const scratchSphereCenterB = new Vector3D(0, 0, 0);

// ============================================================
// Component access helpers
// ============================================================

function getSiblingTransform(collider: ColliderT): TransformT | null {
  if (!collider.parent || collider.parent.type !== 'nexus') return null;
  const parentNexus = castTo<NexusT>(collider.parent);
  return parentNexus.getComponentByType(
    'transform',
    false,
  ) as TransformT | null;
}

function getSceneRoot(collider: ColliderT): NexusT | null {
  if (!collider.parent || collider.parent.type !== 'nexus') return null;
  let current = castTo<NexusT>(collider.parent);
  while (current.parent && current.parent.type === 'nexus') {
    current = castTo<NexusT>(current.parent);
  }
  return current;
}

// ============================================================
// Geometry computation
// ============================================================

/**
 * Writes the collider's world-space OBB into `out` (no allocation). Same math as
 * the old allocating computeOBB.
 */
function computeOBBInto(collider: ColliderT, out: OBB): void {
  const transform = getSiblingTransform(collider);

  let sx: number;
  let sy: number;
  let sz: number;
  let yaw = 0;

  if (transform) {
    transform.getWorldInto(worldPos, worldRot, worldScale);
    sx = worldScale.x;
    sy = worldScale.y;
    sz = worldScale.z;
    yaw = worldRot.y;
    out.center.x = worldPos.x + collider.offset.x;
    out.center.y = worldPos.y + collider.offset.y;
    out.center.z = worldPos.z + collider.offset.z;
  } else {
    out.center.x = collider.offset.x;
    out.center.y = collider.offset.y;
    out.center.z = collider.offset.z;
    sx = 1;
    sy = 1;
    sz = 1;
  }

  const halfX = collider.size.x * sx;
  const halfY = collider.size.y * sy;
  const halfZ = collider.size.z * sz;

  const cosT = Math.cos(yaw);
  const sinT = Math.sin(yaw);

  out.axes[0].x = cosT;
  out.axes[0].y = 0;
  out.axes[0].z = sinT;
  out.axes[1].x = 0;
  out.axes[1].y = 1;
  out.axes[1].z = 0;
  out.axes[2].x = -sinT;
  out.axes[2].y = 0;
  out.axes[2].z = cosT;

  out.halfExtents.x = halfX;
  out.halfExtents.y = halfY;
  out.halfExtents.z = halfZ;

  // World AABB enclosing the rotated OBB
  const worldHalfX = Math.abs(cosT) * halfX + Math.abs(sinT) * halfZ;
  const worldHalfY = halfY;
  const worldHalfZ = Math.abs(sinT) * halfX + Math.abs(cosT) * halfZ;

  out.worldAABB.min.x = out.center.x - worldHalfX;
  out.worldAABB.min.y = out.center.y - worldHalfY;
  out.worldAABB.min.z = out.center.z - worldHalfZ;
  out.worldAABB.max.x = out.center.x + worldHalfX;
  out.worldAABB.max.y = out.center.y + worldHalfY;
  out.worldAABB.max.z = out.center.z + worldHalfZ;
}

/** Allocating OBB (for non-per-frame callers: getWorldBounds/Center, occupancy). */
function computeOBB(collider: ColliderT): OBB {
  const out = makeScratchObb();
  computeOBBInto(collider, out);
  return out;
}

/**
 * Writes the collider's world-space sphere center into `outCenter` and returns
 * its effective radius (no allocation).
 */
function computeSphereWorldInto(
  collider: ColliderT,
  outCenter: Vector3D,
): number {
  const transform = getSiblingTransform(collider);
  if (transform) {
    transform.getWorldInto(worldPos, null, worldScale);
    outCenter.x = worldPos.x + collider.offset.x;
    outCenter.y = worldPos.y + collider.offset.y;
    outCenter.z = worldPos.z + collider.offset.z;
    return collider.radius * Math.max(worldScale.x, worldScale.y, worldScale.z);
  }
  outCenter.x = collider.offset.x;
  outCenter.y = collider.offset.y;
  outCenter.z = collider.offset.z;
  return collider.radius;
}

/** Allocating sphere (for non-per-frame callers). */
function computeSphereWorld(collider: ColliderT): {
  center: Vector3D;
  radius: number;
} {
  const center = new Vector3D(0, 0, 0);
  const radius = computeSphereWorldInto(collider, center);
  return { center, radius };
}

// ============================================================
// Closest point helpers
// ============================================================

function closestPointOnSegment(
  p: Vector3D,
  a: Vector3D,
  b: Vector3D,
): Vector3D {
  const ab = b.subtract(a);
  const ap = p.subtract(a);
  const abLenSq = dot3(ab, ab);
  if (abLenSq < 1e-10) return new Vector3D(a.x, a.y, a.z);
  const t = clamp(dot3(ap, ab) / abLenSq, 0, 1);
  return new Vector3D(a.x + t * ab.x, a.y + t * ab.y, a.z + t * ab.z);
}

function closestPointOnTriangle(
  p: Vector3D,
  v0: Vector3D,
  v1: Vector3D,
  v2: Vector3D,
): Vector3D {
  const edge0 = v1.subtract(v0);
  const edge1 = v2.subtract(v0);
  const v0p = p.subtract(v0);

  const d00 = dot3(edge0, edge0);
  const d01 = dot3(edge0, edge1);
  const d11 = dot3(edge1, edge1);
  const d20 = dot3(v0p, edge0);
  const d21 = dot3(v0p, edge1);

  const denom = d00 * d11 - d01 * d01;

  if (Math.abs(denom) < 1e-10) {
    // Degenerate triangle
    return new Vector3D(v0.x, v0.y, v0.z);
  }

  const s = (d11 * d20 - d01 * d21) / denom;
  const t = (d00 * d21 - d01 * d20) / denom;

  if (s >= 0 && t >= 0 && s + t <= 1) {
    return new Vector3D(
      v0.x + s * edge0.x + t * edge1.x,
      v0.y + s * edge0.y + t * edge1.y,
      v0.z + s * edge0.z + t * edge1.z,
    );
  }

  // Outside triangle — find closest point on edges
  const c01 = closestPointOnSegment(p, v0, v1);
  let bestDist = distSq(p, c01);
  let best = c01;

  const c12 = closestPointOnSegment(p, v1, v2);
  const d12 = distSq(p, c12);
  if (d12 < bestDist) {
    bestDist = d12;
    best = c12;
  }

  const c02 = closestPointOnSegment(p, v0, v2);
  const d02 = distSq(p, c02);
  if (d02 < bestDist) {
    best = c02;
  }

  return best;
}

// ============================================================
// Collision tests — collider vs collider
// ============================================================

/**
 * OBB vs OBB using SAT. For Y-axis-only rotation:
 * 5 axes = 2 from A's XZ + 2 from B's XZ + 1 shared Y axis.
 * All edge cross products collapse to Y or existing face axes.
 */
function obbAxisSeparates(
  dx: number,
  dy: number,
  dz: number,
  a: OBB,
  b: OBB,
  ax: Vector3D,
): boolean {
  const d = Math.abs(dx * ax.x + dy * ax.y + dz * ax.z);
  const rA =
    Math.abs(dot3(a.axes[0], ax)) * a.halfExtents.x +
    Math.abs(dot3(a.axes[1], ax)) * a.halfExtents.y +
    Math.abs(dot3(a.axes[2], ax)) * a.halfExtents.z;
  const rB =
    Math.abs(dot3(b.axes[0], ax)) * b.halfExtents.x +
    Math.abs(dot3(b.axes[1], ax)) * b.halfExtents.y +
    Math.abs(dot3(b.axes[2], ax)) * b.halfExtents.z;
  return d > rA + rB;
}

function obbVsObb(a: OBB, b: OBB): boolean {
  const dx = b.center.x - a.center.x;
  const dy = b.center.y - a.center.y;
  const dz = b.center.z - a.center.z;

  // Test 5 separating axes: A local X, A local Z, B local X, B local Z, shared Y.
  if (obbAxisSeparates(dx, dy, dz, a, b, a.axes[0])) return false;
  if (obbAxisSeparates(dx, dy, dz, a, b, a.axes[2])) return false;
  if (obbAxisSeparates(dx, dy, dz, a, b, b.axes[0])) return false;
  if (obbAxisSeparates(dx, dy, dz, a, b, b.axes[2])) return false;
  if (obbAxisSeparates(dx, dy, dz, a, b, a.axes[1])) return false;

  return true;
}

function sphereVsSphere(
  cA: Vector3D,
  rA: number,
  cB: Vector3D,
  rB: number,
): boolean {
  const sumR = rA + rB;
  return distSq(cA, cB) <= sumR * sumR;
}

/**
 * OBB vs Sphere: transform sphere center to OBB local space,
 * clamp to AABB, check distance.
 */
function obbVsSphere(
  obb: OBB,
  sphereCenter: Vector3D,
  sphereRadius: number,
): boolean {
  const diffX = sphereCenter.x - obb.center.x;
  const diffY = sphereCenter.y - obb.center.y;
  const diffZ = sphereCenter.z - obb.center.z;

  // Project to OBB local space
  const localX =
    diffX * obb.axes[0].x + diffY * obb.axes[0].y + diffZ * obb.axes[0].z;
  const localY =
    diffX * obb.axes[1].x + diffY * obb.axes[1].y + diffZ * obb.axes[1].z;
  const localZ =
    diffX * obb.axes[2].x + diffY * obb.axes[2].y + diffZ * obb.axes[2].z;

  // Clamp to AABB half-extents
  const closestX = clamp(localX, -obb.halfExtents.x, obb.halfExtents.x);
  const closestY = clamp(localY, -obb.halfExtents.y, obb.halfExtents.y);
  const closestZ = clamp(localZ, -obb.halfExtents.z, obb.halfExtents.z);

  const dx = localX - closestX;
  const dy = localY - closestY;
  const dz = localZ - closestZ;

  return dx * dx + dy * dy + dz * dz <= sphereRadius * sphereRadius;
}

// ============================================================
// Collision tests — triangle vs collider (mesh narrow phase)
// ============================================================

/**
 * Triangle vs AABB using SAT with 13 potential separating axes.
 * Triangle vertices must be in AABB local space (AABB centered at origin).
 */
function triangleVsAABB(
  v0: Vector3D,
  v1: Vector3D,
  v2: Vector3D,
  halfExtents: Vector3D,
): boolean {
  // Test axis helper: returns true if separated on this axis
  function separated(axis: Vector3D): boolean {
    if (
      Math.abs(axis.x) < 1e-10 &&
      Math.abs(axis.y) < 1e-10 &&
      Math.abs(axis.z) < 1e-10
    ) {
      return false; // Degenerate axis, skip
    }
    const p0 = dot3(v0, axis);
    const p1 = dot3(v1, axis);
    const p2 = dot3(v2, axis);
    const r =
      Math.abs(axis.x) * halfExtents.x +
      Math.abs(axis.y) * halfExtents.y +
      Math.abs(axis.z) * halfExtents.z;
    const triMin = Math.min(p0, p1, p2);
    const triMax = Math.max(p0, p1, p2);
    return triMin > r || triMax < -r;
  }

  // 3 box face normals
  if (separated(new Vector3D(1, 0, 0))) return false;
  if (separated(new Vector3D(0, 1, 0))) return false;
  if (separated(new Vector3D(0, 0, 1))) return false;

  // Triangle edges
  const f0 = v1.subtract(v0);
  const f1 = v2.subtract(v1);
  const f2 = v0.subtract(v2);

  // Triangle face normal
  const triNormal = cross3(f0, v2.subtract(v0));
  if (separated(triNormal)) return false;

  // 9 edge cross products (box edges × triangle edges)
  const boxEdges = [
    new Vector3D(1, 0, 0),
    new Vector3D(0, 1, 0),
    new Vector3D(0, 0, 1),
  ];
  const triEdges = [f0, f1, f2];

  for (const be of boxEdges) {
    for (const te of triEdges) {
      if (separated(cross3(be, te))) return false;
    }
  }

  return true; // No separating axis found — intersecting
}

/**
 * Triangle vs Sphere: find closest point on triangle to sphere center,
 * check distance.
 */
function triangleVsSphere(
  v0: Vector3D,
  v1: Vector3D,
  v2: Vector3D,
  sphereCenter: Vector3D,
  sphereRadius: number,
): { hit: boolean; closestPoint: Vector3D } {
  const closest = closestPointOnTriangle(sphereCenter, v0, v1, v2);
  const hit = distSq(sphereCenter, closest) <= sphereRadius * sphereRadius;
  return { hit, closestPoint: closest };
}

// ============================================================
// Cell-map helpers
// ============================================================

function inBounds(cellMap: CellMapT, coords: Vector3D): boolean {
  const m = cellMap.mapSize;
  return (
    coords.x >= 0 &&
    coords.x < m.x &&
    coords.y >= 0 &&
    coords.y < m.y &&
    coords.z >= 0 &&
    coords.z < m.z
  );
}

function isCellSolid(cellMap: CellMapT, coords: Vector3D): boolean {
  if (!inBounds(cellMap, coords)) return false;
  const cell = unpackCell(cellStoreGet(coords.x, coords.y, coords.z));
  return cell.visible && cell.shapeIndex !== 0;
}

function getCellShapeIndex(cellMap: CellMapT, coords: Vector3D): number {
  if (!inBounds(cellMap, coords)) return 0;
  return unpackCell(cellStoreGet(coords.x, coords.y, coords.z)).shapeIndex;
}

/**
 * Transform a mesh vertex (local -0.5..0.5) to world space, matching the
 * renderer's corner-based cell footprint `[i, i+1] * cellSize`:
 *   worldV = (gridCoord + unitV + 0.5) * cellSize
 */
function meshVertexToWorld(
  unitV: Vector3D,
  gridCoord: Vector3D,
  cellSize: Vector3D,
): Vector3D {
  return new Vector3D(
    (gridCoord.x + unitV.x + 0.5) * cellSize.x,
    (gridCoord.y + unitV.y + 0.5) * cellSize.y,
    (gridCoord.z + unitV.z + 0.5) * cellSize.z,
  );
}

/**
 * Get triangles from a mesh as arrays of 3 world-space Vector3D vertices.
 */
function getMeshTrianglesWorld(
  mesh: Mesh,
  gridCoord: Vector3D,
  cellSize: Vector3D,
): Array<[Vector3D, Vector3D, Vector3D]> {
  const triangles: Array<[Vector3D, Vector3D, Vector3D]> = [];
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const i0 = mesh.indices[i] * 3;
    const i1 = mesh.indices[i + 1] * 3;
    const i2 = mesh.indices[i + 2] * 3;

    const v0 = meshVertexToWorld(
      new Vector3D(
        mesh.vertices[i0],
        mesh.vertices[i0 + 1],
        mesh.vertices[i0 + 2],
      ),
      gridCoord,
      cellSize,
    );
    const v1 = meshVertexToWorld(
      new Vector3D(
        mesh.vertices[i1],
        mesh.vertices[i1 + 1],
        mesh.vertices[i1 + 2],
      ),
      gridCoord,
      cellSize,
    );
    const v2 = meshVertexToWorld(
      new Vector3D(
        mesh.vertices[i2],
        mesh.vertices[i2 + 1],
        mesh.vertices[i2 + 2],
      ),
      gridCoord,
      cellSize,
    );

    triangles.push([v0, v1, v2]);
  }
  return triangles;
}

/**
 * Extract world-space triangles from smoothed chunk vertex/index buffers
 * within a given AABB. Chunk vertices are already world-space, interleaved
 * [pos3, normal3, origPos3] with stride 9.
 */
function getChunkTrianglesInBounds(
  cellMap: CellMapT,
  bounds: { min: Vector3D; max: Vector3D },
): Array<[Vector3D, Vector3D, Vector3D]> {
  const triangles: Array<[Vector3D, Vector3D, Vector3D]> = [];

  // Determine which chunks overlap the bounds
  const csX = cellMap.cellSize.x * CHUNK_SIZE;
  const csY = cellMap.cellSize.y * CHUNK_SIZE;
  const csZ = cellMap.cellSize.z * CHUNK_SIZE;
  const minCx = Math.floor(bounds.min.x / csX);
  const minCy = Math.floor(bounds.min.y / csY);
  const minCz = Math.floor(bounds.min.z / csZ);
  const maxCx = Math.floor(bounds.max.x / csX);
  const maxCy = Math.floor(bounds.max.y / csY);
  const maxCz = Math.floor(bounds.max.z / csZ);

  for (const chunk of cellMap.chunks) {
    if (
      chunk.cx < minCx ||
      chunk.cx > maxCx ||
      chunk.cy < minCy ||
      chunk.cy > maxCy ||
      chunk.cz < minCz ||
      chunk.cz > maxCz
    )
      continue;
    if (!chunk.vertices || !chunk.indices) continue;

    const verts = chunk.vertices;
    const indices = chunk.indices;
    // Chunk vertices are interleaved [pos3, normal3, origPos3] (stride 9), or
    // [+uv2] (stride 11) when the cell-map has UV custom shapes.
    const stride = chunk.stride;
    for (let i = 0; i < indices.length; i += 3) {
      const i0 = indices[i] * stride;
      const i1 = indices[i + 1] * stride;
      const i2 = indices[i + 2] * stride;

      // Quick per-triangle AABB cull against collider bounds
      const x0 = verts[i0],
        y0 = verts[i0 + 1],
        z0 = verts[i0 + 2];
      const x1 = verts[i1],
        y1 = verts[i1 + 1],
        z1 = verts[i1 + 2];
      const x2 = verts[i2],
        y2 = verts[i2 + 1],
        z2 = verts[i2 + 2];

      if (
        Math.max(x0, x1, x2) < bounds.min.x ||
        Math.min(x0, x1, x2) > bounds.max.x ||
        Math.max(y0, y1, y2) < bounds.min.y ||
        Math.min(y0, y1, y2) > bounds.max.y ||
        Math.max(z0, z1, z2) < bounds.min.z ||
        Math.min(z0, z1, z2) > bounds.max.z
      )
        continue;

      triangles.push([
        new Vector3D(x0, y0, z0),
        new Vector3D(x1, y1, z1),
        new Vector3D(x2, y2, z2),
      ]);
    }
  }

  return triangles;
}

// ============================================================
// World bounds computation
// ============================================================

function getWorldBoundsImpl(collider: ColliderT): {
  min: Vector3D;
  max: Vector3D;
} {
  if (collider.shape === 'box') {
    return computeOBB(collider).worldAABB;
  }

  const sphere = computeSphereWorld(collider);
  return {
    min: new Vector3D(
      sphere.center.x - sphere.radius,
      sphere.center.y - sphere.radius,
      sphere.center.z - sphere.radius,
    ),
    max: new Vector3D(
      sphere.center.x + sphere.radius,
      sphere.center.y + sphere.radius,
      sphere.center.z + sphere.radius,
    ),
  };
}

// ============================================================
// Grid cell helpers
// ============================================================

function getOccupiedCellsImpl(
  collider: ColliderT,
  cellMap: CellMapT,
): Vector3D[] {
  const bounds = getWorldBoundsImpl(collider);
  const cells: Vector3D[] = [];

  const minGx = Math.max(0, Math.floor(bounds.min.x / cellMap.cellSize.x));
  const minGy = Math.max(0, Math.floor(bounds.min.y / cellMap.cellSize.y));
  const minGz = Math.max(0, Math.floor(bounds.min.z / cellMap.cellSize.z));
  const maxGx = Math.min(
    cellMap.mapSize.x - 1,
    Math.floor(bounds.max.x / cellMap.cellSize.x),
  );
  const maxGy = Math.min(
    cellMap.mapSize.y - 1,
    Math.floor(bounds.max.y / cellMap.cellSize.y),
  );
  const maxGz = Math.min(
    cellMap.mapSize.z - 1,
    Math.floor(bounds.max.z / cellMap.cellSize.z),
  );

  for (let gz = minGz; gz <= maxGz; gz++) {
    for (let gy = minGy; gy <= maxGy; gy++) {
      for (let gx = minGx; gx <= maxGx; gx++) {
        cells.push(new Vector3D(gx, gy, gz));
      }
    }
  }

  return cells;
}

// ============================================================
// Mesh collision testing
// ============================================================

/**
 * Tests a single collider against the mesh geometry of solid cells.
 * Returns the collision result with hit cells and contact center.
 */
function testColliderVsCellMapMesh(
  collider: ColliderT,
  cellMap: CellMapT,
  solidCells: Vector3D[],
  skipMeshCheck: boolean,
): CellMapCollisionResult {
  if (solidCells.length === 0) {
    return { hit: false, cells: [], center: null };
  }

  // skipMeshCheck: contact center = centroid of cell world centers
  if (skipMeshCheck) {
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const cell of solidCells) {
      cx += (cell.x + 0.5) * cellMap.cellSize.x;
      cy += (cell.y + 0.5) * cellMap.cellSize.y;
      cz += (cell.z + 0.5) * cellMap.cellSize.z;
    }
    const n = solidCells.length;
    return {
      hit: true,
      cells: solidCells,
      center: new Vector3D(cx / n, cy / n, cz / n),
    };
  }

  // Smoothed cell maps: test against actual chunk geometry
  if (cellMap.smoothing > 0) {
    return testColliderVsSmoothedMesh(collider, cellMap, solidCells);
  }

  // Full mesh collision (unsmoothed path)
  const hitCells: Vector3D[] = [];
  const contactPoints: Vector3D[] = [];

  for (const cellCoords of solidCells) {
    const shapeIndex = getCellShapeIndex(cellMap, cellCoords);
    const mesh = cellMap.meshes[shapeIndex];
    if (!mesh || mesh.indices.length === 0) continue;

    const triangles = getMeshTrianglesWorld(mesh, cellCoords, cellMap.cellSize);
    let cellHit = false;

    if (collider.shape === 'box') {
      const obb = computeOBB(collider);
      for (const [tv0, tv1, tv2] of triangles) {
        // Transform triangle to OBB local space
        const d0 = tv0.subtract(obb.center);
        const d1 = tv1.subtract(obb.center);
        const d2 = tv2.subtract(obb.center);
        const lv0 = new Vector3D(
          dot3(d0, obb.axes[0]),
          dot3(d0, obb.axes[1]),
          dot3(d0, obb.axes[2]),
        );
        const lv1 = new Vector3D(
          dot3(d1, obb.axes[0]),
          dot3(d1, obb.axes[1]),
          dot3(d1, obb.axes[2]),
        );
        const lv2 = new Vector3D(
          dot3(d2, obb.axes[0]),
          dot3(d2, obb.axes[1]),
          dot3(d2, obb.axes[2]),
        );

        if (triangleVsAABB(lv0, lv1, lv2, obb.halfExtents)) {
          cellHit = true;
          // Closest point on triangle to OBB center (in world space)
          const cp = closestPointOnTriangle(obb.center, tv0, tv1, tv2);
          contactPoints.push(cp);
        }
      }
    } else {
      // Sphere
      const sphere = computeSphereWorld(collider);
      for (const [tv0, tv1, tv2] of triangles) {
        const result = triangleVsSphere(
          tv0,
          tv1,
          tv2,
          sphere.center,
          sphere.radius,
        );
        if (result.hit) {
          cellHit = true;
          contactPoints.push(result.closestPoint);
        }
      }
    }

    if (cellHit) {
      hitCells.push(cellCoords);
    }
  }

  if (hitCells.length === 0) {
    return { hit: false, cells: [], center: null };
  }

  // Contact center = centroid of all contact points
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const cp of contactPoints) {
    cx += cp.x;
    cy += cp.y;
    cz += cp.z;
  }
  const n = contactPoints.length;

  return {
    hit: true,
    cells: hitCells,
    center: new Vector3D(cx / n, cy / n, cz / n),
  };
}

/**
 * Tests a collider against the smoothed chunk geometry of a cell map.
 * Used when cellMap.smoothing > 0 so collision matches the rendered mesh.
 */
function testColliderVsSmoothedMesh(
  collider: ColliderT,
  cellMap: CellMapT,
  solidCells: Vector3D[],
): CellMapCollisionResult {
  const bounds = getWorldBoundsImpl(collider);
  const triangles = getChunkTrianglesInBounds(cellMap, bounds);

  if (triangles.length === 0) {
    return { hit: false, cells: [], center: null };
  }

  const contactPoints: Vector3D[] = [];

  if (collider.shape === 'box') {
    const obb = computeOBB(collider);
    for (const [tv0, tv1, tv2] of triangles) {
      const d0 = tv0.subtract(obb.center);
      const d1 = tv1.subtract(obb.center);
      const d2 = tv2.subtract(obb.center);
      const lv0 = new Vector3D(
        dot3(d0, obb.axes[0]),
        dot3(d0, obb.axes[1]),
        dot3(d0, obb.axes[2]),
      );
      const lv1 = new Vector3D(
        dot3(d1, obb.axes[0]),
        dot3(d1, obb.axes[1]),
        dot3(d1, obb.axes[2]),
      );
      const lv2 = new Vector3D(
        dot3(d2, obb.axes[0]),
        dot3(d2, obb.axes[1]),
        dot3(d2, obb.axes[2]),
      );

      if (triangleVsAABB(lv0, lv1, lv2, obb.halfExtents)) {
        contactPoints.push(closestPointOnTriangle(obb.center, tv0, tv1, tv2));
      }
    }
  } else {
    const sphere = computeSphereWorld(collider);
    for (const [tv0, tv1, tv2] of triangles) {
      const result = triangleVsSphere(
        tv0,
        tv1,
        tv2,
        sphere.center,
        sphere.radius,
      );
      if (result.hit) {
        contactPoints.push(result.closestPoint);
      }
    }
  }

  if (contactPoints.length === 0) {
    return { hit: false, cells: [], center: null };
  }

  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const cp of contactPoints) {
    cx += cp.x;
    cy += cp.y;
    cz += cp.z;
  }
  const n = contactPoints.length;

  return {
    hit: true,
    cells: solidCells,
    center: new Vector3D(cx / n, cy / n, cz / n),
  };
}

// ============================================================
// Collider methods object
// ============================================================

export const Collider: ColliderMethods = {
  type: 'collider',

  async init(_component: ComponentData): Promise<void> {
    // No-op
  },

  getWorldCenter(collider: ColliderT): Vector3D {
    if (collider.shape === 'sphere') {
      return computeSphereWorld(collider).center;
    }
    return computeOBB(collider).center;
  },

  getWorldBounds(collider: ColliderT): { min: Vector3D; max: Vector3D } {
    return getWorldBoundsImpl(collider);
  },

  intersectsCollider(collider: ColliderT, other: ColliderT): boolean {
    const shapeA = collider.shape;
    const shapeB = other.shape;

    if (shapeA === 'box' && shapeB === 'box') {
      computeOBBInto(collider, scratchObbA);
      computeOBBInto(other, scratchObbB);
      return obbVsObb(scratchObbA, scratchObbB);
    }

    if (shapeA === 'sphere' && shapeB === 'sphere') {
      const rA = computeSphereWorldInto(collider, scratchSphereCenterA);
      const rB = computeSphereWorldInto(other, scratchSphereCenterB);
      return sphereVsSphere(scratchSphereCenterA, rA, scratchSphereCenterB, rB);
    }

    // OBB vs Sphere (order doesn't matter)
    if (shapeA === 'box' && shapeB === 'sphere') {
      computeOBBInto(collider, scratchObbA);
      const r = computeSphereWorldInto(other, scratchSphereCenterB);
      return obbVsSphere(scratchObbA, scratchSphereCenterB, r);
    }

    // Sphere vs OBB
    computeOBBInto(other, scratchObbA);
    const r = computeSphereWorldInto(collider, scratchSphereCenterA);
    return obbVsSphere(scratchObbA, scratchSphereCenterA, r);
  },

  getOccupiedCells(collider: ColliderT, cellMap: CellMapT): Vector3D[] {
    return getOccupiedCellsImpl(collider, cellMap);
  },

  getOccupiedSolidCells(collider: ColliderT, cellMap: CellMapT): Vector3D[] {
    return getOccupiedCellsImpl(collider, cellMap).filter((coords) =>
      isCellSolid(cellMap, coords),
    );
  },

  intersectsCellMap(
    collider: ColliderT,
    cellMap: CellMapT,
    options?: ProcessCollisionsOptions,
  ): CellMapCollisionResult {
    const solidCells = Collider.getOccupiedSolidCells(collider, cellMap);
    return testColliderVsCellMapMesh(
      collider,
      cellMap,
      solidCells,
      options?.skipMeshCheck ?? false,
    );
  },

  processCollisions(
    collider: ColliderT,
    cellMap: CellMapT,
    options?: ProcessCollisionsOptions,
  ): CollisionPipelineResult {
    const skipMeshCheck = options?.skipMeshCheck ?? false;
    const sceneRoot = getSceneRoot(collider);

    // Find all colliders in the scene
    let allColliders: ColliderT[] = [];
    if (sceneRoot) {
      allColliders = sceneRoot.getComponentsByType(
        'collider',
        true,
      ) as ColliderT[];
    }

    // Step 1: Cell occupation for each collider
    const occupiedCells = new Map<ColliderT, Vector3D[]>();
    for (const col of allColliders) {
      occupiedCells.set(col, getOccupiedCellsImpl(col, cellMap));
    }

    // Step 2: Collider-collider via shared cells
    // Build spatial hash: cellKey → colliders in that cell
    const spatialHash = new Map<string, ColliderT[]>();
    for (const [col, cells] of occupiedCells) {
      for (const cell of cells) {
        const key = `${cell.x},${cell.y},${cell.z}`;
        let list = spatialHash.get(key);
        if (!list) {
          list = [];
          spatialHash.set(key, list);
        }
        list.push(col);
      }
    }

    // Find unique collider pairs sharing cells, then narrow-phase test
    const testedPairs = new Set<string>();
    const colliderPairs: Array<{ a: ColliderT; b: ColliderT }> = [];

    for (const colliders of spatialHash.values()) {
      if (colliders.length < 2) continue;
      for (let i = 0; i < colliders.length; i++) {
        for (let j = i + 1; j < colliders.length; j++) {
          const idA = colliders[i].id ?? 0;
          const idB = colliders[j].id ?? 0;
          const pairKey = idA < idB ? `${idA}:${idB}` : `${idB}:${idA}`;
          if (testedPairs.has(pairKey)) continue;
          testedPairs.add(pairKey);

          if (Collider.intersectsCollider(colliders[i], colliders[j])) {
            colliderPairs.push({
              a: colliders[i],
              b: colliders[j],
            });
          }
        }
      }
    }

    // Step 3: Solid cell overlaps
    const solidCellOverlaps = new Map<ColliderT, Vector3D[]>();
    for (const [col, cells] of occupiedCells) {
      const solidCells = cells.filter((coords) => isCellSolid(cellMap, coords));
      solidCellOverlaps.set(col, solidCells);
    }

    // Step 4: Mesh collision + contact center
    const cellMapCollisions = new Map<ColliderT, CellMapCollisionResult>();
    for (const [col, solidCells] of solidCellOverlaps) {
      cellMapCollisions.set(
        col,
        testColliderVsCellMapMesh(col, cellMap, solidCells, skipMeshCheck),
      );
    }

    return {
      occupiedCells,
      colliderPairs,
      solidCellOverlaps,
      cellMapCollisions,
    };
  },

  setShape(collider: ColliderT, shape: 'box' | 'sphere'): void {
    collider.shape = shape;
  },

  setSize(collider: ColliderT, x: number, y: number, z: number): void {
    collider.size.x = x;
    collider.size.y = y;
    collider.size.z = z;
  },

  setRadius(collider: ColliderT, radius: number): void {
    collider.radius = radius;
  },

  setOffset(collider: ColliderT, x: number, y: number, z: number): void {
    collider.offset.x = x;
    collider.offset.y = y;
    collider.offset.z = z;
  },

  dispose(c: ComponentData) {
    const collider = c as ColliderT;
    collider._disposed = true;
  },
};
