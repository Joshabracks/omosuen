// Mesh-accurate surface / collision queries against a cell-map's ACTUAL rendered
// geometry. The engine keeps each chunk's built mesh on the CPU (`chunk.vertices`,
// world-space, interleaved stride 10/12, smoothed position at floats 0-2, normal at
// 3-5) — smoothing and custom cell meshes are already baked in — so these queries
// work uniformly whether `smoothing` is 0 or >0, and need no WASM round-trip.
//
// `cellToWorldCoordinates` (methods.ts) only gives the analytic ideal cube top; use
// these to seat sprites on the real surface of smoothed / ramp / custom cells.

import { Vector3D, rayTriangle } from '../../math';
import type { CellMapT } from './data';
import type { RaycastHit, SurfaceHit, RaycastOptions } from './types';

/**
 * Extract world-space triangles from the built chunk buffers within an AABB.
 * Chunk vertices are already world-space, interleaved [pos3, normal3, origPos3,
 * emission1] (stride 10), or [+uv2] (stride 12) when UV custom shapes are present.
 * (Shared with the collider's cell-map overlap tests.)
 */
export function getChunkTrianglesInBounds(
  cellMap: CellMapT,
  bounds: { min: Vector3D; max: Vector3D },
): Array<[Vector3D, Vector3D, Vector3D]> {
  const triangles: Array<[Vector3D, Vector3D, Vector3D]> = [];

  // Determine which chunks overlap the bounds
  const csX = cellMap.cellSize.x * cellMap.chunkSize.x;
  const csY = cellMap.cellSize.y * cellMap.chunkSize.y;
  const csZ = cellMap.cellSize.z * cellMap.chunkSize.z;
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
    const stride = chunk.stride;
    for (let i = 0; i < indices.length; i += 3) {
      const i0 = indices[i] * stride;
      const i1 = indices[i + 1] * stride;
      const i2 = indices[i + 2] * stride;

      // Quick per-triangle AABB cull against bounds
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

/** Ray/AABB slab test → entry distance (0 if the origin is inside), or null if missed. */
function rayAABBEntry(
  o: Vector3D,
  invx: number,
  invy: number,
  invz: number,
  minx: number,
  miny: number,
  minz: number,
  maxx: number,
  maxy: number,
  maxz: number,
): number | null {
  let tmin = -Infinity;
  let tmax = Infinity;

  let t1 = (minx - o.x) * invx;
  let t2 = (maxx - o.x) * invx;
  if (t1 > t2) [t1, t2] = [t2, t1];
  tmin = Math.max(tmin, t1);
  tmax = Math.min(tmax, t2);

  t1 = (miny - o.y) * invy;
  t2 = (maxy - o.y) * invy;
  if (t1 > t2) [t1, t2] = [t2, t1];
  tmin = Math.max(tmin, t1);
  tmax = Math.min(tmax, t2);

  t1 = (minz - o.z) * invz;
  t2 = (maxz - o.z) * invz;
  if (t1 > t2) [t1, t2] = [t2, t1];
  tmin = Math.max(tmin, t1);
  tmax = Math.min(tmax, t2);

  if (tmax < 0 || tmin > tmax) return null;
  return tmin < 0 ? 0 : tmin;
}

/**
 * Cast a ray against the cell-map's real (smoothed/custom) mesh surface and return
 * the nearest hit, or null on a miss. `dir` need not be normalized; `distance` is in
 * world units. Broad-phase skips chunks the ray doesn't enter, then tests each
 * candidate triangle with Möller–Trumbore (double-sided).
 */
export function raycastCellMap(
  cellMap: CellMapT,
  origin: Vector3D,
  dir: Vector3D,
  opts: RaycastOptions = {},
): RaycastHit | null {
  const dl = Math.hypot(dir.x, dir.y, dir.z);
  if (dl === 0) return null;
  const dx = dir.x / dl,
    dy = dir.y / dl,
    dz = dir.z / dl;
  const ndir = new Vector3D(dx, dy, dz);

  const cs = cellMap.cellSize;
  // `mapSize` is now the resident WINDOW's size, not the whole world, so
  // this default caps a ray at the window's diagonal rather than the whole
  // map's — a ray can no longer default-travel further than what's currently
  // loaded. Callers that need farther reach must pass `maxDistance` explicitly.
  const maxDist =
    opts.maxDistance ??
    Math.hypot(
      cellMap.mapSize.x * cs.x,
      cellMap.mapSize.y * cs.y,
      cellMap.mapSize.z * cs.z,
    ) + cs.y;

  const invx = dx !== 0 ? 1 / dx : Infinity;
  const invy = dy !== 0 ? 1 / dy : Infinity;
  const invz = dz !== 0 ? 1 / dz : Infinity;

  // Reused per-triangle vertices — rayTriangle only reads them, so no per-tri alloc.
  const va = new Vector3D(0, 0, 0);
  const vb = new Vector3D(0, 0, 0);
  const vc = new Vector3D(0, 0, 0);

  let bestT = Infinity;
  let bestU = 0;
  let bestV = 0;
  let found = false;
  // Winning triangle positions (+ vertex normals when smoothNormal).
  let ax = 0, ay = 0, az = 0, bx = 0, by = 0, bz = 0, cx2 = 0, cy2 = 0, cz2 = 0;
  let anx = 0, any0 = 0, anz = 0, bnx = 0, bny = 0, bnz = 0, cnx = 0, cny = 0, cnz = 0;

  const chunkW = cellMap.chunkSize.x * cs.x;
  const chunkH = cellMap.chunkSize.y * cs.y;
  const chunkD = cellMap.chunkSize.z * cs.z;
  // Pad the chunk AABB by a cell so smoothing displacement at chunk borders is caught.
  const padX = cs.x, padY = cs.y, padZ = cs.z;

  for (const chunk of cellMap.chunks) {
    if (!chunk.vertices || !chunk.indices) continue;

    const minx = chunk.cx * chunkW - padX;
    const maxx = (chunk.cx + 1) * chunkW + padX;
    const miny = chunk.cy * chunkH - padY;
    const maxy = (chunk.cy + 1) * chunkH + padY;
    const minz = chunk.cz * chunkD - padZ;
    const maxz = (chunk.cz + 1) * chunkD + padZ;
    const tEnter = rayAABBEntry(
      origin, invx, invy, invz, minx, miny, minz, maxx, maxy, maxz,
    );
    if (tEnter === null || tEnter > Math.min(bestT, maxDist)) continue;

    const verts = chunk.vertices;
    const indices = chunk.indices;
    const stride = chunk.stride;
    for (let i = 0; i < indices.length; i += 3) {
      const i0 = indices[i] * stride;
      const i1 = indices[i + 1] * stride;
      const i2 = indices[i + 2] * stride;
      va.x = verts[i0]; va.y = verts[i0 + 1]; va.z = verts[i0 + 2];
      vb.x = verts[i1]; vb.y = verts[i1 + 1]; vb.z = verts[i1 + 2];
      vc.x = verts[i2]; vc.y = verts[i2 + 1]; vc.z = verts[i2 + 2];

      const hit = rayTriangle(origin, ndir, va, vb, vc);
      if (hit && hit.t < bestT && hit.t <= maxDist) {
        bestT = hit.t;
        bestU = hit.u;
        bestV = hit.v;
        found = true;
        ax = va.x; ay = va.y; az = va.z;
        bx = vb.x; by = vb.y; bz = vb.z;
        cx2 = vc.x; cy2 = vc.y; cz2 = vc.z;
        if (opts.smoothNormal) {
          anx = verts[i0 + 3]; any0 = verts[i0 + 4]; anz = verts[i0 + 5];
          bnx = verts[i1 + 3]; bny = verts[i1 + 4]; bnz = verts[i1 + 5];
          cnx = verts[i2 + 3]; cny = verts[i2 + 4]; cnz = verts[i2 + 5];
        }
      }
    }
  }

  if (!found) return null;

  const px = origin.x + dx * bestT;
  const py = origin.y + dy * bestT;
  const pz = origin.z + dz * bestT;

  let nx: number, ny: number, nz: number;
  if (opts.smoothNormal) {
    const w = 1 - bestU - bestV;
    nx = w * anx + bestU * bnx + bestV * cnx;
    ny = w * any0 + bestU * bny + bestV * cny;
    nz = w * anz + bestU * bnz + bestV * cnz;
  } else {
    // Geometric normal = (b-a) × (c-a).
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx2 - ax, e2y = cy2 - ay, e2z = cz2 - az;
    nx = e1y * e2z - e1z * e2y;
    ny = e1z * e2x - e1x * e2z;
    nz = e1x * e2y - e1y * e2x;
  }
  const nl = Math.hypot(nx, ny, nz) || 1;
  nx /= nl; ny /= nl; nz /= nl;
  if (nx * dx + ny * dy + nz * dz > 0) {
    nx = -nx; ny = -ny; nz = -nz; // orient to oppose the ray
  }

  // Owning cell = floor of a point nudged past the surface, INTO the solid, along the
  // ray. Smoothing can displace the surface up to ~half a cell past the nominal cell
  // boundary, so nudge by a quarter-cell (not a hair) to land reliably inside the
  // owning cell. For the vertical surface-query rays this only shifts Y.
  const eps = 0.25 * Math.min(cs.x, cs.y, cs.z);
  const cell = new Vector3D(
    Math.floor((px + dx * eps) / cs.x),
    Math.floor((py + dy * eps) / cs.y),
    Math.floor((pz + dz * eps) / cs.z),
  );

  return {
    point: new Vector3D(px, py, pz),
    normal: new Vector3D(nx, ny, nz),
    cell,
    distance: bestT,
  };
}

/**
 * The true surface point at the top-center of a cell (smoothing / custom mesh
 * accounted for), for seating a bottom-center-anchored sprite. Casts a short ray
 * straight down through the cell column; falls back to the analytic top-face center
 * when the cell has no exposed top surface (air / fully-enclosed).
 */
export function cellSurfacePoint(
  cellMap: CellMapT,
  cell: Vector3D,
  opts: RaycastOptions = {},
): Vector3D {
  const cs = cellMap.cellSize;
  const ox = (cell.x + 0.5) * cs.x;
  const oz = (cell.z + 0.5) * cs.z;
  // Start 0.75 cell above the nominal top (clears the max smoothing bump), scan down
  // through this cell's height so we hit THIS cell's top, not a lower one.
  const origin = new Vector3D(ox, (cell.y + 1) * cs.y + 0.75 * cs.y, oz);
  const hit = raycastCellMap(cellMap, origin, new Vector3D(0, -1, 0), {
    maxDistance: 1.75 * cs.y,
    smoothNormal: opts.smoothNormal,
  });
  if (hit) return hit.point;
  return new Vector3D(ox, (cell.y + 1) * cs.y, oz); // analytic fallback
}

/**
 * The topmost mesh surface at an arbitrary world (x,z) — for smooth cell-to-cell
 * traversal (sample the height as a sprite walks). Returns null if the column is
 * empty at (x,z).
 */
export function sampleSurfaceHeight(
  cellMap: CellMapT,
  worldX: number,
  worldZ: number,
  opts: RaycastOptions = {},
): SurfaceHit | null {
  const cs = cellMap.cellSize;
  // Same window-size-vs-world-size heuristic shift as `raycastCellMap` above:
  // `mapSize.y` is the resident window's height, so this cast starts just
  // above the window's top and reaches only as far as the window's own
  // height by default (not the whole world's) — pass `maxDistance` explicitly
  // for a taller world.
  const origin = new Vector3D(worldX, cellMap.mapSize.y * cs.y + cs.y, worldZ);
  const hit = raycastCellMap(cellMap, origin, new Vector3D(0, -1, 0), {
    maxDistance: opts.maxDistance ?? cellMap.mapSize.y * cs.y + 2 * cs.y,
    smoothNormal: opts.smoothNormal,
  });
  if (!hit) return null;
  return { point: hit.point, normal: hit.normal };
}
