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
  // The axonometric projection is:
  //   isoX = ISO_H * (wx - wz)        (constant horizontal spread)
  //   isoY = sinA * (wx + wz) - wy
  // Inverting (at constant height):
  //   wx = isoX / (2 * ISO_H) + isoY / (2 * sinA)
  //   wz = -isoX / (2 * ISO_H) + isoY / (2 * sinA)
  const ISO_H = 0.8660254; // cos(30deg) — constant horizontal spread
  const angleRad = (camera.axonometricAngle * Math.PI) / 180;
  const sinA = Math.sin(angleRad);

  if (sinA < 0.01) {
    // Near top-down: vertical pan changes height instead of x/z
    const worldDx = offsetX / (2 * ISO_H);
    const worldDz = -offsetX / (2 * ISO_H);
    transform.position.x += worldDx;
    transform.position.z += worldDz;
    transform.position.y -= offsetY;
  } else {
    const worldDx = offsetX / (2 * ISO_H) + offsetY / (2 * sinA);
    const worldDz = -offsetX / (2 * ISO_H) + offsetY / (2 * sinA);
    transform.position.x += worldDx;
    transform.position.z += worldDz;
  }
}
