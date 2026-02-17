import { NexusT } from '../../nexus';
import { getProxiedComponent } from '../../types';
import { ViewportT } from '../../viewport';
import { CameraT } from '../data';

/**
 * Sets the camera zoom level and updates framebuffer resolution.
 *
 * @param camera - The camera component
 * @param zoom - New zoom level (1.0 = normal, 2.0 = 2x zoom, etc.)
 */
export function setZoom(camera: CameraT, zoom: number): void {
  if (zoom <= 0) {
    console.warn(`[camera] Invalid zoom level ${zoom}, must be > 0`);
    return;
  }

  camera.zoom = zoom;

  // Update framebuffer resolution based on new zoom
  updateFramebufferForZoom(camera);
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
  const baseWidth = Math.floor(
    viewport.width / (camera.zoom * camera.pixelScale),
  );
  const baseHeight = Math.floor(
    viewport.height / (camera.zoom * camera.pixelScale),
  );

  camera.glResources.baseResolution.width = baseWidth;
  camera.glResources.baseResolution.height = baseHeight;

  if (
    !camera.glResources.renderTexture ||
    !camera.glResources.depthRenderbuffer
  ) {
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

  // Resize depth buffer
  gl.bindRenderbuffer(gl.RENDERBUFFER, camera.glResources.depthRenderbuffer);
  gl.renderbufferStorage(
    gl.RENDERBUFFER,
    gl.DEPTH_COMPONENT16,
    baseWidth,
    baseHeight,
  );

  console.log(
    `[camera] Updated framebuffer resolution to ${baseWidth}x${baseHeight} for zoom ${camera.zoom}`,
  );
}
