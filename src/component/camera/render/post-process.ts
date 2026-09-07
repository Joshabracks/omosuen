import { ViewportT } from '../../viewport';
import { CameraT } from '../data';
import { computeFboUvBridge } from './framebuffers';

/**
 * Upscales the base-resolution cell framebuffer into the full-resolution
 * composite target, applying the cliff-edge outline on the way. This is what
 * creates the retro pixel-art zoom effect.
 *
 * Runs BEFORE the sprite pass, which then draws into the same composite target
 * at full resolution — that ordering is what gives pixelated terrain under
 * crisp sprites, and it is also why the outline lives here rather than in the
 * post-effect chain: it is a cell-space cue, computed from the cell FBO's depth
 * buffer, and sprites are meant to draw over it.
 *
 * @param camera - The camera component
 * @param viewport - The viewport being rendered for
 * @param gl - WebGL2 rendering context
 */
export function renderUpscale(
  camera: CameraT,
  viewport: ViewportT,
  gl: WebGL2RenderingContext,
  subPixelOffset?: { remainderX: number; remainderY: number },
): void {
  // Target the composite framebuffer rather than the screen.
  gl.bindFramebuffer(gl.FRAMEBUFFER, camera.glResources.framebufferB);

  // Full canvas size — the composite target is allocated at that resolution.
  gl.viewport(0, 0, viewport.width, viewport.height);

  // Clear with the viewport background color so edge gaps blend seamlessly
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

  // Bind cell-FBO depth texture (linear) for the cliff-edge outline pass
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, camera.glResources.depthTexture);
  gl.uniform1i(gl.getUniformLocation(postProgram, 'u_depthTexture'), 1);

  // UV scale/offset for world-locked pixelation with FBO overscan — shared with
  // the sprite pass's depth-texture sampling, which must agree exactly. See
  // computeFboUvBridge for the asymmetric-padding reasoning.
  const uUvScale = gl.getUniformLocation(postProgram, 'u_uvScale');
  const uUvOffset = gl.getUniformLocation(postProgram, 'u_uvOffset');

  const bridge = computeFboUvBridge(camera, subPixelOffset);
  gl.uniform2f(uUvScale, bridge.scaleX, bridge.scaleY);
  gl.uniform2f(uUvOffset, bridge.offsetX, bridge.offsetY);

  const fboWidth = camera.glResources.baseResolution.width;
  const fboHeight = camera.glResources.baseResolution.height;

  // Cliff-edge outline uniforms (post-process). null/weight 0 = plain blit.
  const outline = camera.depthCues?.outline;
  gl.uniform2f(
    gl.getUniformLocation(postProgram, 'u_texelSize'),
    1 / fboWidth,
    1 / fboHeight,
  );
  gl.uniform1f(
    gl.getUniformLocation(postProgram, 'u_outlineWeight'),
    outline ? outline.weight : 0,
  );
  gl.uniform1f(
    gl.getUniformLocation(postProgram, 'u_outlineThreshold'),
    outline ? outline.threshold : 1,
  );
  gl.uniform1f(
    gl.getUniformLocation(postProgram, 'u_outlineWidth'),
    outline ? outline.width : 1,
  );
  gl.uniform3f(
    gl.getUniformLocation(postProgram, 'u_outlineColor'),
    outline ? outline.color.x : 0,
    outline ? outline.color.y : 0,
    outline ? outline.color.z : 0,
  );

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
