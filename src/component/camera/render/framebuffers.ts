import { ViewportT } from '../../viewport';
import { CameraT } from '../data';
import { FBO_OVERSCAN_PX } from './light-uniforms';

/**
 * Texture units this camera's own FBO attachments can be left resident on by a
 * render pass. They are cleared before any reallocation: a texture that is
 * simultaneously a sampler binding and an attachment of the bound framebuffer
 * makes WebGL detect a feedback loop and *silently fail every draw call* — see
 * the same defense at the top of `render/index.ts`.
 *
 * Unit 2 is the cell FBO's depth texture, sampled by the sprite pass for its
 * occlusion/silhouette test (`render-sprites.ts`).
 */
const OWNED_TEXTURE_UNITS = [2];

/** Sub-pixel remainder from the world-locked pixel snap; see `computeFboUvBridge`. */
export interface SubPixelOffset {
  remainderX: number;
  remainderY: number;
}

/** The scale/offset pair mapping a full-res UV into the base-res cell FBO. */
export interface FboUvBridge {
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
}

/**
 * The camera's offscreen (pre-upscale) render resolution, in pixels.
 *
 * Higher zoom / pixel scale means a *smaller* framebuffer, which is what
 * produces the pixel-perfect retro upscale. `FBO_OVERSCAN_PX` of padding is
 * added per dimension so the post-process UV offset has room to slide without
 * sampling outside the texture.
 *
 * Single source of truth for this formula — it was previously duplicated
 * verbatim between camera init and the zoom/resize path, which is how the two
 * allocation sites drifted apart.
 */
export function computeBaseResolution(
  camera: CameraT,
  viewport: ViewportT,
): { width: number; height: number } {
  return {
    width:
      Math.floor(viewport.width / (camera.zoom * camera.pixelScale)) +
      FBO_OVERSCAN_PX,
    height:
      Math.floor(viewport.height / (camera.zoom * camera.pixelScale)) +
      FBO_OVERSCAN_PX,
  };
}

/**
 * Writes the camera's current target resolutions onto `glResources` without
 * touching any GPU object. Split out from `allocateCameraTargets` so the
 * zoom/resize path can keep the recorded size current even for a camera whose
 * `init()` bailed before allocating anything.
 */
export function syncTargetResolutions(
  camera: CameraT,
  viewport: ViewportT,
): void {
  const base = computeBaseResolution(camera, viewport);
  camera.glResources.baseResolution.width = base.width;
  camera.glResources.baseResolution.height = base.height;
  camera.glResources.fullResolution.width = viewport.width;
  camera.glResources.fullResolution.height = viewport.height;
}

/**
 * Creates the texture if absent, then (re)allocates its storage at `w`x`h`.
 *
 * `internalFormat` defaults to the unsized `gl.RGBA` the cell FBO has always
 * used. The composite target passes the sized `gl.RGBA8` instead; the two are
 * equivalent in practice, but the cell FBO is deliberately left on the unsized
 * form so no pixel comparison against previous behaviour has to account for it.
 */
function allocateColorTexture(
  gl: WebGL2RenderingContext,
  existing: WebGLTexture | null,
  width: number,
  height: number,
  internalFormat: number = gl.RGBA,
): WebGLTexture | null {
  const texture = existing ?? gl.createTexture();
  if (!texture) return null;

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    internalFormat,
    width,
    height,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    null,
  );

  // NEAREST is required, not stylistic: the upscale blit relies on exact texel
  // reads for pixel-perfect scaling.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  return texture;
}

/** Creates the depth texture if absent, then (re)allocates its storage. */
function allocateDepthTexture(
  gl: WebGL2RenderingContext,
  existing: WebGLTexture | null,
  width: number,
  height: number,
): WebGLTexture | null {
  const texture = existing ?? gl.createTexture();
  if (!texture) return null;

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.DEPTH_COMPONENT24,
    width,
    height,
    0,
    gl.DEPTH_COMPONENT,
    gl.UNSIGNED_INT,
    null,
  );

  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  // NONE so the sprite pass can sample raw depth values rather than getting a
  // comparison result back.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.NONE);

  return texture;
}

/**
 * Idempotent create-or-resize for every framebuffer target this camera owns.
 *
 * Called from `init()` for the initial allocation and from the zoom/resize path
 * for every subsequent one, so the two can no longer disagree about what
 * allocation means. Deliberately re-attaches and re-validates on *every* call
 * rather than assuming a `texImage2D` in place leaves the framebuffer intact —
 * the resize path used to skip both, which is survivable with a single color
 * attachment and silently produces an incomplete framebuffer (every draw a
 * no-op, no error) once there are several in mixed formats.
 *
 * @returns true when every target is allocated and the framebuffer is complete.
 */
export function allocateCameraTargets(
  gl: WebGL2RenderingContext,
  camera: CameraT,
  viewport: ViewportT,
): boolean {
  syncTargetResolutions(camera, viewport);
  const res = camera.glResources;
  const { width, height } = res.baseResolution;

  // Unbind before touching anything: see OWNED_TEXTURE_UNITS.
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  for (const unit of OWNED_TEXTURE_UNITS) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }
  gl.activeTexture(gl.TEXTURE0);

  const framebuffer = res.framebuffer ?? gl.createFramebuffer();
  if (!framebuffer) {
    console.error(
      `[camera] Camera '${camera.name}' failed to create framebuffer`,
    );
    return false;
  }

  const renderTexture = allocateColorTexture(
    gl,
    res.renderTexture,
    width,
    height,
  );
  if (!renderTexture) {
    console.error(
      `[camera] Camera '${camera.name}' failed to create render texture`,
    );
    return false;
  }

  const depthTexture = allocateDepthTexture(
    gl,
    res.depthTexture,
    width,
    height,
  );
  if (!depthTexture) {
    console.error(
      `[camera] Camera '${camera.name}' failed to create depth texture`,
    );
    return false;
  }

  gl.bindTexture(gl.TEXTURE_2D, null);

  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    renderTexture,
    0,
  );
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.DEPTH_ATTACHMENT,
    gl.TEXTURE_2D,
    depthTexture,
    0,
  );

  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    console.error(
      `[camera] Camera '${camera.name}' framebuffer is not complete (status 0x${status.toString(16)}, ${width}x${height})`,
    );
    return false;
  }

  // ── Composite target (FBO_B) ────────────────────────────────────────────
  // Full viewport resolution, not base: the upscale blit lands here already
  // scaled up, and the sprite pass then draws into it at full resolution. That
  // ordering is what keeps pixelated terrain under crisp sprites.
  //
  // No depth attachment. The sprite pass disables the hardware depth test and
  // resolves occlusion in the fragment shader against the cell FBO's depth
  // texture, so there is nothing here to depth-test against.
  const fullWidth = viewport.width;
  const fullHeight = viewport.height;

  const framebufferB = res.framebufferB ?? gl.createFramebuffer();
  if (!framebufferB) {
    console.error(
      `[camera] Camera '${camera.name}' failed to create composite framebuffer`,
    );
    return false;
  }

  const compositeTexture = allocateColorTexture(
    gl,
    res.compositeTexture,
    fullWidth,
    fullHeight,
    gl.RGBA8,
  );
  if (!compositeTexture) {
    console.error(
      `[camera] Camera '${camera.name}' failed to create composite texture`,
    );
    return false;
  }

  gl.bindTexture(gl.TEXTURE_2D, null);

  gl.bindFramebuffer(gl.FRAMEBUFFER, framebufferB);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    compositeTexture,
    0,
  );

  const statusB = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  if (statusB !== gl.FRAMEBUFFER_COMPLETE) {
    console.error(
      `[camera] Camera '${camera.name}' composite framebuffer is not complete (status 0x${statusB.toString(16)}, ${fullWidth}x${fullHeight})`,
    );
    return false;
  }

  // Only publish the handles once both framebuffers are known good, matching
  // the original init ordering.
  res.framebuffer = framebuffer;
  res.renderTexture = renderTexture;
  res.depthTexture = depthTexture;
  res.framebufferB = framebufferB;
  res.compositeTexture = compositeTexture;

  return true;
}

/**
 * Deletes and nulls the framebuffer targets owned by this camera.
 *
 * Scoped to render targets only. The data textures the cell renderer uploads
 * (solidity, per-cell emission color, explored) are not framebuffer
 * attachments and are not this function's concern.
 */
export function disposeCameraTargets(
  gl: WebGL2RenderingContext | null,
  camera: CameraT,
): void {
  const res = camera.glResources;

  if (gl) {
    if (res.framebuffer) gl.deleteFramebuffer(res.framebuffer);
    if (res.renderTexture) gl.deleteTexture(res.renderTexture);
    if (res.depthTexture) gl.deleteTexture(res.depthTexture);
    if (res.framebufferB) gl.deleteFramebuffer(res.framebufferB);
    if (res.compositeTexture) gl.deleteTexture(res.compositeTexture);
  }

  res.framebuffer = null;
  res.renderTexture = null;
  res.depthTexture = null;
  res.framebufferB = null;
  res.compositeTexture = null;
}

/**
 * Maps a full-resolution screen UV into the base-resolution cell FBO.
 *
 * Two passes need this and are required to agree: the upscale blit
 * (`post-process.ts`), which samples the cell FBO to the screen, and the sprite
 * pass (`render-sprites.ts`), which samples that FBO's depth texture for its
 * per-fragment occlusion test. They previously computed it independently, and
 * one of them hardcoded the overscan constant.
 *
 * The padding is ASYMMETRIC. The FBO is `FBO_OVERSCAN_PX` larger per dimension:
 * on X the camera sits at the left edge (UV 0) with the padding on the right;
 * on Y the camera sits at the top (UV 1, because of the Y flip) with the
 * padding at the bottom. `scale` maps the quad onto the unpadded region and
 * `offset` slides sampling into the padding by the current sub-pixel remainder.
 *
 * Passing no `subPixelOffset`, or a `pixelScale` of 1 or less, means no
 * sub-pixel slide — the offset is then the fixed overscan skip.
 */
export function computeFboUvBridge(
  camera: CameraT,
  subPixelOffset?: SubPixelOffset,
): FboUvBridge {
  const fboWidth = camera.glResources.baseResolution.width;
  const fboHeight = camera.glResources.baseResolution.height;

  let fboOffsetX = 0;
  let fboOffsetY = 0;
  if (subPixelOffset && camera.pixelScale > 1) {
    fboOffsetX = (subPixelOffset.remainderX * camera.zoom) / camera.pixelScale;
    fboOffsetY = (subPixelOffset.remainderY * camera.zoom) / camera.pixelScale;
  }

  return {
    scaleX: (fboWidth - FBO_OVERSCAN_PX) / fboWidth,
    scaleY: (fboHeight - FBO_OVERSCAN_PX) / fboHeight,
    offsetX: fboOffsetX / fboWidth,
    offsetY: (FBO_OVERSCAN_PX - fboOffsetY) / fboHeight,
  };
}
