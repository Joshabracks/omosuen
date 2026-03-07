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
  // The isometric projection is:
  //   isoX = wx * 0.866 - wz * 0.866
  //   isoY = wx * 0.5   + wz * 0.5
  // Inverting (ignoring height):
  //   wx = isoX / 1.732 + isoY
  //   wz = -isoX / 1.732 + isoY
  const worldDx = offsetX / 1.732 + offsetY;
  const worldDz = -offsetX / 1.732 + offsetY;
  transform.position.x += worldDx;
  transform.position.z += worldDz;
}
