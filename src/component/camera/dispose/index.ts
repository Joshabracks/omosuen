import { ComponentData } from '../../types';
import { CameraT } from '../data';

/**
 * Disposes WebGL resources when the camera is removed.
 *
 * @param component - The camera component
 */
export function dispose(component: ComponentData): void {
  const camera = component as CameraT;

  // Note: WebGL resources are managed by the WebGL context.
  // When the context is lost or the page unloads, resources are automatically freed.
  // We null out our references to allow garbage collection, but don't need to
  // explicitly call gl.deleteProgram() etc. unless we're dynamically creating/destroying
  // many cameras during runtime (which is unlikely).

  // Clear shader programs
  camera.glResources.cellMapProgram = null;
  camera.glResources.spriteProgram = null;

  // Clear buffers
  camera.glResources.quadVertexBuffer = null;
  camera.glResources.quadUVBuffer = null;
  camera.glResources.cubeVertexBuffer = null;
  camera.glResources.cubeUVBuffer = null;
  camera.glResources.cubeNormalBuffer = null;
  camera.glResources.cubeIndexBuffer = null;

  // Clear textures
  camera.glResources.atlasTextures = [];

  camera._disposed = true;

  console.log(`[camera] Camera '${camera.name}' disposed`);
}
