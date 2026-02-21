import { NexusT } from '../../nexus';
import { TransformT } from '../../transform';
import { getProxiedComponent } from '../../types';
import { ViewportT } from '../../viewport';
import { CameraT } from '../data';

/**
 * Sets the camera zoom level and updates framebuffer resolution.
 * If camera.zoomTarget is set, adjusts the camera position so the world point
 * under that screen coordinate stays fixed during the zoom change.
 *
 * @param camera - The camera component
 * @param zoom - New zoom level (1.0 = normal, 2.0 = 2x zoom, etc.)
 */
export function setZoom(camera: CameraT, zoom: number): void {
  if (zoom <= 0) {
    console.warn(`[camera] Invalid zoom level ${zoom}, must be > 0`);
    return;
  }

  // Adjust camera position if zooming toward a non-center target
  if (camera.zoomTarget && camera.parent && camera.parent.type === 'nexus') {
    const parentNexus = getProxiedComponent(
      camera.parent!,
    ) as unknown as NexusT;
    const sceneRoot = getProxiedComponent(
      parentNexus.parent!,
    ) as unknown as NexusT;

    // @ts-expect-error - Proxy methods exist at runtime
    const viewport = sceneRoot.getComponentByName(
      camera.viewportRef,
      true,
    ) as ViewportT | null;

    // @ts-expect-error - Proxy methods exist at runtime
    const transform = parentNexus.getComponentByType(
      'transform',
      false,
    ) as TransformT | null;

    if (viewport && transform && camera.zoomTarget) {
      const oldZoom = camera.zoom;
      const offsetX = camera.zoomTarget.x - viewport.width / 2;
      const offsetY = camera.zoomTarget.y - viewport.height / 2;
      const factor = 1 / (oldZoom * oldZoom) - 1 / (zoom * zoom);

      transform.position.x += offsetX * factor;
      transform.position.z += offsetY * factor;
    }
  }

  camera.zoom = zoom;

  // Update framebuffer resolution based on new zoom
  updateFramebufferForZoom(camera);
}

/**
 * Sets the zoom target to a specific viewport-local screen coordinate.
 * Subsequent setZoom calls will zoom toward this point.
 *
 * @param camera - The camera component
 * @param x - Viewport-local X coordinate (0 = left edge)
 * @param y - Viewport-local Y coordinate (0 = top edge)
 */
export function setZoomTarget(camera: CameraT, x: number, y: number): void {
  camera.zoomTarget = { x, y };
}

/**
 * Resets the zoom target to the viewport center.
 * Subsequent setZoom calls will zoom toward the center of the screen.
 *
 * @param camera - The camera component
 */
export function resetZoomTarget(camera: CameraT): void {
  camera.zoomTarget = null;
}

/**
 * Sets the camera pixel scale for pixelation intensity.
 *
 * @param camera - The camera component
 * @param pixelScale - Pixel scale factor (1.0 = no pixelation, 2.0 = 2x2 blocks, etc.)
 */
export function setPixelScale(camera: CameraT, pixelScale: number): void {
  if (pixelScale <= 0) {
    console.warn(`[camera] Invalid pixel scale ${pixelScale}, must be > 0`);
    return;
  }

  camera.pixelScale = pixelScale;

  // Update framebuffer resolution based on new pixel scale
  updateFramebufferForZoom(camera);
}

/**
 * Updates framebuffer resolution when zoom or pixel scale changes.
 * At higher zoom levels, renders to a smaller framebuffer for pixel-perfect effect.
 *
 * @param camera - The camera component
 */
function updateFramebufferForZoom(camera: CameraT): void {
  if (!camera.parent || camera.parent.type !== 'nexus') {
    return;
  }

  const parentNexus = getProxiedComponent(camera.parent!) as unknown as NexusT;
  const sceneRoot = getProxiedComponent(
    parentNexus.parent!,
  ) as unknown as NexusT;

  // @ts-expect-error - Proxy methods exist at runtime
  const viewport = sceneRoot.getComponentByName(
    camera.viewportRef,
    true,
  ) as ViewportT | null;

  if (!viewport || !viewport.gl) {
    return;
  }

  const gl = viewport.gl;

  // Recalculate base resolution based on new zoom and pixel scale
  // Add 2 pixels of overscan per dimension (1-pixel border on each side)
  const baseWidth =
    Math.floor(viewport.width / (camera.zoom * camera.pixelScale)) + 2;
  const baseHeight =
    Math.floor(viewport.height / (camera.zoom * camera.pixelScale)) + 2;

  camera.glResources.baseResolution.width = baseWidth;
  camera.glResources.baseResolution.height = baseHeight;

  if (!camera.glResources.renderTexture || !camera.glResources.depthTexture) {
    return;
  }

  // Resize render texture
  gl.bindTexture(gl.TEXTURE_2D, camera.glResources.renderTexture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    baseWidth,
    baseHeight,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    null,
  );

  // Resize depth texture
  gl.bindTexture(gl.TEXTURE_2D, camera.glResources.depthTexture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.DEPTH_COMPONENT24,
    baseWidth,
    baseHeight,
    0,
    gl.DEPTH_COMPONENT,
    gl.UNSIGNED_INT,
    null,
  );
}
