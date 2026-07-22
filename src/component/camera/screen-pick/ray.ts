/**
 * Screen ↔ world projection for the axonometric camera, and the screen→world
 * ray used by the pick system. The pure projection math (no component-system
 * imports) lives in ./projection-math and is re-exported here; this module
 * adds the camera/nexus/viewport resolution on top.
 */

import { NexusT } from '../../nexus';
import { TransformT } from '../../transform';
import { ViewportT } from '../../viewport';
import { castTo } from '../../types';
import { Vector3D } from '../../../math';
import { CameraT } from '../data';
import {
  ISO_H,
  ProjectionParams,
  screenToWorldAtHeight,
  viewDirInto,
} from './projection-math';

export type { ProjectionParams } from './projection-math';
export {
  rawDepth,
  worldToScreen,
  screenToWorldAtHeight,
  viewDirInto,
} from './projection-math';

/**
 * Resolves the camera's sibling transform and referenced viewport, filling
 * `out` with the current projection parameters. Returns false if the camera is
 * not yet wired into a scene with a viewport.
 */
export function resolveProjection(
  camera: CameraT,
  out: ProjectionParams,
): boolean {
  if (!camera.parent || camera.parent.type !== 'nexus') return false;
  const parentNexus = castTo<NexusT>(camera.parent);
  const transform = parentNexus.getComponentByType(
    'transform',
    false,
  ) as TransformT | null;
  if (!transform) return false;

  const sceneRoot = castTo<NexusT>(parentNexus.parent!);
  const viewport = sceneRoot.getComponentByName(
    camera.viewportRef,
    true,
  ) as ViewportT | null;
  if (!viewport) return false;

  const clampedAngle = Math.max(0, Math.min(90, camera.axonometricAngle));
  const angleRad = (clampedAngle * Math.PI) / 180;
  const sinA = Math.sin(angleRad);
  const heightScale = Math.cos(angleRad) * 1.1547005; // cos(a)/cos(30deg)
  const yawRad = (camera.orbitYaw * Math.PI) / 180;
  const cosYaw = Math.cos(yawRad);
  const sinYaw = Math.sin(yawRad);

  // Camera cached WORLD position (composed up the ancestry) — matches render().
  const p = transform.worldPosition;
  const rx = p.x * cosYaw + p.z * sinYaw;
  const rz = -p.x * sinYaw + p.z * cosYaw;
  out.viewportWidth = viewport.width;
  out.viewportHeight = viewport.height;
  out.zoom = camera.zoom;
  out.projScale = camera.zoom * camera.zoom;
  out.sinA = sinA;
  out.heightScale = heightScale;
  out.cosYaw = cosYaw;
  out.sinYaw = sinYaw;
  out.camIsoX = rx * ISO_H - rz * ISO_H;
  out.camIsoY = rx * sinA - p.y * heightScale + rz * sinA;
  out.degenerate = sinA < 0.01;
  return true;
}

/**
 * Computes the world-space pick ray for a viewport pixel: a representative
 * point on the line (`outOrigin`) and the normalized into-scene direction
 * (`outDir`). The ray is an infinite line — `t` may be negative (the camera
 * side). Returns false if the camera/viewport can't be resolved.
 *
 * `_scratchParams` lets callers avoid re-resolving when they already have params.
 */
const sharedParams: ProjectionParams = {
  viewportWidth: 0,
  viewportHeight: 0,
  zoom: 1,
  projScale: 1,
  sinA: 0.5,
  heightScale: 1,
  cosYaw: 1,
  sinYaw: 0,
  camIsoX: 0,
  camIsoY: 0,
  degenerate: false,
};

export function screenToWorldRayInto(
  p: ProjectionParams,
  px: number,
  py: number,
  outOrigin: Vector3D,
  outDir: Vector3D,
): void {
  // Representative point on the line at height 0 (degenerate: at depth 0).
  screenToWorldAtHeight(p, px, py, 0, outOrigin);
  viewDirInto(p, outDir);
}

export function screenToWorldRay(
  camera: CameraT,
  px: number,
  py: number,
  outOrigin: Vector3D,
  outDir: Vector3D,
): boolean {
  if (!resolveProjection(camera, sharedParams)) return false;
  screenToWorldRayInto(sharedParams, px, py, outOrigin, outDir);
  return true;
}
