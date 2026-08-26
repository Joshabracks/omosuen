import { NexusT } from '../../nexus';
import { TransformT } from '../../transform';
import { castTo } from '../../types';
import { ViewportT } from '../../viewport';
import { CameraT } from '../data';
import { FBO_OVERSCAN_PX } from '../render/light-uniforms';

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
    const parentNexus = castTo<NexusT>(camera.parent!);
    const sceneRoot = castTo<NexusT>(parentNexus.parent!);

    const viewport = sceneRoot.getComponentByTypeAndName(
      'viewport',
      camera.viewportRef,
      true,
    ) as ViewportT | null;

    const transform = parentNexus.getComponentByType(
      'transform',
      false,
    ) as TransformT | null;

    if (viewport && transform && camera.zoomTarget) {
      const oldZoom = camera.zoom;
      const offsetX = camera.zoomTarget.x - viewport.width / 2;
      const offsetY = camera.zoomTarget.y - viewport.height / 2;
      const factor = 1 / (oldZoom * oldZoom) - 1 / (zoom * zoom);

      // Inverse-project screen-space zoom offset to world-space (matches the
      // rotate-then-de-rotate inverse in pan/index.ts and screen-pick/ray.ts).
      const ISO_H = 0.8660254; // cos(30deg) — constant horizontal spread
      const clampedAngle = Math.max(0, Math.min(90, camera.axonometricAngle));
      const angleRad = (clampedAngle * Math.PI) / 180;
      const sinA = Math.sin(angleRad);
      const heightScale = Math.cos(angleRad) * 1.1547005; // cos(a)/cos(30deg)
      const yawRad = (camera.orbitYaw * Math.PI) / 180;
      const cosYaw = Math.cos(yawRad);
      const sinYaw = Math.sin(yawRad);
      const screenDx = offsetX * factor;
      const screenDy = offsetY * factor;

      let rDx: number;
      let rDz: number;
      if (sinA < 0.01) {
        rDx = screenDx / (2 * ISO_H);
        rDz = -screenDx / (2 * ISO_H);
        if (heightScale > 0.01) {
          transform.position.y -= screenDy / heightScale;
        }
      } else {
        rDx = screenDx / (2 * ISO_H) + screenDy / (2 * sinA);
        rDz = -screenDx / (2 * ISO_H) + screenDy / (2 * sinA);
      }
      transform.position.x += rDx * cosYaw - rDz * sinYaw;
      transform.position.z += rDx * sinYaw + rDz * cosYaw;
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
 * Sets the camera's orbit yaw (degrees, rotating world X/Z around +Y before
 * the axonometric projection). Normalized into [0, 360).
 *
 * @param camera - The camera component
 * @param degrees - New orbit yaw in degrees
 */
export function setOrbitYaw(camera: CameraT, degrees: number): void {
  const wrapped = ((degrees % 360) + 360) % 360;
  camera.orbitYaw = wrapped;
}

/**
 * Rotates the camera's orbit yaw by a relative amount (degrees). Convenience
 * wrapper for drag/keyboard-driven orbit controls.
 *
 * @param camera - The camera component
 * @param deltaDegrees - Amount to add to the current orbit yaw, in degrees
 */
export function orbitBy(camera: CameraT, deltaDegrees: number): void {
  setOrbitYaw(camera, camera.orbitYaw + deltaDegrees);
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
 * Re-syncs the camera's offscreen framebuffer to the current viewport size.
 * Call after resizing the viewport (e.g. Viewport.resize, or its autoResize
 * pass) so the pixel-perfect FBO grid matches the new dimensions.
 */
export function resize(camera: CameraT): void {
  setPixelScale(camera, camera.pixelScale);
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

  const parentNexus = castTo<NexusT>(camera.parent!);
  const sceneRoot = castTo<NexusT>(parentNexus.parent!);

  const viewport = sceneRoot.getComponentByTypeAndName(
    'viewport',
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
    Math.floor(viewport.width / (camera.zoom * camera.pixelScale)) +
    FBO_OVERSCAN_PX;
  const baseHeight =
    Math.floor(viewport.height / (camera.zoom * camera.pixelScale)) +
    FBO_OVERSCAN_PX;

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
