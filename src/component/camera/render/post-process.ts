import { ViewportT } from '../../viewport';
import { CameraT } from '../data';
import { FBO_OVERSCAN_PX } from './light-uniforms';

/**
 * Renders the offscreen framebuffer to the canvas with pixel-perfect upscaling.
 * This creates the retro pixel-art zoom effect.
 *
 * @param camera - The camera component
 * @param viewport - The viewport to render to
 * @param gl - WebGL2 rendering context
 */
export function renderPostProcess(
  camera: CameraT,
  viewport: ViewportT,
  gl: WebGL2RenderingContext,
  subPixelOffset?: { remainderX: number; remainderY: number },
): void {
  // Bind default framebuffer (screen)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  // Reset viewport to full canvas size
  gl.viewport(0, 0, viewport.width, viewport.height);

  // Clear screen with viewport background color so edge gaps blend seamlessly
  gl.clearColor(
    viewport.backgroundColor.x,
    viewport.backgroundColor.y,
    viewport.backgroundColor.z,
    viewport.backgroundColor.w,
  );
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  // Use post-process shader
  const postProgram = camera.glResources.postProcessProgram;
  if (!postProgram) {
    console.warn('[camera] Post-process program not initialized');
    return;
  }

  gl.useProgram(postProgram);

  // Bind render texture
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, camera.glResources.renderTexture);
  const uRenderTexture = gl.getUniformLocation(postProgram, 'u_renderTexture');
  gl.uniform1i(uRenderTexture, 0);

  // Set UV scale and offset for world-locked pixelation with FBO overscan.
  // The FBO is 2 pixels larger per dimension. The padding is ASYMMETRIC:
  // - X: camera is at left edge (UV=0), +2 padding on RIGHT
  // - Y: camera is at top edge (UV=1 due to Y-flip), +2 padding on BOTTOM (UV=0 side)
  // u_uvScale maps the fullscreen quad to the unpadded viewport region.
  // u_uvOffset slides the sampling into the right/bottom padding as needed.
  const uUvScale = gl.getUniformLocation(postProgram, 'u_uvScale');
  const uUvOffset = gl.getUniformLocation(postProgram, 'u_uvOffset');

  const fboWidth = camera.glResources.baseResolution.width; // padded
  const fboHeight = camera.glResources.baseResolution.height; // padded
  const unpaddedWidth = fboWidth - FBO_OVERSCAN_PX;
  const unpaddedHeight = fboHeight - FBO_OVERSCAN_PX;

  // UV scale: map [0,1] quad UV to the unpadded viewport region
  gl.uniform2f(uUvScale, unpaddedWidth / fboWidth, unpaddedHeight / fboHeight);

  if (subPixelOffset && camera.pixelScale > 1) {
    const fboOffsetX =
      (subPixelOffset.remainderX * camera.zoom) / camera.pixelScale;
    const fboOffsetY =
      (subPixelOffset.remainderY * camera.zoom) / camera.pixelScale;
    // X: no border on left (camera edge), offset slides right into right padding
    // Y: skip 2-pixel bottom border, offset slides down into bottom padding
    gl.uniform2f(
      uUvOffset,
      fboOffsetX / fboWidth,
      (FBO_OVERSCAN_PX - fboOffsetY) / fboHeight,
    );
  } else {
    // No offset; X starts at 0 (camera edge), Y skips 2-pixel bottom border
    gl.uniform2f(uUvOffset, 0, FBO_OVERSCAN_PX / fboHeight);
  }

  // Bind fullscreen quad buffer
  gl.bindBuffer(gl.ARRAY_BUFFER, camera.glResources.fullscreenQuadBuffer);

  // Set up attributes (interleaved: position + UV)
  const aPosition = gl.getAttribLocation(postProgram, 'a_position');
  const aUV = gl.getAttribLocation(postProgram, 'a_uv');

  gl.enableVertexAttribArray(aPosition);
  gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 16, 0);

  gl.enableVertexAttribArray(aUV);
  gl.vertexAttribPointer(aUV, 2, gl.FLOAT, false, 16, 8);

  // Disable depth test and blending for fullscreen quad
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);

  // Draw fullscreen quad
  gl.drawArrays(gl.TRIANGLES, 0, 6);
}
