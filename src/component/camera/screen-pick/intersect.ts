/**
 * Geometry kernels for screen picking. All functions are allocation-free: they
 * operate on primitives or caller-provided scratch. Not reentrant (shared
 * module scratch is consumed synchronously).
 *
 * Every cell-facing entry point here speaks WORLD coordinates — see
 * {@link cellWindowRange} for why that is worth stating out loud.
 *
 * Deliberately a leaf: the only runtime imports are `math`, `cell-map/types`
 * and `./ray`. Everything cell-map- or collider-shaped is a type-only import,
 * so this module stays loadable outside webpack. Reaching the component
 * registry (via the `cell-map` barrel or `collider/methods`) would drag in
 * camera/init's raw .vert/.frag shader imports, which a bare tsx test run
 * cannot load — see test/camera-projection.test.ts's note on the same problem.
 */

import { Vector3D } from '../../../math';
import type { CellMapT } from '../../cell-map/data';
import { unpackCell } from '../../cell-map/types';
import type { ColliderOBB } from '../../collider/methods';
// ./projection-math, not ./ray — ray.ts re-exports these unchanged but also
// pulls `castTo` from the component registry. See the module header.
import type { ProjectionParams } from './projection-math';
import { screenToWorldAtHeight, viewDirInto } from './projection-math';

const EPS = 1e-6;

// ============================================================
// Ray vs AABB / OBB / sphere (infinite line; t may be negative)
// ============================================================

export interface Span {
  tEnter: number;
  tExit: number;
}

/** Slab test of the infinite line against an axis-aligned box. */
export function rayAABB(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  minx: number, miny: number, minz: number,
  maxx: number, maxy: number, maxz: number,
  out: Span,
): boolean {
  let tmin = -Infinity;
  let tmax = Infinity;

  // X
  if (Math.abs(dx) < EPS) {
    if (ox < minx || ox > maxx) return false;
  } else {
    let t1 = (minx - ox) / dx;
    let t2 = (maxx - ox) / dx;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
  }
  // Y
  if (Math.abs(dy) < EPS) {
    if (oy < miny || oy > maxy) return false;
  } else {
    let t1 = (miny - oy) / dy;
    let t2 = (maxy - oy) / dy;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
  }
  // Z
  if (Math.abs(dz) < EPS) {
    if (oz < minz || oz > maxz) return false;
  } else {
    let t1 = (minz - oz) / dz;
    let t2 = (maxz - oz) / dz;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
  }

  if (tmax < tmin) return false;
  out.tEnter = tmin;
  out.tExit = tmax;
  return true;
}

/** Entry `t` where the line enters the OBB, or NaN if it misses. */
export function rayOBB(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  obb: ColliderOBB,
): number {
  let tmin = -Infinity;
  let tmax = Infinity;
  const ocx = obb.center.x - ox;
  const ocy = obb.center.y - oy;
  const ocz = obb.center.z - oz;
  const h = obb.halfExtents;

  for (let i = 0; i < 3; i++) {
    const axis = obb.axes[i];
    const half = i === 0 ? h.x : i === 1 ? h.y : h.z;
    const e = axis.x * ocx + axis.y * ocy + axis.z * ocz;
    const f = axis.x * dx + axis.y * dy + axis.z * dz;
    if (Math.abs(f) > EPS) {
      let t1 = (e - half) / f;
      let t2 = (e + half) / f;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return NaN;
    } else if (-e - half > 0 || -e + half < 0) {
      // Line parallel to slab and outside it.
      return NaN;
    }
  }
  return tmin;
}

/** Entry `t` where the line enters the sphere, or NaN if it misses. */
export function raySphere(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  cx: number, cy: number, cz: number,
  r: number,
): number {
  const ocx = cx - ox;
  const ocy = cy - oy;
  const ocz = cz - oz;
  const b = ocx * dx + ocy * dy + ocz * dz; // dir is unit
  const c = ocx * ocx + ocy * ocy + ocz * ocz - r * r;
  const disc = b * b - c;
  if (disc < 0) return NaN;
  return b - Math.sqrt(disc);
}

// ============================================================
// 3D DDA cell traversal (Amanatides–Woo)
// ============================================================

/** Solid cells found along a ray, in near→far order. Parallel arrays, pooled. */
export interface CellMarch {
  x: number[];
  y: number[];
  z: number[];
  t: number[];
  count: number;
}

export function makeCellMarch(): CellMarch {
  return { x: [], y: [], z: [], t: [], count: 0 };
}

/**
 * Inclusive range of WORLD cell coordinates covered by a cell-map's resident
 * window.
 *
 * `cellMap.mapSize` is the *window's* size, not the world's, and the window
 * sits at `window.origin * chunkSize` — so the addressable range starts at
 * cell (0,0,0) only until something moves the focus. Everything downstream of
 * a pick (`CellMap.getCellData` → `window.queryCell`, the hit positions handed
 * back to callers) speaks world coordinates, so the traversal must too.
 */
export interface CellRange {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

/** World-unit AABB of a cell-map's resident window. Reused, never handed out. */
const windowBounds = {
  minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0,
};

/**
 * Fills `out` with the window's world cell range, and `windowBounds` (returned)
 * with the matching world-unit AABB.
 *
 * This is `CellMap.getBounds` computed in place — same formula, no allocation,
 * and no import of the cell-map barrel (see the module header). The cell range
 * is exact because those bounds span exactly `mapSize` cells.
 */
export function cellWindowRange(
  cellMap: CellMapT,
  out: CellRange,
): typeof windowBounds {
  const cs = cellMap.cellSize;
  const ms = cellMap.mapSize;
  const cks = cellMap.chunkSize;
  const origin = cellMap.window.origin;
  // Null before the first `setFocus` — the window is then still at the world
  // origin, which is exactly what the old unconditional `[0, mapSize)` assumed.
  out.minX = (origin?.cx ?? 0) * cks.x;
  out.minY = (origin?.cy ?? 0) * cks.y;
  out.minZ = (origin?.cz ?? 0) * cks.z;
  out.maxX = out.minX + ms.x - 1;
  out.maxY = out.minY + ms.y - 1;
  out.maxZ = out.minZ + ms.z - 1;

  windowBounds.minX = out.minX * cs.x;
  windowBounds.minY = out.minY * cs.y;
  windowBounds.minZ = out.minZ * cs.z;
  windowBounds.maxX = (out.maxX + 1) * cs.x;
  windowBounds.maxY = (out.maxY + 1) * cs.y;
  windowBounds.maxZ = (out.maxZ + 1) * cs.z;
  return windowBounds;
}

const marchSpan: Span = { tEnter: 0, tExit: 0 };
const marchRange: CellRange = {
  minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0,
};

function cellSolid(
  cellMap: CellMapT,
  x: number,
  y: number,
  z: number,
  r: CellRange,
): boolean {
  if (x < r.minX || y < r.minY || z < r.minZ) return false;
  if (x > r.maxX || y > r.maxY || z > r.maxZ) return false;
  // `window.queryCell` + `unpackCell` is exactly what `CellMap.getCellData`
  // does, minus the barrel import and the per-cell Vector3D write.
  const cell = unpackCell(cellMap.window.queryCell(x, y, z));
  return cell.visible && cell.shapeIndex !== 0;
}

function pushCell(out: CellMarch, x: number, y: number, z: number, t: number): void {
  const i = out.count;
  if (i >= out.x.length) {
    out.x.push(0); out.y.push(0); out.z.push(0); out.t.push(0);
  }
  out.x[i] = x; out.y[i] = y; out.z[i] = z; out.t[i] = t;
  out.count++;
}

/**
 * Marches the ray through `cellMap`'s resident window, recording solid cells
 * into `out` in near→far order, as WORLD cell coordinates. Stops after the
 * first solid cell when `stopAtFirst`.
 */
export function marchCells(
  origin: Vector3D,
  dir: Vector3D,
  cellMap: CellMapT,
  out: CellMarch,
  stopAtFirst: boolean,
): void {
  out.count = 0;
  const cs = cellMap.cellSize;
  const ms = cellMap.mapSize;
  const r = marchRange;
  const bounds = cellWindowRange(cellMap, r);

  if (
    !rayAABB(
      origin.x, origin.y, origin.z,
      dir.x, dir.y, dir.z,
      bounds.minX, bounds.minY, bounds.minZ,
      bounds.maxX, bounds.maxY, bounds.maxZ,
      marchSpan,
    )
  ) {
    return;
  }

  // Begin at the AABB entry (clamp to the box surface).
  const tStart = marchSpan.tEnter;
  const tEnd = marchSpan.tExit;
  const ex = origin.x + dir.x * tStart;
  const ey = origin.y + dir.y * tStart;
  const ez = origin.z + dir.z * tStart;

  let cx = Math.floor(ex / cs.x);
  let cy = Math.floor(ey / cs.y);
  let cz = Math.floor(ez / cs.z);
  // Clamp the seed cell into range (guards floating-point edge cases).
  if (cx < r.minX) cx = r.minX; else if (cx > r.maxX) cx = r.maxX;
  if (cy < r.minY) cy = r.minY; else if (cy > r.maxY) cy = r.maxY;
  if (cz < r.minZ) cz = r.minZ; else if (cz > r.maxZ) cz = r.maxZ;

  const stepX = dir.x > 0 ? 1 : dir.x < 0 ? -1 : 0;
  const stepY = dir.y > 0 ? 1 : dir.y < 0 ? -1 : 0;
  const stepZ = dir.z > 0 ? 1 : dir.z < 0 ? -1 : 0;

  const tDeltaX = stepX !== 0 ? Math.abs(cs.x / dir.x) : Infinity;
  const tDeltaY = stepY !== 0 ? Math.abs(cs.y / dir.y) : Infinity;
  const tDeltaZ = stepZ !== 0 ? Math.abs(cs.z / dir.z) : Infinity;

  // Distance (in t) from the entry point to the next cell boundary per axis.
  const nextBoundary = (cell: number, step: number, size: number, o: number, d: number): number => {
    if (step === 0) return Infinity;
    const boundary = (step > 0 ? cell + 1 : cell) * size;
    return tStart + (boundary - (o + d * tStart)) / d;
  };
  let tMaxX = nextBoundary(cx, stepX, cs.x, origin.x, dir.x);
  let tMaxY = nextBoundary(cy, stepY, cs.y, origin.y, dir.y);
  let tMaxZ = nextBoundary(cz, stepZ, cs.z, origin.z, dir.z);

  let tCur = tStart;
  // Guard against pathological infinite loops. The window's size still bounds
  // the step count even though the range no longer starts at zero.
  const maxSteps = (ms.x + ms.y + ms.z) * 2 + 3;
  for (let s = 0; s < maxSteps; s++) {
    if (cx < r.minX || cy < r.minY || cz < r.minZ) break;
    if (cx > r.maxX || cy > r.maxY || cz > r.maxZ) break;
    if (tCur > tEnd) break;

    if (cellSolid(cellMap, cx, cy, cz, r)) {
      pushCell(out, cx, cy, cz, tCur);
      if (stopAtFirst) return;
    }

    if (tMaxX <= tMaxY && tMaxX <= tMaxZ) {
      cx += stepX; tCur = tMaxX; tMaxX += tDeltaX;
    } else if (tMaxY <= tMaxZ) {
      cy += stepY; tCur = tMaxY; tMaxY += tDeltaY;
    } else {
      cz += stepZ; tCur = tMaxZ; tMaxZ += tDeltaZ;
    }
  }
}

// ============================================================
// Convex prism (volume approximation for line/triangle/quad cell & collider
// selection): the screen polygon extruded along the world view direction.
// Inside ⇔ n·X ≤ d for every side plane.
// ============================================================

export interface Prism {
  nx: number[];
  ny: number[];
  nz: number[];
  d: number[];
  count: number;
}

export function makePrism(): Prism {
  return { nx: [], ny: [], nz: [], d: [], count: 0 };
}

// Scratch for prism construction.
const pP = [new Vector3D(0, 0, 0), new Vector3D(0, 0, 0), new Vector3D(0, 0, 0), new Vector3D(0, 0, 0)];
const pView = new Vector3D(0, 0, 0);
const pCentroid = new Vector3D(0, 0, 0);

function setPlane(out: Prism, i: number, nx: number, ny: number, nz: number, d: number): void {
  if (i >= out.nx.length) {
    out.nx.push(0); out.ny.push(0); out.nz.push(0); out.d.push(0);
  }
  out.nx[i] = nx; out.ny[i] = ny; out.nz[i] = nz; out.d[i] = d;
}

/**
 * Builds the convex selection prism for a screen polygon (`pointCount` 2, 3 or
 * 4). `refHeight` is the world height at which polygon vertices are unprojected
 * (any height works — the prism is the same line set extruded along the view
 * direction). `lineThickness` (screen px) gives a 2-point line its width.
 */
export function buildPrism(
  p: ProjectionParams,
  pointsXY: number[],
  pointCount: number,
  refHeight: number,
  lineThickness: number,
  out: Prism,
): boolean {
  viewDirInto(p, pView);
  for (let i = 0; i < pointCount; i++) {
    screenToWorldAtHeight(p, pointsXY[i * 2], pointsXY[i * 2 + 1], refHeight, pP[i]);
  }

  if (pointCount >= 3) {
    // Centroid (in world) to orient side-plane normals inward.
    pCentroid.x = 0; pCentroid.y = 0; pCentroid.z = 0;
    for (let i = 0; i < pointCount; i++) {
      pCentroid.x += pP[i].x; pCentroid.y += pP[i].y; pCentroid.z += pP[i].z;
    }
    pCentroid.x /= pointCount; pCentroid.y /= pointCount; pCentroid.z /= pointCount;

    out.count = 0;
    for (let i = 0; i < pointCount; i++) {
      const a = pP[i];
      const b = pP[(i + 1) % pointCount];
      // n = (b - a) × view
      const ex = b.x - a.x, ey = b.y - a.y, ez = b.z - a.z;
      let nx = ey * pView.z - ez * pView.y;
      let ny = ez * pView.x - ex * pView.z;
      let nz = ex * pView.y - ey * pView.x;
      const len = Math.hypot(nx, ny, nz);
      if (len < EPS) continue; // degenerate edge
      nx /= len; ny /= len; nz /= len;
      let d = nx * a.x + ny * a.y + nz * a.z;
      // Orient so the centroid is inside (n·C ≤ d).
      if (nx * pCentroid.x + ny * pCentroid.y + nz * pCentroid.z > d) {
        nx = -nx; ny = -ny; nz = -nz; d = -d;
      }
      setPlane(out, out.count++, nx, ny, nz, d);
    }
    return out.count >= 3;
  }

  if (pointCount === 2) {
    const a = pP[0];
    const b = pP[1];
    // Wall normal ⟂ to both the screen edge (in world) and the view dir.
    const ex = b.x - a.x, ey = b.y - a.y, ez = b.z - a.z;
    let nx = ey * pView.z - ez * pView.y;
    let ny = ez * pView.x - ex * pView.z;
    let nz = ex * pView.y - ey * pView.x;
    const nlen = Math.hypot(nx, ny, nz);
    if (nlen < EPS) return false;
    nx /= nlen; ny /= nlen; nz /= nlen;
    const elen = Math.hypot(ex, ey, ez);
    if (elen < EPS) return false;
    const ux = ex / elen, uy = ey / elen, uz = ez / elen; // along-segment unit
    const ht = lineThickness / (2 * p.projScale); // world half-thickness (approx)

    const da = nx * a.x + ny * a.y + nz * a.z;
    out.count = 0;
    // Two wall planes (slab of thickness 2·ht around the wall).
    setPlane(out, out.count++, nx, ny, nz, da + ht);
    setPlane(out, out.count++, -nx, -ny, -nz, -da + ht);
    // Two end caps (X between a and b along the segment direction).
    setPlane(out, out.count++, -ux, -uy, -uz, -(ux * a.x + uy * a.y + uz * a.z));
    setPlane(out, out.count++, ux, uy, uz, ux * b.x + uy * b.y + uz * b.z);
    return true;
  }

  return false;
}

export function pointInPrism(prism: Prism, x: number, y: number, z: number): boolean {
  for (let i = 0; i < prism.count; i++) {
    if (prism.nx[i] * x + prism.ny[i] * y + prism.nz[i] * z > prism.d[i] + EPS) {
      return false;
    }
  }
  return true;
}

// ============================================================
// 2D convex tests (sprite screen footprints vs the query shape)
// ============================================================

/** Point inside a convex polygon (CCW or CW); `poly` is flat [x0,y0,x1,y1,...]. */
export function pointInConvex(poly: number[], n: number, px: number, py: number): boolean {
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const ax = poly[i * 2], ay = poly[i * 2 + 1];
    const bx = poly[((i + 1) % n) * 2], by = poly[((i + 1) % n) * 2 + 1];
    const cross = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
    if (cross > EPS) {
      if (sign < 0) return false;
      sign = 1;
    } else if (cross < -EPS) {
      if (sign > 0) return false;
      sign = -1;
    }
  }
  return true;
}

function segSeg(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): boolean {
  const d1x = bx - ax, d1y = by - ay;
  const d2x = dx - cx, d2y = dy - cy;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < EPS) return false; // parallel
  const sx = cx - ax, sy = cy - ay;
  const t = (sx * d2y - sy * d2x) / denom;
  const u = (sx * d1y - sy * d1x) / denom;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

/** Segment vs convex polygon: endpoint inside, or crosses any edge. */
export function segVsConvex(
  ax: number, ay: number, bx: number, by: number,
  poly: number[], n: number,
): boolean {
  if (pointInConvex(poly, n, ax, ay)) return true;
  if (pointInConvex(poly, n, bx, by)) return true;
  for (let i = 0; i < n; i++) {
    const ex = poly[i * 2], ey = poly[i * 2 + 1];
    const fx = poly[((i + 1) % n) * 2], fy = poly[((i + 1) % n) * 2 + 1];
    if (segSeg(ax, ay, bx, by, ex, ey, fx, fy)) return true;
  }
  return false;
}

function projOverlap(
  axisX: number, axisY: number,
  a: number[], na: number, b: number[], nb: number,
): boolean {
  let minA = Infinity, maxA = -Infinity;
  for (let i = 0; i < na; i++) {
    const proj = a[i * 2] * axisX + a[i * 2 + 1] * axisY;
    if (proj < minA) minA = proj;
    if (proj > maxA) maxA = proj;
  }
  let minB = Infinity, maxB = -Infinity;
  for (let i = 0; i < nb; i++) {
    const proj = b[i * 2] * axisX + b[i * 2 + 1] * axisY;
    if (proj < minB) minB = proj;
    if (proj > maxB) maxB = proj;
  }
  return !(maxA < minB - EPS || maxB < minA - EPS);
}

/** Convex-vs-convex overlap (2D SAT). */
export function convexVsConvex(a: number[], na: number, b: number[], nb: number): boolean {
  for (let i = 0; i < na; i++) {
    const ax = a[i * 2], ay = a[i * 2 + 1];
    const bx = a[((i + 1) % na) * 2], by = a[((i + 1) % na) * 2 + 1];
    if (!projOverlap(-(by - ay), bx - ax, a, na, b, nb)) return false;
  }
  for (let i = 0; i < nb; i++) {
    const ax = b[i * 2], ay = b[i * 2 + 1];
    const bx = b[((i + 1) % nb) * 2], by = b[((i + 1) % nb) * 2 + 1];
    if (!projOverlap(-(by - ay), bx - ax, a, na, b, nb)) return false;
  }
  return true;
}
