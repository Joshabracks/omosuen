import { AtlasManagerT } from '../../atlas-manager';
import { generateDefaultCubeMesh } from '../../cell-map';
import { NexusT } from '../../nexus';
import { ComponentData, getProxiedComponent } from '../../types';
import { ViewportT } from '../../viewport';
import { CameraT } from '../data';
import { createShaderProgram } from '../shader/create-shader-program';
import {
  cellMapVertexShaderSource,
  cellMapFragmentShaderSource,
} from '../shader/shader-cell-map';
import {
  postProcessVertexShader,
  postProcessFragmentShader,
} from '../shader/shader-post-process';
import {
  unifiedVertexShader,
  unifiedFragmentShader,
} from '../shader/shader-unified';

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

  const parentNexus = getProxiedComponent(camera.parent!) as unknown as NexusT;

  // Get viewport from scene root (viewport is typically a sibling of camera's parent)
  const sceneRoot = getProxiedComponent(
    parentNexus.parent!,
  ) as unknown as NexusT;
  // @ts-expect-error - Proxy methods exist at runtime but TypeScript can't infer them
  const viewport = sceneRoot.getComponentByName(
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
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const u_renderMode = gl.getUniformLocation(unifiedProgram, 'u_renderMode');
  if (!u_renderMode) {
    console.warn(
      `[camera] Camera '${camera.name}' could not find u_renderMode uniform in unified shader`,
    );
  }
  camera.glResources.renderModeLocation = u_renderMode;

  console.log(
    `[camera] Camera '${camera.name}' compiled unified shader program`,
  );

  const cellMapProgram = createShaderProgram(
    gl,
    cellMapVertexShaderSource,
    cellMapFragmentShaderSource,
  );
  if (!cellMapProgram) {
    console.error(
      `[camera] Camera '${camera.name}' failed to create cell-map shader program`,
    );
    return;
  }
  camera.glResources.cellMapProgram = cellMapProgram;

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
  // @ts-expect-error - Proxy methods exist at runtime but TypeScript can't infer them
  const atlasManager = sceneRoot.getComponentByType(
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
    camera.glResources.atlasTextures = [];
    for (let i = 0; i < atlasManager.atlases.length; i++) {
      const atlas = atlasManager.atlases[i];
      if (!atlas) continue;

      const texture = gl.createTexture();
      if (!texture) {
        console.error(
          `[camera] Camera '${camera.name}' failed to create texture for atlas ${i}`,
        );
        continue;
      }

      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        atlas,
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      camera.glResources.atlasTextures[i] = texture;
    }

    console.log(
      `[camera] Camera '${camera.name}' uploaded ${camera.glResources.atlasTextures.length} atlas textures`,
    );
  }

  // 4. Create framebuffer for pixel-perfect post-processing
  // Determine base resolution based on current zoom level and pixel scale
  const baseWidth = Math.floor(
    viewport.width / (camera.zoom * camera.pixelScale),
  );
  const baseHeight = Math.floor(
    viewport.height / (camera.zoom * camera.pixelScale),
  );

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

  // Create depth renderbuffer
  const depthRenderbuffer = gl.createRenderbuffer();
  if (!depthRenderbuffer) {
    console.error(
      `[camera] Camera '${camera.name}' failed to create depth renderbuffer`,
    );
    return;
  }

  gl.bindRenderbuffer(gl.RENDERBUFFER, depthRenderbuffer);
  gl.renderbufferStorage(
    gl.RENDERBUFFER,
    gl.DEPTH_COMPONENT16,
    baseWidth,
    baseHeight,
  );

  // Attach to framebuffer
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    renderTexture,
    0,
  );
  gl.framebufferRenderbuffer(
    gl.FRAMEBUFFER,
    gl.DEPTH_ATTACHMENT,
    gl.RENDERBUFFER,
    depthRenderbuffer,
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
  camera.glResources.depthRenderbuffer = depthRenderbuffer;

  console.log(
    `[camera] Camera '${camera.name}' created framebuffer at ${baseWidth}x${baseHeight}`,
  );

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

  console.log(
    `[camera] Camera '${camera.name}' compiled post-process shader program`,
  );

  // 6. Create cube mesh buffers for cell-map rendering
  const cubeMesh = generateDefaultCubeMesh();

  // Cube vertices (24 vertices, 3 components each = 72 floats)
  const cubeVertexBuffer = gl.createBuffer();
  if (!cubeVertexBuffer) {
    console.error(
      `[camera] Camera '${camera.name}' failed to create cube vertex buffer`,
    );
    return;
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, cubeVertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, cubeMesh.vertices, gl.STATIC_DRAW);
  camera.glResources.cubeVertexBuffer = cubeVertexBuffer;

  // Cube UVs (24 vertices, 2 components each = 48 floats)
  const cubeUVBuffer = gl.createBuffer();
  if (!cubeUVBuffer) {
    console.error(
      `[camera] Camera '${camera.name}' failed to create cube UV buffer`,
    );
    return;
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, cubeUVBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, cubeMesh.uvs, gl.STATIC_DRAW);
  camera.glResources.cubeUVBuffer = cubeUVBuffer;

  // Cube normals (calculate from vertices - 24 vertices, 3 components = 72 floats)
  const cubeNormals = new Float32Array([
    // Front face (z = 0.5) - normal pointing out (+Z)
    0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
    // Back face (z = -0.5) - normal pointing out (-Z)
    0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
    // Top face (y = 0.5) - normal pointing out (+Y)
    0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
    // Bottom face (y = -0.5) - normal pointing out (-Y)
    0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0,
    // Right face (x = 0.5) - normal pointing out (+X)
    1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
    // Left face (x = -0.5) - normal pointing out (-X)
    -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,
  ]);

  const cubeNormalBuffer = gl.createBuffer();
  if (!cubeNormalBuffer) {
    console.error(
      `[camera] Camera '${camera.name}' failed to create cube normal buffer`,
    );
    return;
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, cubeNormalBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, cubeNormals, gl.STATIC_DRAW);
  camera.glResources.cubeNormalBuffer = cubeNormalBuffer;

  // Cube indices (36 indices for 12 triangles)
  const cubeIndexBuffer = gl.createBuffer();
  if (!cubeIndexBuffer) {
    console.error(
      `[camera] Camera '${camera.name}' failed to create cube index buffer`,
    );
    return;
  }
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, cubeIndexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, cubeMesh.indices, gl.STATIC_DRAW);
  camera.glResources.cubeIndexBuffer = cubeIndexBuffer;

  console.log(
    `[camera] Camera '${camera.name}' initialized with WebGL context`,
  );

  camera._initialized = true;
}
