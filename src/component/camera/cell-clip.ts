// Cutaway plane maths, shared by every consumer that has to agree about which
// cells are hidden: the chunk-level draw reject, the fragment shader (via a
// uniform), and screen-picking/raycasting.
//
// They MUST answer from the same numbers. Fog-of-war learned this the hard way
// — see the note in `unified.frag` about the sprite phantom discard being
// anchored on a uniform rather than a per-fragment value, because a CPU sweep
// and a GPU test that disagree produce half-erased geometry.

import type { CameraT, CellClip } from './data';

const DEG = Math.PI / 180;

/**
 * `cos(30°)` reciprocal, matching `unified.vert`'s `heightScale`:
 * `cos(angle) * 1.1547005`. Duplicated rather than imported because the vertex
 * shader is a raw string — if one changes, change both.
 */
const HEIGHT_SCALE_K = 1.1547005;

/**
 * A half-space, as `dot(point, xyz) > w` ⇒ the point is between the camera and
 * the target, and therefore hidden.
 */
export interface ClipPlane {
  x: number;
  y: number;
  z: number;
  /** Threshold along the axis. */
  w: number;
}

/**
 * The camera-ward axis: the direction along which a point gets *closer* to the
 * camera.
 *
 * This is not an approximation of the projection — it is read straight out of
 * it. `unified.vert` computes
 *
 *   rawDepth = (x·cosYaw + z·sinYaw) + heightScale·y + (−x·sinYaw + z·cosYaw)
 *
 * with higher meaning nearer, so collecting terms per component gives exactly
 * the vector below. Using anything else here would put the cut at a different
 * place than the depth buffer thinks it is.
 */
export function viewAxis(
  orbitYaw: number,
  axonometricAngle: number,
): { x: number; y: number; z: number } {
  const cosYaw = Math.cos(orbitYaw * DEG);
  const sinYaw = Math.sin(orbitYaw * DEG);
  const clamped = Math.max(0, Math.min(90, axonometricAngle));
  const heightScale = Math.cos(clamped * DEG) * HEIGHT_SCALE_K;
  return {
    x: cosYaw - sinYaw,
    y: heightScale,
    z: sinYaw + cosYaw,
  };
}

/**
 * Resolves a camera's cutaway config into the half-space to hide, or null when
 * the feature is off (absent config, zero weight, or a mode this does not
 * describe geometrically).
 *
 * `volume` mode returns null here on purpose: its target is a per-cell set, not
 * a plane, so it has no half-space form and is evaluated separately.
 */
export function resolveClipPlane(camera: CameraT): ClipPlane | null {
  const clip: CellClip | null = camera.cellClip;
  if (!clip || clip.weight <= 0) return null;
  if (clip.mode !== 'slab') return null;

  const axis =
    clip.space === 'view'
      ? viewAxis(camera.orbitYaw, camera.axonometricAngle)
      : clip.slab.axis;

  // Normalising keeps `distance` in world units for the world-space case. The
  // view axis is deliberately NOT normalised the same way — its magnitude is
  // part of the depth formula above, so a view-space distance is in the depth
  // buffer's own units, which is what makes "the plane sits at the player's
  // depth" expressible without the caller redoing the projection.
  if (clip.space === 'world') {
    const len = Math.hypot(axis.x, axis.y, axis.z);
    if (len === 0) return null;
    return {
      x: axis.x / len,
      y: axis.y / len,
      z: axis.z / len,
      w: clip.slab.distance,
    };
  }

  return { x: axis.x, y: axis.y, z: axis.z, w: clip.slab.distance };
}

/** True when this world point lies between the camera and the target. */
export function isPointClipped(
  plane: ClipPlane,
  x: number,
  y: number,
  z: number,
): boolean {
  return x * plane.x + y * plane.y + z * plane.z > plane.w;
}

/**
 * True when EVERY corner of the box is clipped, so the whole box can be
 * skipped.
 *
 * Conservative by construction: it finds the box corner with the smallest
 * projection (the "least clipped" one) by picking min or max per axis according
 * to that component's sign, and requires even that corner to be past the plane.
 *
 * `dilate` widens the box before testing. Pass ~1 cell when the map has
 * `smoothing > 0`: the Laplacian mesher displaces vertices off the cell lattice,
 * so a chunk's geometry can extend slightly beyond its nominal bounds, and a
 * tight test would drop a chunk whose smoothed vertices still cross the cut —
 * showing as a seam.
 */
export function aabbFullyClipped(
  plane: ClipPlane,
  min: { x: number; y: number; z: number },
  max: { x: number; y: number; z: number },
  dilate: number,
): boolean {
  const minX = min.x - dilate;
  const minY = min.y - dilate;
  const minZ = min.z - dilate;
  const maxX = max.x + dilate;
  const maxY = max.y + dilate;
  const maxZ = max.z + dilate;

  const least =
    (plane.x >= 0 ? minX : maxX) * plane.x +
    (plane.y >= 0 ? minY : maxY) * plane.y +
    (plane.z >= 0 ? minZ : maxZ) * plane.z;

  return least > plane.w;
}
