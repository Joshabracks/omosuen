import { ComponentData, ComponentMethods, getProxiedComponent } from '../types';
import { CameraT } from './data';
import { NexusT } from '../nexus/data';
import { TransformT } from '../transform/data';
import { ViewportT } from '../viewport/data';
import { SpriteT } from '../sprite/data';
import { CellMapT } from '../cell-map/data';
import { AtlasManagerT } from '../atlas-manager/data';
import { TextureMapT } from '../texture-map/data';

export interface CameraMethods extends ComponentMethods {
  render: (camera: CameraT, deltaTime: number) => void;
  collectRenderables: (camera: CameraT) => {
    sprites: SpriteT[];
    cellMaps: CellMapT[];
  };
  pan: (camera: CameraT, offsetX: number, offsetY: number) => void;
  setZoom: (camera: CameraT, zoom: number) => void;
  init: (component: ComponentData) => Promise<void>;
  dispose: (component: ComponentData) => void;
}

/**
 * Renders the scene from the camera's perspective.
 * This is called by the main render loop.
 *
 * @param camera - The camera component
 * @param deltaTime - Time elapsed since last frame in milliseconds
 */
function render(camera: CameraT, deltaTime: number): void {
  if (!camera.parent || camera.parent.type !== 'nexus') {
    console.warn(
      `[camera] Camera '${camera.name}' has no parent nexus, cannot render`,
    );
    return;
  }

  const parentNexus = getProxiedComponent(camera.parent!) as unknown as NexusT;

  // Get sibling transform for camera position
  // @ts-expect-error - Proxy methods exist at runtime but TypeScript can't infer them
  const transform = parentNexus.getComponentByType(
    'transform',
    false,
  ) as TransformT | null;

  if (!transform) {
    console.warn(
      `[camera] Camera '${camera.name}' has no sibling transform component`,
    );
    return;
  }

  // Get viewport to render to (search from scene root, not parent)
  // Viewport is typically a sibling of the camera's parent nexus
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
      `[camera] Camera '${camera.name}' cannot find viewport '${camera.viewportRef}' or WebGL context`,
    );
    return;
  }

  // Skip rendering if no redraw needed (optimization for future)
  if (!camera.needsRedraw) {
    return;
  }

  // Collect all renderable components from the tree
  const { sprites } = Camera.collectRenderables(camera);

  const gl = viewport.gl;
  const program = camera.glResources.spriteProgram;

  if (!program) {
    console.warn(
      `[camera] Camera '${camera.name}' sprite shader program not initialized`,
    );
    return;
  }

  // Clear the viewport
  gl.clearColor(
    viewport.backgroundColor.x,
    viewport.backgroundColor.y,
    viewport.backgroundColor.z,
    viewport.backgroundColor.w,
  );
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  // No sprites to render
  if (sprites.length === 0) {
    camera.needsRedraw = false;
    return;
  }

  // Enable blending for transparency
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  // Use sprite shader program
  gl.useProgram(program);

  // Get attribute/uniform locations
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const a_position = gl.getAttribLocation(program, 'a_position');
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const a_uv = gl.getAttribLocation(program, 'a_uv');
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const u_viewportSize = gl.getUniformLocation(program, 'u_viewportSize');
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const u_spritePosition = gl.getUniformLocation(program, 'u_spritePosition');
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const u_spriteSize = gl.getUniformLocation(program, 'u_spriteSize');
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const u_rotation = gl.getUniformLocation(program, 'u_rotation');
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const u_albedoTexture = gl.getUniformLocation(program, 'u_albedoTexture');
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const u_hasNormal = gl.getUniformLocation(program, 'u_hasNormal');
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const u_hasMaterial = gl.getUniformLocation(program, 'u_hasMaterial');
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const u_hasEmission = gl.getUniformLocation(program, 'u_hasEmission');
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const u_tint = gl.getUniformLocation(program, 'u_tint');
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const u_opacity = gl.getUniformLocation(program, 'u_opacity');
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const u_uvBounds = gl.getUniformLocation(program, 'u_uvBounds');

  // Set viewport size uniform (constant for all sprites)
  gl.uniform2f(u_viewportSize, viewport.width, viewport.height);

  // Bind vertex buffers (shared for all sprites)
  gl.bindBuffer(gl.ARRAY_BUFFER, camera.glResources.quadVertexBuffer);
  gl.enableVertexAttribArray(a_position);
  gl.vertexAttribPointer(a_position, 2, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, camera.glResources.quadUVBuffer);
  gl.enableVertexAttribArray(a_uv);
  gl.vertexAttribPointer(a_uv, 2, gl.FLOAT, false, 0, 0);

  // Get atlas manager for texture size
  // @ts-expect-error - Proxy methods exist at runtime
  const atlasManager = sceneRoot.getComponentByType(
    'atlas-manager',
    true,
  ) as AtlasManagerT | null;
  const atlasSize = atlasManager?.config.atlasSize ?? 1024;

  // Render each sprite
  for (const sprite of sprites) {
    // Get sprite's parent nexus
    if (!sprite.parent || sprite.parent.type !== 'nexus') continue;
    const spriteNexus = getProxiedComponent(sprite.parent) as unknown as NexusT;

    // Get sprite transform (sibling component)
    // @ts-expect-error - Proxy methods exist at runtime
    const spriteTransform = spriteNexus.getComponentByType(
      'transform',
      false,
    ) as TransformT | null;
    if (!spriteTransform) continue;

    // Get albedo texture map (required)
    if (!sprite.textureMapKeys.albedo) {
      console.warn(
        `[camera] Sprite '${sprite.name}' missing albedo texture, skipping`,
      );
      continue;
    }

    // @ts-expect-error - Proxy methods exist at runtime
    const albedoTextureMap = sceneRoot.getComponentByName(
      sprite.textureMapKeys.albedo,
      true,
    ) as TextureMapT | null;
    if (!albedoTextureMap || albedoTextureMap.packedFrames.length === 0) {
      continue;
    }

    // Get packed frame for current albedo frame index
    const albedoFrame = albedoTextureMap.packedFrames.find(
      (f) => f.frameIndex === sprite.frame.albedo,
    );
    if (!albedoFrame) {
      console.warn(
        `[camera] Sprite '${sprite.name}' frame ${sprite.frame.albedo} not found in texture map`,
      );
      continue;
    }

    // Get atlas texture
    const atlasTexture =
      camera.glResources.atlasTextures[albedoFrame.atlasIndex];
    if (!atlasTexture) {
      console.warn(
        `[camera] Sprite '${sprite.name}' atlas ${albedoFrame.atlasIndex} texture not found`,
      );
      continue;
    }

    // Bind albedo texture to TEXTURE0
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, atlasTexture);
    gl.uniform1i(u_albedoTexture, 0);

    // Set channel flags (only albedo supported for now)
    gl.uniform1i(u_hasNormal, 0);
    gl.uniform1i(u_hasMaterial, 0);
    gl.uniform1i(u_hasEmission, 0);

    // Calculate UV bounds in atlas (normalized 0-1 coordinates)
    const minU = albedoFrame.atlasPosition.x / atlasSize;
    const minV = albedoFrame.atlasPosition.y / atlasSize;
    const maxU = (albedoFrame.atlasPosition.x + albedoFrame.size.x) / atlasSize;
    const maxV = (albedoFrame.atlasPosition.y + albedoFrame.size.y) / atlasSize;
    gl.uniform4f(u_uvBounds, minU, minV, maxU, maxV);

    // Set sprite transformation uniforms
    gl.uniform2f(
      u_spritePosition,
      spriteTransform.position.x,
      spriteTransform.position.y,
    );
    gl.uniform2f(
      u_spriteSize,
      albedoFrame.size.x * spriteTransform.scale.x,
      albedoFrame.size.y * spriteTransform.scale.y,
    );
    gl.uniform1f(u_rotation, spriteTransform.rotation);

    // Set sprite appearance uniforms
    gl.uniform4f(
      u_tint,
      sprite.tint.x,
      sprite.tint.y,
      sprite.tint.z,
      sprite.tint.w,
    );
    gl.uniform1f(u_opacity, sprite.opacity);

    // Draw the sprite quad (6 vertices = 2 triangles)
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  // Mark as rendered
  camera.needsRedraw = false;
}

/**
 * Collects all renderable components (sprites and cell maps) from the render tree.
 *
 * @param camera - The camera component
 * @returns Object containing arrays of sprites and cell maps
 */
function collectRenderables(camera: CameraT): {
  sprites: SpriteT[];
  cellMaps: CellMapT[];
} {
  if (!camera.parent || camera.parent.type !== 'nexus') {
    return { sprites: [], cellMaps: [] };
  }

  const parentNexus = getProxiedComponent(camera.parent!) as unknown as NexusT;

  // Recursively collect all sprites from the tree
  // @ts-expect-error - Proxy methods exist at runtime but TypeScript can't infer them
  const sprites = parentNexus.getComponentsByType('sprite', true) as SpriteT[];

  // Recursively collect all cell maps from the tree
  // @ts-expect-error - Proxy methods exist at runtime but TypeScript can't infer them
  const cellMaps = parentNexus.getComponentsByType(
    'cell-map',
    true,
  ) as CellMapT[];

  return { sprites, cellMaps };
}

/**
 * Pans the camera by updating the sibling transform's position.
 *
 * @param camera - The camera component
 * @param offsetX - X offset to pan by
 * @param offsetY - Y offset to pan by
 */
function pan(camera: CameraT, offsetX: number, offsetY: number): void {
  if (!camera.parent || camera.parent.type !== 'nexus') {
    console.warn(
      `[camera] Camera '${camera.name}' has no parent nexus, cannot pan`,
    );
    return;
  }

  const parentNexus = getProxiedComponent(camera.parent!) as unknown as NexusT;
  // @ts-expect-error - Proxy methods exist at runtime but TypeScript can't infer them
  const transform = parentNexus.getComponentByType(
    'transform',
    false,
  ) as TransformT | null;

  if (!transform) {
    console.warn(
      `[camera] Camera '${camera.name}' has no sibling transform component, cannot pan`,
    );
    return;
  }

  // Update transform position
  transform.position.x += offsetX;
  transform.position.y += offsetY;

  // Mark for redraw
  camera.needsRedraw = true;
}

/**
 * Sets the camera zoom level.
 *
 * @param camera - The camera component
 * @param zoom - New zoom level (1.0 = normal, 2.0 = 2x zoom, etc.)
 */
function setZoom(camera: CameraT, zoom: number): void {
  if (zoom <= 0) {
    console.warn(`[camera] Invalid zoom level ${zoom}, must be > 0`);
    return;
  }

  camera.zoom = zoom;
  camera.needsRedraw = true;
}

/**
 * Creates and compiles a WebGL shader program from vertex and fragment shader source code.
 *
 * @param gl - WebGL2 rendering context
 * @param vertexSource - GLSL vertex shader source code
 * @param fragmentSource - GLSL fragment shader source code
 * @returns Compiled shader program, or null if compilation failed
 */
function createShaderProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram | null {
  // Compile vertex shader
  const vertexShader = gl.createShader(gl.VERTEX_SHADER);
  if (!vertexShader) {
    console.error('[camera] Failed to create vertex shader');
    return null;
  }

  gl.shaderSource(vertexShader, vertexSource);
  gl.compileShader(vertexShader);

  if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
    console.error(
      '[camera] Vertex shader compilation failed:',
      gl.getShaderInfoLog(vertexShader),
    );
    gl.deleteShader(vertexShader);
    return null;
  }

  // Compile fragment shader
  const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
  if (!fragmentShader) {
    console.error('[camera] Failed to create fragment shader');
    gl.deleteShader(vertexShader);
    return null;
  }

  gl.shaderSource(fragmentShader, fragmentSource);
  gl.compileShader(fragmentShader);

  if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
    console.error(
      '[camera] Fragment shader compilation failed:',
      gl.getShaderInfoLog(fragmentShader),
    );
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    return null;
  }

  // Link program
  const program = gl.createProgram();
  if (!program) {
    console.error('[camera] Failed to create shader program');
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    return null;
  }

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error(
      '[camera] Shader program linking failed:',
      gl.getProgramInfoLog(program),
    );
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    gl.deleteProgram(program);
    return null;
  }

  // Shaders can be deleted after linking
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  return program;
}

/**
 * Initializes WebGL resources for the camera (shader programs, buffers).
 * Called automatically when the component is added to the scene.
 *
 * @param component - The camera component
 */
async function init(component: ComponentData): Promise<void> {
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

  // 1. Create sprite shader program
  const vertexShaderSource = `
    attribute vec2 a_position;
    attribute vec2 a_uv;
    uniform vec2 u_spritePosition;
    uniform vec2 u_spriteSize;
    uniform float u_rotation;
    uniform vec2 u_viewportSize;
    varying vec2 v_uv;

    void main() {
      // Apply rotation
      float c = cos(u_rotation);
      float s = sin(u_rotation);
      vec2 rotated = vec2(
        a_position.x * c - a_position.y * s,
        a_position.x * s + a_position.y * c
      );

      // Scale and translate
      vec2 pos = rotated * u_spriteSize + u_spritePosition;

      // Convert to clip space
      vec2 clipSpace = (pos / u_viewportSize) * 2.0 - 1.0;
      gl_Position = vec4(clipSpace * vec2(1, -1), 0, 1);
      v_uv = a_uv;
    }
  `;

  const fragmentShaderSource = `
    precision mediump float;
    uniform sampler2D u_albedoTexture;
    uniform sampler2D u_normalTexture;
    uniform sampler2D u_materialTexture;
    uniform sampler2D u_emissionTexture;
    uniform bool u_hasNormal;
    uniform bool u_hasMaterial;
    uniform bool u_hasEmission;
    uniform vec4 u_tint;
    uniform float u_opacity;
    uniform vec4 u_uvBounds;
    varying vec2 v_uv;

    void main() {
      // Sample UV within atlas bounds
      vec2 atlasUV = mix(u_uvBounds.xy, u_uvBounds.zw, v_uv);

      // Albedo (always required)
      vec4 albedo = texture2D(u_albedoTexture, atlasUV);

      // Optional channels (placeholder for now - just pass through albedo)
      // TODO: Implement normal mapping, material properties, emission

      // Apply tint and opacity
      gl_FragColor = albedo * u_tint * vec4(1, 1, 1, u_opacity);
    }
  `;

  const spriteProgram = createShaderProgram(
    gl,
    vertexShaderSource,
    fragmentShaderSource,
  );
  if (!spriteProgram) {
    console.error(
      `[camera] Camera '${camera.name}' failed to create sprite shader program`,
    );
    return;
  }
  camera.glResources.spriteProgram = spriteProgram;

  // 2. Create quad geometry buffers
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
  const uvs = new Float32Array([
    0,
    1, // bottom-left
    1,
    1, // bottom-right
    1,
    0, // top-right
    0,
    1, // bottom-left
    1,
    0, // top-right
    0,
    0, // top-left
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

  console.log(
    `[camera] Camera '${camera.name}' initialized with WebGL context`,
  );

  camera.needsRedraw = true;
}

/**
 * Disposes WebGL resources when the camera is removed.
 *
 * @param component - The camera component
 */
function dispose(component: ComponentData): void {
  const camera = component as CameraT;

  // Note: WebGL resources are managed by the WebGL context.
  // When the context is lost or the page unloads, resources are automatically freed.
  // We null out our references to allow garbage collection, but don't need to
  // explicitly call gl.deleteProgram() etc. unless we're dynamically creating/destroying
  // many cameras during runtime (which is unlikely).

  // Clear shader programs
  camera.glResources.cellMapProgram = null;
  camera.glResources.spriteProgram = null;

  // Clear buffers
  camera.glResources.quadVertexBuffer = null;
  camera.glResources.quadUVBuffer = null;

  // Clear textures
  camera.glResources.atlasTextures = [];

  camera._disposed = true;

  console.log(`[camera] Camera '${camera.name}' disposed`);
}

export const Camera: CameraMethods = {
  type: 'camera',
  render,
  collectRenderables,
  pan,
  setZoom,
  init,
  dispose,
};
