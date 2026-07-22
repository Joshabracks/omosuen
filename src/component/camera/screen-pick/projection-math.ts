/**
 * Pure axonometric projection math, split out from ray.ts so it has zero
 * component-system imports (no `castTo`/registry pull-in) and can be unit
 * tested standalone via `tsx` (see test/camera-projection.test.ts) without
 * dragging in the shader raw-imports that come with the full component graph.
 *
 * The projection is parallel (orthographic-axonometric), so it is exactly
 * invertible and independent of `pixelScale` (which only changes the internal
 * FBO resolution — the post-process upscales it 1:1 to the viewport). The
 * forward map matches the sprite vertex shader, which draws at full viewport
 * resolution. `orbitYaw` rotates world X/Z around +Y before the diamond
 * projection (yaw 0 = original fixed-azimuth behavior, bit-for-bit):
 *
 *   rx   = wx * cosYaw + wz * sinYaw
 *   rz   = -wx * sinYaw + wz * cosYaw
 *   isoX = ISO_H * (rx - rz)
 *   isoY = sinA  * (rx + rz) - heightScale * wy
 *   px   = (isoX - camIsoX) * zoom + W/2
 *   py   = (isoY - camIsoY) * zoom + H/2
 *
 * Because it is parallel, every screen pixel maps to a world *line* whose
 * direction is constant across the screen (the null space of the projection).
 */

import { Vector3D } from '../../../math';

export const ISO_H = 0.8660254; // cos(30deg) — constant horizontal spread

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
  /** cos/sin of `camera.orbitYaw` (radians). Yaw 0 = cosYaw 1, sinYaw 0 (no rotation). */
  cosYaw: number;
  sinYaw: number;
  camIsoX: number;
  camIsoY: number;
  /** True when sinA < 0.01 (near side-view): height maps to screen-Y, depth is free. */
  degenerate: boolean;
}

/** Axonometric depth (matches the shader): larger = nearer the camera. */
export function rawDepth(
  p: ProjectionParams,
  x: number,
  y: number,
  z: number,
): number {
  const rx = x * p.cosYaw + z * p.sinYaw;
  const rz = -x * p.sinYaw + z * p.cosYaw;
  return rx + p.heightScale * y + rz;
}

/** Projects a world point to viewport-pixel coordinates. */
export function worldToScreen(
  p: ProjectionParams,
  x: number,
  y: number,
  z: number,
  out: { x: number; y: number },
): void {
  const rx = x * p.cosYaw + z * p.sinYaw;
  const rz = -x * p.sinYaw + z * p.cosYaw;
  const isoX = ISO_H * (rx - rz);
  const isoY = p.sinA * (rx + rz) - p.heightScale * y;
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
  const A = (px - p.viewportWidth / 2) / p.projScale + p.camIsoX; // = ISO_H*(rx - rz)
  const B = (py - p.viewportHeight / 2) / p.projScale + p.camIsoY; // = sinA*(rx+rz) - hs*wy

  let rx: number;
  let rz: number;
  if (p.degenerate) {
    // sinA ≈ 0: screen-Y encodes height, depth (rx+rz) is unconstrained → use 0.
    rx = (A / ISO_H) * 0.5;
    rz = (-A / ISO_H) * 0.5;
    out.y = p.heightScale > 0.01 ? -B / p.heightScale : wy;
  } else {
    const sum = (B + p.heightScale * wy) / p.sinA; // rx + rz
    const diff = A / ISO_H; // rx - rz
    rx = 0.5 * (diff + sum);
    rz = 0.5 * (-diff + sum);
    out.y = wy;
  }

  // De-rotate (transpose of the forward yaw rotation) back to world X/Z.
  out.x = rx * p.cosYaw - rz * p.sinYaw;
  out.z = rx * p.sinYaw + rz * p.cosYaw;
}

/**
 * Writes the normalized world-space "into the scene" view direction (away from
 * the camera; marching along it decreases axonometric depth). Constant for all
 * pixels under a parallel projection.
 */
export function viewDirInto(p: ProjectionParams, out: Vector3D): void {
  if (p.degenerate) {
    // Ray travels along constant height, into the screen: -(0.5, 0, 0.5) rotated by yaw.
    const inv = 1 / Math.SQRT2;
    const rx = -inv;
    const rz = -inv;
    out.x = rx * p.cosYaw - rz * p.sinYaw;
    out.y = 0;
    out.z = rx * p.sinYaw + rz * p.cosYaw;
    return;
  }
  // d(point)/d(wy) = (0.5*hs/sinA, 1, 0.5*hs/sinA) increases depth (toward camera) in
  // rotated (rx,rz) space; negate for "into scene", normalize, then de-rotate to world.
  const k = (0.5 * p.heightScale) / p.sinA;
  const len = Math.hypot(k, 1, k);
  const rx = -k / len;
  const rz = -k / len;
  out.x = rx * p.cosYaw - rz * p.sinYaw;
  out.y = -1 / len;
  out.z = rx * p.sinYaw + rz * p.cosYaw;
}
