import { NexusT } from '../../nexus';
import { TransformT } from '../../transform';
import { castTo } from '../../types';
import { CameraT } from '../data';

/**
 * Pans the camera by updating the sibling transform's position.
 *
 * @param camera - The camera component
 * @param offsetX - X offset to pan by
 * @param offsetY - Y offset to pan by
 */
export function pan(camera: CameraT, offsetX: number, offsetY: number): void {
  if (!camera.parent || camera.parent.type !== 'nexus') {
    console.warn(
      `[camera] Camera '${camera.name}' has no parent nexus, cannot pan`,
    );
    return;
  }

  const parentNexus = castTo<NexusT>(camera.parent!);
  const transform = parentNexus.getComponentByType(
    'transform',
    false,
  ) as TransformT | null;

  if (!transform) {
    console.warn(
      `[camera] Camera '${camera.name}' has no sibling transform component, cannot pan`,
    );
    return;
  }

  // Inverse-project screen-space offsets to world-space.
  // The axonometric projection (matches screen-pick/ray.ts) is:
  //   rx = wx*cosYaw + wz*sinYaw, rz = -wx*sinYaw + wz*cosYaw   (orbit yaw)
  //   isoX = ISO_H * (rx - rz)                    (constant horizontal spread)
  //   isoY = sinA * (rx + rz) - heightScale * wy
  // Inverting (at constant height) gives rotated-space deltas, then de-rotate
  // (transpose of the forward rotation) back to world X/Z:
  //   rDx = isoX / (2 * ISO_H) + isoY / (2 * sinA)
  //   rDz = -isoX / (2 * ISO_H) + isoY / (2 * sinA)
  //   wDx = rDx*cosYaw - rDz*sinYaw, wDz = rDx*sinYaw + rDz*cosYaw
  const ISO_H = 0.8660254; // cos(30deg) — constant horizontal spread
  const clampedAngle = Math.max(0, Math.min(90, camera.axonometricAngle));
  const angleRad = (clampedAngle * Math.PI) / 180;
  const sinA = Math.sin(angleRad);
  const heightScale = Math.cos(angleRad) * 1.1547005; // cos(a)/cos(30deg)
  const yawRad = (camera.orbitYaw * Math.PI) / 180;
  const cosYaw = Math.cos(yawRad);
  const sinYaw = Math.sin(yawRad);

  let rDx: number;
  let rDz: number;
  if (sinA < 0.01) {
    // Near top-down: vertical pan changes height instead of x/z
    rDx = offsetX / (2 * ISO_H);
    rDz = -offsetX / (2 * ISO_H);
    if (heightScale > 0.01) {
      transform.position.y -= offsetY / heightScale;
    }
  } else {
    rDx = offsetX / (2 * ISO_H) + offsetY / (2 * sinA);
    rDz = -offsetX / (2 * ISO_H) + offsetY / (2 * sinA);
  }
  transform.position.x += rDx * cosYaw - rDz * sinYaw;
  transform.position.z += rDx * sinYaw + rDz * cosYaw;
}
