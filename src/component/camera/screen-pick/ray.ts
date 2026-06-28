/**
 * Screen ↔ world projection for the axonometric camera, and the screen→world
 * ray used by the pick system.
 *
 * The projection is parallel (orthographic-axonometric), so it is exactly
 * invertible and independent of `pixelScale` (which only changes the internal
 * FBO resolution — the post-process upscales it 1:1 to the viewport). The
 * forward map matches the sprite vertex shader, which draws at full viewport
 * resolution:
 *
 *   isoX = ISO_H * (wx - wz)
 *   isoY = sinA  * (wx + wz) - heightScale * wy
 *   px   = (isoX - camIsoX) * zoom + W/2
 *   py   = (isoY - camIsoY) * zoom + H/2
 *
 * Because it is parallel, every screen pixel maps to a world *line* whose
 * direction is constant across the screen (the null space of the projection).
 */

import { NexusT } from '../../nexus';
import { TransformT } from '../../transform';
import { ViewportT } from '../../viewport';
import { castTo } from '../../types';
import { Vector3D } from '../../../math';
import { CameraT } from '../data';

const ISO_H = 0.8660254; // cos(30deg) — constant horizontal spread

/** Resolved per-camera projection parameters (reused; not reentrant). */
export interface ProjectionParams {
  viewportWidth: number;
  viewportHeight: number;
  zoom: number;
  /**
   * Screen pixels per world iso-unit. The render passes set
   * `u_viewportSize = viewport / zoom` while `gl.viewport = viewport`, so a world
   * iso-unit lands at `zoom²` px on the final screen — NOT `zoom`.
   */
  projScale: number;
  sinA: number;
  heightScale: number;
  camIsoX: number;
  camIsoY: number;
  /** True when sinA < 0.01 (near side-view): height maps to screen-Y, depth is free. */
  degenerate: boolean;
}

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

  // Camera cached WORLD position (composed up the ancestry) — matches render().
  const p = transform.worldPosition;
  out.viewportWidth = viewport.width;
  out.viewportHeight = viewport.height;
  out.zoom = camera.zoom;
  out.projScale = camera.zoom * camera.zoom;
  out.sinA = sinA;
  out.heightScale = heightScale;
  out.camIsoX = p.x * ISO_H - p.z * ISO_H;
  out.camIsoY = p.x * sinA - p.y * heightScale + p.z * sinA;
  out.degenerate = sinA < 0.01;
  return true;
}

/** Axonometric depth (matches the shader): larger = nearer the camera. */
export function rawDepth(p: ProjectionParams, x: number, y: number, z: number): number {
  return x + p.heightScale * y + z;
}

/** Projects a world point to viewport-pixel coordinates. */
export function worldToScreen(
  p: ProjectionParams,
  x: number,
  y: number,
  z: number,
  out: { x: number; y: number },
): void {
  const isoX = ISO_H * (x - z);
  const isoY = p.sinA * (x + z) - p.heightScale * y;
  out.x = (isoX - p.camIsoX) * p.projScale + p.viewportWidth / 2;
  out.y = (isoY - p.camIsoY) * p.projScale + p.viewportHeight / 2;
}

/**
 * Inverse-projects a screen pixel to the world point at a given height `wy`.
 * (The pixel maps to a world line; this picks the point on it at height `wy`.)
 */
export function screenToWorldAtHeight(
  p: ProjectionParams,
  px: number,
  py: number,
  wy: number,
  out: Vector3D,
): void {
  const A = (px - p.viewportWidth / 2) / p.projScale + p.camIsoX; // = ISO_H*(wx - wz)
  const B = (py - p.viewportHeight / 2) / p.projScale + p.camIsoY; // = sinA*(wx+wz) - hs*wy

  if (p.degenerate) {
    // sinA ≈ 0: screen-Y encodes height, depth (wx+wz) is unconstrained → use 0.
    out.x = (A / ISO_H) * 0.5;
    out.z = (-A / ISO_H) * 0.5;
    out.y = p.heightScale > 0.01 ? -B / p.heightScale : wy;
    return;
  }

  const sum = (B + p.heightScale * wy) / p.sinA; // wx + wz
  const diff = A / ISO_H; // wx - wz
  out.x = 0.5 * (diff + sum);
  out.y = wy;
  out.z = 0.5 * (-diff + sum);
}

/**
 * Writes the normalized world-space "into the scene" view direction (away from
 * the camera; marching along it decreases axonometric depth). Constant for all
 * pixels under a parallel projection.
 */
export function viewDirInto(p: ProjectionParams, out: Vector3D): void {
  if (p.degenerate) {
    // Ray travels along constant height, into the screen: -(0.5, 0, 0.5).
    const inv = 1 / Math.SQRT2;
    out.x = -inv;
    out.y = 0;
    out.z = -inv;
    return;
  }
  // d(point)/d(wy) = (0.5*hs/sinA, 1, 0.5*hs/sinA) increases depth (toward camera);
  // negate for "into scene", then normalize.
  const k = (0.5 * p.heightScale) / p.sinA;
  const len = Math.hypot(k, 1, k);
  out.x = -k / len;
  out.y = -1 / len;
  out.z = -k / len;
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
