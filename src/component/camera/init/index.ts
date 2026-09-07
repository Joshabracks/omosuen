import { AtlasManagerT } from '../../atlas-manager';

import { NexusT } from '../../nexus';
import { ComponentData, castTo } from '../../types';
import { ViewportT } from '../../viewport';
import { CameraT } from '../data';
import { createShaderProgram } from '../shader/create-shader-program';
import postProcessFragmentShader from '../shader/post.frag';
import postEffectVertexShader from '../shader/post-effect.vert';
import postPresentFragmentShader from '../shader/post-present.frag';
import unifiedVertexShader from '../shader/unified.vert';
import unifiedFragmentShader from '../shader/unified.frag';
import { cacheLightUniformLocations } from '../render/light-uniforms';
import { allocateCameraTargets } from '../render/framebuffers';
import {
  MAX_VISION_SOURCES,
  cacheVisionUniformLocations,
} from '../render/vision-uniforms';
import { cacheFogUniformLocations } from '../render/fog-uniforms';
import { initRenderWasm } from '../render/wasm';
import { uploadAtlasTextures } from '../render/atlas-textures';

/** Matches unified.frag's vision-source cap declaration — see init(). */
const MAX_VISION_SOURCES_RE = /const int MAX_VISION_SOURCES = \d+;/;

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

  // Substitute the vision-source cap into the fragment shader so GLSL cannot
  // drift from the TS constant the upload path sizes its buffers and location
  // cache against. The test is load-bearing: a silent non-match would put the
  // two declarations back out of step, which is exactly the failure this
  // prevents.
  if (!MAX_VISION_SOURCES_RE.test(unifiedFragmentShader)) {
    console.error(
      `[camera] Camera '${camera.name}': unified.frag has no MAX_VISION_SOURCES declaration to substitute`,
    );
    return;
  }
  const unifiedFragmentSource = unifiedFragmentShader.replace(
    MAX_VISION_SOURCES_RE,
    `const int MAX_VISION_SOURCES = ${MAX_VISION_SOURCES};`,
  );

  // Compile unified shader program
  const unifiedProgram = createShaderProgram(
    gl,
    unifiedVertexShader,
    unifiedFragmentSource,
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
  // Cache all vision-source (fog-of-war) uniform locations for this camera
  cacheVisionUniformLocations(gl, unifiedProgram, camera.id!);
  cacheFogUniformLocations(gl, unifiedProgram, camera.id!);

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

  // 4. Create framebuffer targets for pixel-perfect post-processing.
  // Shared with the zoom/resize path so the two cannot disagree about what
  // allocation means — see render/framebuffers.ts.
  if (!allocateCameraTargets(gl, camera, viewport)) {
    return;
  }

  // 5. Create post-processing shader

  // post.frag is GLSL ES 3.00 (it samples the integer id attachment), so it
  // pairs with post-effect.vert rather than the old 1.00 post.vert.
  const postProcessProgram = createShaderProgram(
    gl,
    postEffectVertexShader,
    postProcessFragmentShader,
  );
  if (!postProcessProgram) {
    console.error(
      `[camera] Camera '${camera.name}' failed to create post-process shader program`,
    );
    return;
  }
  camera.glResources.postProcessProgram = postProcessProgram;

  // Present program: the final composite → screen blit. GLSL ES 3.00, so it
  // uses post-effect.vert rather than the 1.00 post.vert above (a 3.00 fragment
  // shader cannot link against a 1.00 vertex shader).
  const presentProgram = createShaderProgram(
    gl,
    postEffectVertexShader,
    postPresentFragmentShader,
  );
  if (!presentProgram) {
    console.error(
      `[camera] Camera '${camera.name}' failed to create present shader program`,
    );
    return;
  }
  camera.glResources.presentProgram = presentProgram;

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
