/**
 * Screen-to-world picking for the axonometric camera.
 *
 * `screenPick` casts a screen-space point / line / triangle / quad into the
 * world and returns the sprites, colliders, event-colliders and non-empty cells
 * it intersects, ordered near→far. A point uses exact tests (cell DDA, ray-vs-
 * OBB/sphere, sprite rect); a line/polygon uses a convex world "prism" (the
 * screen shape extruded along the view direction) as a volume approximation for
 * cells and colliders, and exact 2D overlap for sprites.
 *
 * Designed for per-frame use: the caller supplies a reusable {@link PickBuffer}
 * and the implementation uses module-level scratch, so a steady-state query does
 * not allocate.
 */

import { Vector3D } from '../../../math';
import { NexusT } from '../../nexus';
import { castTo, ComponentData } from '../../types';
import { TransformT } from '../../transform';
import { SpriteT } from '../../sprite/data';
import { ColliderT } from '../../collider/data';
import { CellMapT } from '../../cell-map/data';
import { CellMap } from '../../cell-map';
import { TextureMapT } from '../../texture-map';
import {
  makeColliderOBB,
  computeWorldOBBInto,
  computeWorldSphereInto,
  ColliderOBB,
} from '../../collider/methods';
import { CameraT } from '../data';
import {
  ProjectionParams,
  resolveProjection,
  worldToScreen,
  screenToWorldAtHeight,
  viewDirInto,
  rawDepth,
} from './ray';
import {
  rayOBB,
  raySphere,
  rayAABB,
  Span,
  marchCells,
  makeCellMarch,
  CellMarch,
  buildPrism,
  makePrism,
  Prism,
  pointInPrism,
  pointInConvex,
  segVsConvex,
  convexVsConvex,
} from './intersect';
import { PickBuffer, PickKind } from './buffer';

export { PickBuffer, PickKind, createPickBuffer } from './buffer';
export type { PickHit, PickKindValue } from './buffer';
export { screenToWorldRay } from './ray';

/** Which entity kinds a query considers (all default true). */
export interface PickTargets {
  sprites?: boolean;
  colliders?: boolean;
  eventColliders?: boolean;
  cells?: boolean;
}

export interface PickOptions {
  /** 'all' (default) fills every hit near→far; 'first' keeps only the front-most. */
  mode?: 'first' | 'all';
  /** Restrict which entity kinds are tested (default: all). */
  types?: PickTargets;
  /** Width (screen px) given to a 2-point line query. Default 6. */
  lineThickness?: number;
}

// ============================================================
// Module scratch (synchronous, non-reentrant)
// ============================================================

const params: ProjectionParams = {
  viewportWidth: 0, viewportHeight: 0, zoom: 1, projScale: 1,
  sinA: 0.5, heightScale: 1, camIsoX: 0, camIsoY: 0, degenerate: false,
};
const rayOrigin = new Vector3D(0, 0, 0);
const rayDir = new Vector3D(0, 0, 0);
const cellMarch: CellMarch = makeCellMarch();
const prism: Prism = makePrism();
const obbScratch: ColliderOBB = makeColliderOBB();
const sphereCenter = new Vector3D(0, 0, 0);
const screenScratch = { x: 0, y: 0 };
const spriteQuad: number[] = [0, 0, 0, 0, 0, 0, 0, 0];
const frameSize = { x: 0, y: 0 };
const aabbSpan: Span = { tEnter: 0, tExit: 0 };
const tmpO = new Vector3D(0, 0, 0);
const tmpD = new Vector3D(0, 0, 0);
const tmpPt = new Vector3D(0, 0, 0);

// Self-healing per-camera texture-map lookup (rebuilt only on a cache miss).
const spriteTmCache = new Map<number, Map<string, TextureMapT>>();

const DEFAULT_TARGETS: Required<PickTargets> = {
  sprites: true, colliders: true, eventColliders: true, cells: true,
};

// ============================================================
// Helpers
// ============================================================

function siblingTransform(component: ComponentData): TransformT | null {
  if (!component.parent || component.parent.type !== 'nexus') return null;
  return castTo<NexusT>(component.parent).getComponentByType(
    'transform',
    false,
  ) as TransformT | null;
}

function frameSizeFor(
  camera: CameraT,
  sceneRoot: NexusT,
  sprite: SpriteT,
  out: { x: number; y: number },
): boolean {
  let map = spriteTmCache.get(camera.id!);
  let tm = map ? map.get(sprite.textureMapKeys.albedo) : undefined;
  if (!tm) {
    map = new Map<string, TextureMapT>();
    const tms = sceneRoot.getComponentsByType('texture-map', true) as TextureMapT[];
    for (const t of tms) map.set(t.textureMapKey, t);
    spriteTmCache.set(camera.id!, map);
    tm = map.get(sprite.textureMapKeys.albedo);
    if (!tm) return false;
  }
  const frame = tm.frameIndexMap.get(sprite.frame.albedo);
  if (!frame) return false;
  out.x = frame.size.x;
  out.y = frame.size.y;
  return true;
}

/** Builds a sprite's rotated screen-space rectangle into `outQuad` (8 numbers). */
function spriteScreenQuad(
  p: ProjectionParams,
  t: TransformT,
  frameW: number,
  frameH: number,
  anchorX: number,
  anchorY: number,
  outQuad: number[],
): void {
  worldToScreen(p, t.position.x, t.position.y, t.position.z, screenScratch);
  const sizePxX = frameW * t.scale.x * p.zoom;
  const sizePxY = frameH * t.scale.y * p.zoom;
  const anX = frameW !== 0 ? anchorX / frameW : 0.5;
  const anY = frameH !== 0 ? anchorY / frameH : 0.5;
  const c = Math.cos(t.rotation.y);
  const s = Math.sin(t.rotation.y);
  // Centered unit-quad corners, re-based around the normalized anchor.
  for (let i = 0; i < 4; i++) {
    const cornerX = i === 1 || i === 2 ? 0.5 : -0.5;
    const cornerY = i >= 2 ? 0.5 : -0.5;
    const lx = cornerX - (anX - 0.5);
    const ly = cornerY - (anY - 0.5);
    const rx = lx * c - ly * s;
    const ry = lx * s + ly * c;
    outQuad[i * 2] = screenScratch.x + rx * sizePxX;
    outQuad[i * 2 + 1] = screenScratch.y + ry * sizePxY;
  }
}

function addHit(
  buffer: PickBuffer,
  kind: typeof PickKind[keyof typeof PickKind],
  component: ComponentData | null,
  cellMap: CellMapT | null,
  cx: number, cy: number, cz: number,
  wx: number, wy: number, wz: number,
  depth: number,
): void {
  const hit = buffer.push();
  hit.kind = kind;
  hit.component = component;
  hit.cellMap = cellMap;
  hit.cellX = cx; hit.cellY = cy; hit.cellZ = cz;
  hit.worldPoint.x = wx; hit.worldPoint.y = wy; hit.worldPoint.z = wz;
  hit.depth = depth;
}

// ============================================================
// Point query
// ============================================================

function pickPointColliders(
  p: ProjectionParams,
  components: ComponentData[],
  kind: typeof PickKind[keyof typeof PickKind],
  buffer: PickBuffer,
): void {
  for (const c of components) {
    const col = c as unknown as ColliderT; // shares shape/size/radius/offset
    let t: number;
    if (col.shape === 'sphere') {
      const r = computeWorldSphereInto(col, sphereCenter);
      t = raySphere(
        rayOrigin.x, rayOrigin.y, rayOrigin.z,
        rayDir.x, rayDir.y, rayDir.z,
        sphereCenter.x, sphereCenter.y, sphereCenter.z, r,
      );
    } else {
      computeWorldOBBInto(col, obbScratch);
      t = rayOBB(
        rayOrigin.x, rayOrigin.y, rayOrigin.z,
        rayDir.x, rayDir.y, rayDir.z,
        obbScratch,
      );
    }
    if (Number.isNaN(t)) continue;
    const wx = rayOrigin.x + rayDir.x * t;
    const wy = rayOrigin.y + rayDir.y * t;
    const wz = rayOrigin.z + rayDir.z * t;
    addHit(buffer, kind, c, null, -1, -1, -1, wx, wy, wz, rawDepth(p, wx, wy, wz));
  }
}

// ============================================================
// Area / line query (prism volume)
// ============================================================

function pickPrismColliders(
  p: ProjectionParams,
  components: ComponentData[],
  kind: typeof PickKind[keyof typeof PickKind],
  buffer: PickBuffer,
): void {
  for (const c of components) {
    const col = c as unknown as ColliderT;
    let cxw: number, cyw: number, czw: number;
    if (col.shape === 'sphere') {
      computeWorldSphereInto(col, sphereCenter);
      cxw = sphereCenter.x; cyw = sphereCenter.y; czw = sphereCenter.z;
    } else {
      computeWorldOBBInto(col, obbScratch);
      cxw = obbScratch.center.x; cyw = obbScratch.center.y; czw = obbScratch.center.z;
    }
    if (pointInPrism(prism, cxw, cyw, czw)) {
      addHit(buffer, kind, c, null, -1, -1, -1, cxw, cyw, czw, rawDepth(p, cxw, cyw, czw));
    }
  }
}

/** Iterates solid cells in the prism's world-AABB and keeps those inside it. */
function pickPrismCells(
  p: ProjectionParams,
  pointsXY: number[],
  pointCount: number,
  cellMap: CellMapT,
  lineThickness: number,
  buffer: PickBuffer,
): void {
  const cs = cellMap.cellSize;
  const ms = cellMap.mapSize;
  const maxx = ms.x * cs.x, maxy = ms.y * cs.y, maxz = ms.z * cs.z;

  // Broad-phase world AABB = union of each vertex-ray's clip span through the map.
  // Each corner ray spans the map's full Y, so when ALL corner rays pass through the
  // map AABB their entry/exit points bound the prism∩map region tightly. If any
  // corner ray misses (e.g. a selection box larger than / off the map, whose corners
  // project outside it), that tight bound would wrongly exclude the interior — so we
  // fall back to the full map cell range, always a valid superset.
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  viewDirInto(p, tmpD);
  let hitCount = 0;
  for (let i = 0; i < pointCount; i++) {
    screenToWorldAtHeight(p, pointsXY[i * 2], pointsXY[i * 2 + 1], 0, tmpO);
    if (!rayAABB(tmpO.x, tmpO.y, tmpO.z, tmpD.x, tmpD.y, tmpD.z, 0, 0, 0, maxx, maxy, maxz, aabbSpan)) {
      continue;
    }
    hitCount++;
    for (let e = 0; e < 2; e++) {
      const t = e === 0 ? aabbSpan.tEnter : aabbSpan.tExit;
      const px = tmpO.x + tmpD.x * t;
      const py = tmpO.y + tmpD.y * t;
      const pz = tmpO.z + tmpD.z * t;
      if (px < minX) minX = px; if (px > maxX) maxX = px;
      if (py < minY) minY = py; if (py > maxY) maxY = py;
      if (pz < minZ) minZ = pz; if (pz > maxZ) maxZ = pz;
    }
  }

  let x0: number, y0: number, z0: number, x1: number, y1: number, z1: number;
  if (hitCount < pointCount) {
    // Some/all corners miss the map → scan the whole grid (prism filters below).
    x0 = 0; y0 = 0; z0 = 0;
    x1 = ms.x - 1; y1 = ms.y - 1; z1 = ms.z - 1;
  } else {
    // Pad by line thickness + one cell, then clamp to the grid.
    const pad = lineThickness / p.projScale + Math.max(cs.x, cs.y, cs.z);
    x0 = Math.floor((minX - pad) / cs.x); if (x0 < 0) x0 = 0;
    y0 = Math.floor((minY - pad) / cs.y); if (y0 < 0) y0 = 0;
    z0 = Math.floor((minZ - pad) / cs.z); if (z0 < 0) z0 = 0;
    x1 = Math.floor((maxX + pad) / cs.x); if (x1 >= ms.x) x1 = ms.x - 1;
    y1 = Math.floor((maxY + pad) / cs.y); if (y1 >= ms.y) y1 = ms.y - 1;
    z1 = Math.floor((maxZ + pad) / cs.z); if (z1 >= ms.z) z1 = ms.z - 1;
  }

  for (let cx = x0; cx <= x1; cx++) {
    const wx = (cx + 0.5) * cs.x;
    for (let cz = z0; cz <= z1; cz++) {
      const wz = (cz + 0.5) * cs.z;
      for (let cy = y0; cy <= y1; cy++) {
        const wy = (cy + 0.5) * cs.y;
        if (!pointInPrism(prism, wx, wy, wz)) continue;
        tmpPt.x = cx; tmpPt.y = cy; tmpPt.z = cz;
        const cell = CellMap.getCellData(cellMap, tmpPt);
        if (!cell.visible || cell.shapeIndex === 0) continue;
        addHit(buffer, PickKind.Cell, null, cellMap, cx, cy, cz, wx, wy, wz, rawDepth(p, wx, wy, wz));
      }
    }
  }
}

// ============================================================
// Public entry
// ============================================================

/**
 * Casts a screen shape into the world and fills `out` with intersected entities
 * (near→far). `pointsXY` is a flat `[x0,y0, x1,y1, ...]` of viewport-pixel
 * coordinates; `pointCount` is 1 (point), 2 (line), 3 (triangle) or 4 (quad).
 * Returns the number of hits.
 */
export function screenPick(
  camera: CameraT,
  pointsXY: number[],
  pointCount: number,
  out: PickBuffer,
  options?: PickOptions,
): number {
  out.reset();
  if (pointCount < 1 || pointCount > 4) return 0;
  if (!resolveProjection(camera, params)) return 0;

  const mode = options?.mode ?? 'all';
  const stopAtFirst = mode === 'first';
  const targets = options?.types ?? DEFAULT_TARGETS;
  const wantSprites = targets.sprites ?? true;
  const wantColliders = targets.colliders ?? true;
  const wantEvent = targets.eventColliders ?? true;
  const wantCells = targets.cells ?? true;
  const lineThickness = options?.lineThickness ?? 6;

  if (!camera.parent || camera.parent.type !== 'nexus') return 0;
  const sceneRoot = castTo<NexusT>(castTo<NexusT>(camera.parent).parent!);

  if (pointCount === 1) {
    // ---- Point: exact ray ----
    const px = pointsXY[0];
    const py = pointsXY[1];
    screenToWorldAtHeight(params, px, py, 0, rayOrigin);
    viewDirInto(params, rayDir);

    if (wantCells) {
      const cellMaps = sceneRoot.getComponentsByType('cell-map', true) as CellMapT[];
      for (const cm of cellMaps) {
        marchCells(rayOrigin, rayDir, cm, cellMarch, stopAtFirst);
        for (let i = 0; i < cellMarch.count; i++) {
          const cx = cellMarch.x[i], cy = cellMarch.y[i], cz = cellMarch.z[i];
          const wx = (cx + 0.5) * cm.cellSize.x;
          const wy = (cy + 0.5) * cm.cellSize.y;
          const wz = (cz + 0.5) * cm.cellSize.z;
          addHit(out, PickKind.Cell, null, cm, cx, cy, cz, wx, wy, wz, rawDepth(params, wx, wy, wz));
        }
      }
    }
    if (wantColliders) {
      pickPointColliders(params, sceneRoot.getComponentsByType('collider', true), PickKind.Collider, out);
    }
    if (wantEvent) {
      pickPointColliders(params, sceneRoot.getComponentsByType('event-collider', true), PickKind.EventCollider, out);
    }
    if (wantSprites) {
      const sprites = sceneRoot.getComponentsByType('sprite', true) as SpriteT[];
      for (const sprite of sprites) {
        if (sprite.visible === false) continue;
        const t = siblingTransform(sprite);
        if (!t) continue;
        if (!frameSizeFor(camera, sceneRoot, sprite, frameSize)) continue;
        spriteScreenQuad(params, t, frameSize.x, frameSize.y, sprite.anchor.x, sprite.anchor.y, spriteQuad);
        if (pointInConvex(spriteQuad, 4, px, py)) {
          const pos = t.position;
          addHit(out, PickKind.Sprite, sprite, null, -1, -1, -1, pos.x, pos.y, pos.z, rawDepth(params, pos.x, pos.y, pos.z) + 1);
        }
      }
    }
  } else {
    // ---- Line / triangle / quad: prism volume + 2D sprite overlap ----
    if (!buildPrism(params, pointsXY, pointCount, 0, lineThickness, prism)) return 0;

    if (wantCells) {
      const cellMaps = sceneRoot.getComponentsByType('cell-map', true) as CellMapT[];
      for (const cm of cellMaps) {
        pickPrismCells(params, pointsXY, pointCount, cm, lineThickness, out);
      }
    }
    if (wantColliders) {
      pickPrismColliders(params, sceneRoot.getComponentsByType('collider', true), PickKind.Collider, out);
    }
    if (wantEvent) {
      pickPrismColliders(params, sceneRoot.getComponentsByType('event-collider', true), PickKind.EventCollider, out);
    }
    if (wantSprites) {
      const sprites = sceneRoot.getComponentsByType('sprite', true) as SpriteT[];
      for (const sprite of sprites) {
        if (sprite.visible === false) continue;
        const t = siblingTransform(sprite);
        if (!t) continue;
        if (!frameSizeFor(camera, sceneRoot, sprite, frameSize)) continue;
        spriteScreenQuad(params, t, frameSize.x, frameSize.y, sprite.anchor.x, sprite.anchor.y, spriteQuad);
        const overlaps = pointCount === 2
          ? segVsConvex(pointsXY[0], pointsXY[1], pointsXY[2], pointsXY[3], spriteQuad, 4)
          : convexVsConvex(pointsXY, pointCount, spriteQuad, 4);
        if (overlaps) {
          const pos = t.position;
          addHit(out, PickKind.Sprite, sprite, null, -1, -1, -1, pos.x, pos.y, pos.z, rawDepth(params, pos.x, pos.y, pos.z) + 1);
        }
      }
    }
  }

  // Sort near→far (descending depth) in place, then trim for 'first'.
  const hits = out.hits;
  for (let i = 1; i < out.count; i++) {
    const h = hits[i];
    const d = h.depth;
    let j = i - 1;
    while (j >= 0 && hits[j].depth < d) {
      hits[j + 1] = hits[j];
      j--;
    }
    hits[j + 1] = h;
  }
  if (stopAtFirst && out.count > 1) out.count = 1;
  return out.count;
}
