import { AtlasManagerT } from '../../atlas-manager';

import { NexusT } from '../../nexus';
import { ComponentData, castTo } from '../../types';
import { ViewportT } from '../../viewport';
import { CameraT } from '../data';
import { createShaderProgram } from '../shader/create-shader-program';
import postProcessVertexShader from '../shader/post.vert';
import postProcessFragmentShader from '../shader/post.frag';
import unifiedVertexShader from '../shader/unified.vert';
import unifiedFragmentShader from '../shader/unified.frag';
import {
  FBO_OVERSCAN_PX,
  cacheLightUniformLocations,
} from '../render/light-uniforms';
import { initRenderWasm } from '../render/wasm';
import { uploadAtlasTextures } from '../render/atlas-textures';

/**
 * Initializes WebGL resources for the camera (shader programs, buffers).
 * Called automatically when the component is added to the scene.
 *
 * @param component - The camera component
 */
export async function init(component: ComponentData): Promise<void> {
  const camera = component as CameraT;
  if (!camera.parent || camera.parent.type !== 'nexus') {
    console.warn(
      `[camera] Camera '${camera.name}' has no parent nexus, cannot initialize`,
    );
    return;
  }

  const parentNexus = castTo<NexusT>(camera.parent!);

  // Get viewport from scene root (viewport is typically a sibling of camera's parent)
  // If camera is directly under root, parentNexus IS the root (parent is null)
  const searchRoot = parentNexus.parent
    ? castTo<NexusT>(parentNexus.parent)
    : parentNexus;
  const viewport = searchRoot.getComponentByTypeAndName(
    'viewport',
    camera.viewportRef,
    true,
  ) as ViewportT | null;

  if (!viewport || !viewport.gl) {
    console.warn(
      `[camera] Camera '${camera.name}' cannot find viewport '${camera.viewportRef}' or WebGL context, cannot initialize`,
    );
    return;
  }

  const gl = viewport.gl;

  // Load the render-domain WASM compute backend before this camera can render.
  // render() skips uninitialized cameras, and processInitQueue awaits this init,
  // so the module is guaranteed ready before any solidity()/compute call. Hard
  // requirement — no JS fallback. Idempotent across cameras.
  await initRenderWasm();

  // Compile unified shader program
  const unifiedProgram = createShaderProgram(
    gl,
    unifiedVertexShader,
    unifiedFragmentShader,
  );
  if (!unifiedProgram) {
    console.error(
      `[camera] Camera '${camera.name}' failed to create unified shader program`,
    );
    return;
  }
  camera.glResources.unifiedProgram = unifiedProgram;

  // Get renderMode uniform location for switching between cell/sprite modes
  const u_renderMode = gl.getUniformLocation(unifiedProgram, 'u_renderMode');
  if (!u_renderMode) {
    console.warn(
      `[camera] Camera '${camera.name}' could not find u_renderMode uniform in unified shader`,
    );
  }
  camera.glResources.renderModeLocation = u_renderMode;

  // Cache all light uniform locations for this camera
  cacheLightUniformLocations(gl, unifiedProgram, camera.id!);

  // 3. Create quad geometry buffers
  // Vertex positions (centered quad -0.5 to 0.5)
  const vertices = new Float32Array([
    -0.5,
    -0.5, // bottom-left
    0.5,
    -0.5, // bottom-right
    0.5,
    0.5, // top-right
    -0.5,
    -0.5, // bottom-left
    0.5,
    0.5, // top-right
    -0.5,
    0.5, // top-left
  ]);

  const quadVertexBuffer = gl.createBuffer();
  if (!quadVertexBuffer) {
    console.error(
      `[camera] Camera '${camera.name}' failed to create vertex buffer`,
    );
    return;
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, quadVertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  camera.glResources.quadVertexBuffer = quadVertexBuffer;

  // UV coordinates (0,0 to 1,1)
  // Note: V coordinates are flipped (0 at bottom, 1 at top) to match ImageData Y-axis orientation
  const uvs = new Float32Array([
    0,
    0, // bottom-left
    1,
    0, // bottom-right
    1,
    1, // top-right
    0,
    0, // bottom-left
    1,
    1, // top-right
    0,
    1, // top-left
  ]);

  const quadUVBuffer = gl.createBuffer();
  if (!quadUVBuffer) {
    console.error(
      `[camera] Camera '${camera.name}' failed to create UV buffer`,
    );
    return;
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, quadUVBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);
  camera.glResources.quadUVBuffer = quadUVBuffer;

  // 3. Upload atlas textures
  const atlasManager = searchRoot.getComponentByType(
    'atlas-manager',
    true,
  ) as AtlasManagerT | null;

  if (!atlasManager) {
    console.warn(
      `[camera] Camera '${camera.name}' - AtlasManager component not found in scene, no atlas textures available. Add an AtlasManager component to the scene.`,
    );
    camera.glResources.atlasTextures = [];
  } else if (!atlasManager.compiled) {
    console.warn(
      `[camera] Camera '${camera.name}' - AtlasManager exists but has not compiled texture atlases yet. Call atlasManager.processTextureMaps() before camera initialization, or ensure camera._initDefer is set appropriately.`,
    );
    camera.glResources.atlasTextures = [];
  } else {
    uploadAtlasTextures(gl, camera, atlasManager);
  }

  // 4. Create framebuffer for pixel-perfect post-processing
  // Determine base resolution based on current zoom level and pixel scale
  // Add 2 pixels of overscan per dimension (1-pixel border on each side)
  // so the post-process UV offset has room to slide without exceeding texture bounds
  const baseWidth =
    Math.floor(viewport.width / (camera.zoom * camera.pixelScale)) +
    FBO_OVERSCAN_PX;
  const baseHeight =
    Math.floor(viewport.height / (camera.zoom * camera.pixelScale)) +
    FBO_OVERSCAN_PX;

  camera.glResources.baseResolution = {
    width: baseWidth,
    height: baseHeight,
  };

  // Create framebuffer
  const framebuffer = gl.createFramebuffer();
  if (!framebuffer) {
    console.error(
      `[camera] Camera '${camera.name}' failed to create framebuffer`,
    );
    return;
  }

  // Create render texture (where scene renders to)
  const renderTexture = gl.createTexture();
  if (!renderTexture) {
    console.error(
      `[camera] Camera '${camera.name}' failed to create render texture`,
    );
    return;
  }

  gl.bindTexture(gl.TEXTURE_2D, renderTexture);
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

  // CRITICAL: Use NEAREST filtering for pixel-perfect scaling
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // Create depth texture (sampleable for sprite occlusion masking)
  const depthTexture = gl.createTexture();
  if (!depthTexture) {
    console.error(
      `[camera] Camera '${camera.name}' failed to create depth texture`,
    );
    return;
  }

  gl.bindTexture(gl.TEXTURE_2D, depthTexture);
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
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.NONE);

  // Attach to framebuffer
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

  // Check framebuffer completeness
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    console.error(
      `[camera] Camera '${camera.name}' framebuffer is not complete`,
    );
    return;
  }

  // Unbind framebuffer
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  // Store framebuffer resources
  camera.glResources.framebuffer = framebuffer;
  camera.glResources.renderTexture = renderTexture;
  camera.glResources.depthTexture = depthTexture;

  // 5. Create post-processing shader

  const postProcessProgram = createShaderProgram(
    gl,
    postProcessVertexShader,
    postProcessFragmentShader,
  );
  if (!postProcessProgram) {
    console.error(
      `[camera] Camera '${camera.name}' failed to create post-process shader program`,
    );
    return;
  }
  camera.glResources.postProcessProgram = postProcessProgram;

  // Create fullscreen quad buffer for post-processing
  const fullscreenQuad = new Float32Array([
    -1,
    -1,
    0,
    0, // bottom-left
    1,
    -1,
    1,
    0, // bottom-right
    1,
    1,
    1,
    1, // top-right
    -1,
    -1,
    0,
    0, // bottom-left
    1,
    1,
    1,
    1, // top-right
    -1,
    1,
    0,
    1, // top-left
  ]);

  const fullscreenQuadBuffer = gl.createBuffer();
  if (!fullscreenQuadBuffer) {
    console.error(
      `[camera] Camera '${camera.name}' failed to create fullscreen quad buffer`,
    );
    return;
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, fullscreenQuadBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, fullscreenQuad, gl.STATIC_DRAW);
  camera.glResources.fullscreenQuadBuffer = fullscreenQuadBuffer;

  camera._initialized = true;
}
