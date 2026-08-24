import { NexusT } from '../../nexus';
import { ComponentData, castTo } from '../../types';
import { ViewportT } from '../../viewport';
import { CameraT } from '../data';
import { clearLightUniformCache } from '../render/light-uniforms';
import { clearRenderablesCache } from '../collect-renderables/index';

/**
 * Disposes WebGL resources when the camera is removed.
 * Explicitly deletes all GPU resources to prevent memory leaks.
 *
 * @param component - The camera component
 */
export function dispose(component: ComponentData): void {
  const camera = component as CameraT;
  const res = camera.glResources;

  // Obtain the GL context via the same cached viewport lookup used elsewhere
  let gl: WebGL2RenderingContext | null = null;
  if (camera.parent && camera.parent.type === 'nexus') {
    const parentNexus = castTo<NexusT>(camera.parent!);
    if (parentNexus.parent) {
      const sceneRoot = castTo<NexusT>(parentNexus.parent!);
      const viewport = sceneRoot.getComponentByTypeAndName(
        'viewport',
        camera.viewportRef,
        true,
      ) as ViewportT | null;
      gl = viewport?.gl ?? null;
    }
  }

  // Delete GPU resources if GL context is available
  if (gl) {
    if (res.unifiedProgram) gl.deleteProgram(res.unifiedProgram);
    if (res.postProcessProgram) gl.deleteProgram(res.postProcessProgram);
    if (res.quadVertexBuffer) gl.deleteBuffer(res.quadVertexBuffer);
    if (res.quadUVBuffer) gl.deleteBuffer(res.quadUVBuffer);
    if (res.fullscreenQuadBuffer) gl.deleteBuffer(res.fullscreenQuadBuffer);
    if (res.framebuffer) gl.deleteFramebuffer(res.framebuffer);
    if (res.renderTexture) gl.deleteTexture(res.renderTexture);
    if (res.depthTexture) gl.deleteTexture(res.depthTexture);
    for (const tex of res.atlasTextures) {
      if (tex) gl.deleteTexture(tex);
    }
  }

  // Null all references for GC
  res.unifiedProgram = null;
  res.renderModeLocation = null;
  res.postProcessProgram = null;
  res.quadVertexBuffer = null;
  res.quadUVBuffer = null;
  res.fullscreenQuadBuffer = null;
  res.framebuffer = null;
  res.renderTexture = null;
  res.depthTexture = null;
  res.atlasTextures = [];

  // Clear module-level caches for this camera
  clearLightUniformCache(camera.id!);
  clearRenderablesCache(camera.id!);

  camera._disposed = true;
}
