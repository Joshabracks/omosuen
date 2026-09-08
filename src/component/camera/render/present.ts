import { ViewportT } from '../../viewport';
import { CameraT } from '../data';

/**
 * Final pass: blit the composite target (FBO_B) to the default framebuffer.
 *
 * A 1:1 NEAREST copy at full resolution, so it is exact — the upscale already
 * happened on the way into FBO_B and the sprite pass drew on top of it there.
 *
 * This exists so the whole frame lands in a sampleable texture before reaching
 * the screen. That costs one fullscreen textured quad and buys two things: the
 * exact final pixels can be read back offscreen (the default framebuffer is
 * created without `preserveDrawingBuffer` and cannot be), and a post-effect
 * chain can be inserted ahead of it without any pass needing to know whether
 * it happens to be the last one.
 *
 * @param camera - The camera component
 * @param viewport - The viewport being presented to
 * @param gl - WebGL2 rendering context
 * @param sourceTexture - Texture to present; defaults to the composite target
 */
export function renderPresent(
  camera: CameraT,
  viewport: ViewportT,
  gl: WebGL2RenderingContext,
  sourceTexture?: WebGLTexture | null,
): void {
  const presentProgram = camera.glResources.presentProgram;
  if (!presentProgram) {
    console.warn('[camera] Present program not initialized');
    return;
  }

  const source = sourceTexture ?? camera.glResources.compositeTexture;
  if (!source) return;

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, viewport.width, viewport.height);

  // Clear the screen with the viewport background colour, exactly as the
  // upscale pass used to when it targeted the screen directly. The quad below
  // covers every pixel, so this only matters for the edges of a canvas whose
  // drawing buffer and CSS size disagree — but it costs nothing and keeps the
  // old behaviour intact.
  gl.clearColor(
    viewport.backgroundColor.x,
    viewport.backgroundColor.y,
    viewport.backgroundColor.z,
    viewport.backgroundColor.w,
  );
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  gl.useProgram(presentProgram);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, source);
  gl.uniform1i(gl.getUniformLocation(presentProgram, 'u_color'), 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, camera.glResources.fullscreenQuadBuffer);

  // Interleaved position(2) + uv(2), stride 16 — same buffer the upscale uses.
  const aPosition = gl.getAttribLocation(presentProgram, 'a_position');
  const aUV = gl.getAttribLocation(presentProgram, 'a_uv');
  gl.enableVertexAttribArray(aPosition);
  gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(aUV);
  gl.vertexAttribPointer(aUV, 2, gl.FLOAT, false, 16, 8);

  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);

  gl.drawArrays(gl.TRIANGLES, 0, 6);

  // Leave no camera-owned texture resident: the composite texture is an
  // attachment of FBO_B, which the upscale pass binds at the top of the next
  // frame. A texture that is both a sampler binding and an attachment of the
  // bound framebuffer makes WebGL silently fail every draw call.
  gl.bindTexture(gl.TEXTURE_2D, null);
}
