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
  // @ts-expect-error - Proxy methods exist at runtime but TypeScript can't infer them
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

  // Update transform position (camera uses x=iso horizontal, z=iso vertical)
  transform.position.x += offsetX;
  transform.position.z += offsetY;
}
