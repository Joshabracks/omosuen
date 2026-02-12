import { ComponentData, ComponentMethods, getProxiedComponent } from '../types';
import { CameraT } from './data';
import { NexusT } from '../nexus/data';
import { TransformT } from '../transform/data';
import { ViewportT } from '../viewport/data';
import { SpriteT } from '../sprite/data';
import { CellMapT } from '../cell-map/data';
import { AtlasManagerT } from '../atlas-manager/data';
import { TextureMapT } from '../texture-map/data';
import { unpackCell } from '../cell-map/types';

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
function render(camera: CameraT, _deltaTime: number): void {
  // Skip rendering if camera hasn't finished initializing
  // This is normal during progressive initialization
  if (!camera._initialized) {
    return;
  }

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

  // Collect all renderable components from the tree
  const { sprites, cellMaps } = Camera.collectRenderables(camera);

  console.log(
    `[camera] render() - collected ${sprites.length} sprites, ${cellMaps.length} cell-maps`,
  );

  const gl = viewport.gl;

  // Clear the viewport
  gl.clearColor(
    viewport.backgroundColor.x,
    viewport.backgroundColor.y,
    viewport.backgroundColor.z,
    viewport.backgroundColor.w,
  );
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  // Early return if nothing to render
  if (sprites.length === 0 && cellMaps.length === 0) {
    return;
  }

  // Build TextureMap lookup cache by textureMapKey
  // Both sprites and cell-maps need this cache
  // @ts-expect-error - Proxy methods exist at runtime
  const allTextureMaps = sceneRoot.getComponentsByType(
    'texture-map',
    true,
  ) as TextureMapT[];
  const textureMapCache = new Map<string, TextureMapT>();
  for (const tm of allTextureMaps) {
    textureMapCache.set(tm.textureMapKey, tm);
  }

  // Render sprites if any exist
  if (sprites.length > 0) {
    const program = camera.glResources.spriteProgram;
    if (!program) {
      console.warn(
        `[camera] Camera '${camera.name}' sprite shader program not initialized`,
      );
    } else {
      // Enable blending for transparency
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      // Disable depth testing for 2D sprite rendering
      // 2D sprites don't need depth testing - they're sorted by render order
      gl.disable(gl.DEPTH_TEST);

      // Disable backface culling for 2D sprites
      // Quads should render regardless of triangle winding order
      gl.disable(gl.CULL_FACE);

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
      const u_cameraPosition = gl.getUniformLocation(
        program,
        'u_cameraPosition',
      );
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const u_zoom = gl.getUniformLocation(program, 'u_zoom');
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const u_spritePosition = gl.getUniformLocation(
        program,
        'u_spritePosition',
      );
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

      // Set constant uniforms (same for all sprites)
      gl.uniform2f(u_viewportSize, viewport.width, viewport.height);
      gl.uniform2f(
        u_cameraPosition,
        transform.position.x,
        transform.position.y,
      );
      gl.uniform1f(u_zoom, camera.zoom);

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
        const spriteNexus = getProxiedComponent(
          sprite.parent,
        ) as unknown as NexusT;

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

        // Look up texture map by textureMapKey (not name!)
        const albedoTextureMap = textureMapCache.get(
          sprite.textureMapKeys.albedo,
        );
        if (!albedoTextureMap) {
          console.warn(
            `[camera] Sprite '${sprite.name}' references textureMapKey '${sprite.textureMapKeys.albedo}' which was not found`,
          );
          continue;
        }
        if (albedoTextureMap.packedFrames.length === 0) {
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
        const maxU =
          (albedoFrame.atlasPosition.x + albedoFrame.size.x) / atlasSize;
        const maxV =
          (albedoFrame.atlasPosition.y + albedoFrame.size.y) / atlasSize;
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
    }
  }

  // Render cell-maps (after sprites, with depth testing)
  if (cellMaps.length > 0) {
    console.log(
      `[camera] render() - calling renderCellMaps with ${cellMaps.length} cell-maps`,
    );
    renderCellMaps(
      camera,
      viewport,
      cellMaps,
      transform,
      sceneRoot,
      gl,
      textureMapCache,
    );
  } else {
    console.log('[camera] render() - no cell-maps to render');
  }
}

/**
 * Renders all cell-maps in the scene with 3D isometric projection.
 *
 * @param camera - The camera component
 * @param viewport - The viewport to render to
 * @param cellMaps - Array of cell-maps to render
 * @param cameraTransform - Camera's transform component
 * @param sceneRoot - Scene root nexus for component lookups
 * @param gl - WebGL2 rendering context
 * @param textureMapCache - Cached TextureMap components by key
 */
function renderCellMaps(
  camera: CameraT,
  viewport: ViewportT,
  cellMaps: CellMapT[],
  cameraTransform: TransformT,
  sceneRoot: NexusT,
  gl: WebGL2RenderingContext,
  textureMapCache: Map<string, TextureMapT>,
): void {
  console.log('[camera] renderCellMaps() - viewport:', viewport.width, 'x', viewport.height);
  console.log('[camera] renderCellMaps() - camera pos:', cameraTransform.position.x, cameraTransform.position.y);
  console.log('[camera] renderCellMaps() - camera zoom:', camera.zoom);

  const program = camera.glResources.cellMapProgram;
  if (!program) {
    console.warn('[camera] Cell-map shader program not initialized');
    return;
  }

  // Enable depth testing for 3D rendering
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LESS);

  // Enable backface culling for performance
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);

  // Use cell-map shader program
  gl.useProgram(program);

  // Get attribute locations
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const a_position = gl.getAttribLocation(program, 'a_position');
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const a_uv = gl.getAttribLocation(program, 'a_uv');
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const a_normal = gl.getAttribLocation(program, 'a_normal');

  // Get uniform locations
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const u_viewportSize = gl.getUniformLocation(program, 'u_viewportSize');
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const u_cameraPosition = gl.getUniformLocation(program, 'u_cameraPosition');
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const u_zoom = gl.getUniformLocation(program, 'u_zoom');
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const u_cellPosition = gl.getUniformLocation(program, 'u_cellPosition');
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const u_cellSize = gl.getUniformLocation(program, 'u_cellSize');
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const u_albedoTexture = gl.getUniformLocation(program, 'u_albedoTexture');
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const u_uvBounds = gl.getUniformLocation(program, 'u_uvBounds');

  // Set constant uniforms (same for all cells)
  gl.uniform2f(u_viewportSize, viewport.width, viewport.height);
  gl.uniform2f(
    u_cameraPosition,
    cameraTransform.position.x,
    cameraTransform.position.y,
  );
  gl.uniform1f(u_zoom, camera.zoom);

  // Bind cube geometry buffers (shared for all cells)
  gl.bindBuffer(gl.ARRAY_BUFFER, camera.glResources.cubeVertexBuffer);
  gl.enableVertexAttribArray(a_position);
  gl.vertexAttribPointer(a_position, 3, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, camera.glResources.cubeUVBuffer);
  gl.enableVertexAttribArray(a_uv);
  gl.vertexAttribPointer(a_uv, 2, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, camera.glResources.cubeNormalBuffer);
  gl.enableVertexAttribArray(a_normal);
  gl.vertexAttribPointer(a_normal, 3, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, camera.glResources.cubeIndexBuffer);

  // Get atlas manager for texture size
  // @ts-expect-error - Proxy methods exist at runtime
  const atlasManager = sceneRoot.getComponentByType(
    'atlas-manager',
    true,
  ) as AtlasManagerT | null;
  const atlasSize = atlasManager?.config.atlasSize ?? 1024;

  // Render each cell-map
  for (const cellMap of cellMaps) {
    renderSingleCellMap(
      camera,
      cellMap,
      gl,
      program,
      textureMapCache,
      atlasSize,
      u_cellPosition,
      u_cellSize,
      u_albedoTexture,
      u_uvBounds,
    );
  }

  // Restore state for sprite rendering
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
}

/**
 * Renders a single cell-map by iterating through all visible cells.
 *
 * @param camera - The camera component
 * @param cellMap - The cell-map to render
 * @param gl - WebGL2 rendering context
 * @param program - Active shader program
 * @param textureMapCache - Cached TextureMap components by key
 * @param atlasSize - Size of the texture atlas
 * @param u_cellPosition - Uniform location for cell position
 * @param u_cellSize - Uniform location for cell size
 * @param u_albedoTexture - Uniform location for albedo texture
 * @param u_uvBounds - Uniform location for UV bounds
 */
function renderSingleCellMap(
  camera: CameraT,
  cellMap: CellMapT,
  gl: WebGL2RenderingContext,
  _program: WebGLProgram,
  textureMapCache: Map<string, TextureMapT>,
  atlasSize: number,
  u_cellPosition: WebGLUniformLocation | null,
  u_cellSize: WebGLUniformLocation | null,
  u_albedoTexture: WebGLUniformLocation | null,
  u_uvBounds: WebGLUniformLocation | null,
): void {
  console.log(
    `[camera] renderSingleCellMap() - rendering cell-map '${cellMap.name}'`,
  );

  // Set cell size uniform (constant for this cell-map)
  gl.uniform3f(
    u_cellSize,
    cellMap.cellSize.x,
    cellMap.cellSize.y,
    cellMap.cellSize.z,
  );

  let totalCells = 0;
  let visibleCells = 0;
  let renderedCells = 0;
  let firstCellLogged = false;

  // Iterate through all cells in the map
  cellMap.packedData.forEach((packedValue, x, y, z) => {
    totalCells++;
    const cellData = unpackCell(packedValue);

    // Skip invisible or air cells
    if (!cellData.visible || cellData.shapeIndex === 0) {
      return;
    }

    visibleCells++;

    // Log first visible cell details for debugging
    if (!firstCellLogged) {
      const worldX = x * cellMap.cellSize.x;
      const worldY = y * cellMap.cellSize.y;
      const worldZ = z * cellMap.cellSize.z;
      console.log('[camera] First visible cell at grid:', x, y, z);
      console.log('[camera] First cell world pos:', worldX, worldY, worldZ);
      console.log('[camera] First cell size:', cellMap.cellSize.x, cellMap.cellSize.y, cellMap.cellSize.z);
      console.log('[camera] First cell materialIndex:', cellData.materialIndex);
      firstCellLogged = true;
    }

    // Get material for this cell
    const material = cellMap.materials[cellData.materialIndex];
    if (!material) {
      return;
    }

    // Get albedo texture map
    const albedoTextureMap = textureMapCache.get(material.albedoTextureKey);
    if (!albedoTextureMap || albedoTextureMap.packedFrames.length === 0) {
      return;
    }

    // Get the first frame from the texture map (frame 0)
    const albedoFrame = albedoTextureMap.packedFrames[0];
    if (!albedoFrame) {
      return;
    }

    // Get atlas texture
    const atlasTexture =
      camera.glResources.atlasTextures[albedoFrame.atlasIndex];
    if (!atlasTexture) {
      return;
    }

    // Bind albedo texture to TEXTURE0
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, atlasTexture);
    gl.uniform1i(u_albedoTexture, 0);

    // Calculate UV bounds in atlas
    const minU = albedoFrame.atlasPosition.x / atlasSize;
    const minV = albedoFrame.atlasPosition.y / atlasSize;
    const maxU = (albedoFrame.atlasPosition.x + albedoFrame.size.x) / atlasSize;
    const maxV = (albedoFrame.atlasPosition.y + albedoFrame.size.y) / atlasSize;
    gl.uniform4f(u_uvBounds, minU, minV, maxU, maxV);

    // Set cell world position
    gl.uniform3f(
      u_cellPosition,
      x * cellMap.cellSize.x,
      y * cellMap.cellSize.y,
      z * cellMap.cellSize.z,
    );

    // Draw the cube (36 indices)
    gl.drawElements(gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0);
    renderedCells++;
  });

  console.log(
    `[camera] renderSingleCellMap() - total: ${totalCells}, visible: ${visibleCells}, rendered: ${renderedCells}`,
  );
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

  // Search from scene root to find ALL sprites in the entire scene tree
  // This allows the camera to find sprites in sibling branches, not just children
  const sceneRoot = getProxiedComponent(
    parentNexus.parent!,
  ) as unknown as NexusT;

  // Recursively collect all sprites from the scene root
  // @ts-expect-error - Proxy methods exist at runtime but TypeScript can't infer them
  const sprites = sceneRoot.getComponentsByType('sprite', true) as SpriteT[];

  // Recursively collect all cell maps from the scene root
  // @ts-expect-error - Proxy methods exist at runtime but TypeScript can't infer them
  const cellMaps = sceneRoot.getComponentsByType(
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
    uniform vec2 u_cameraPosition;
    uniform float u_zoom;
    varying vec2 v_uv;

    void main() {
      // Apply rotation
      float c = cos(u_rotation);
      float s = sin(u_rotation);
      vec2 rotated = vec2(
        a_position.x * c - a_position.y * s,
        a_position.x * s + a_position.y * c
      );

      // Scale by sprite size and zoom, then translate to world position
      // Subtract camera position to convert from world space to view space
      vec2 viewPos = (u_spritePosition - u_cameraPosition);
      vec2 pos = rotated * (u_spriteSize * u_zoom) + viewPos;

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

  // 2. Create cell-map shader program
  const cellMapVertexShaderSource = `
    attribute vec3 a_position;
    attribute vec2 a_uv;
    attribute vec3 a_normal;

    uniform vec2 u_viewportSize;
    uniform vec2 u_cameraPosition;
    uniform float u_zoom;
    uniform vec3 u_cellPosition;
    uniform vec3 u_cellSize;

    varying vec2 v_uv;
    varying vec3 v_normal;
    varying vec3 v_worldPos;

    void main() {
      // Scale vertex by cell size and translate to world position
      vec3 worldPos = a_position * u_cellSize + u_cellPosition;

      // Apply standard isometric projection (top-down view, 30-degree angles)
      // +X projects right-down at 30° from horizontal
      // +Y projects straight up (vertical)
      // +Z projects left-down at 30° from horizontal (mirrored from X)
      vec2 isoX = worldPos.x * vec2(0.866, 0.5);      // cos(30°), sin(30°)
      vec2 isoY = worldPos.y * vec2(0.0, -1.0);       // straight up
      vec2 isoZ = worldPos.z * vec2(-0.866, 0.5);     // cos(150°), sin(150°)

      // Combine isometric axes to get 2D projection
      vec2 isoProjected = isoX + isoY + isoZ;

      // Convert to view space (subtract camera) and apply zoom
      vec2 isoPos = (isoProjected - u_cameraPosition) * u_zoom;

      // Convert to clip space
      vec2 clipSpace = (isoPos / u_viewportSize) * 2.0 - 1.0;

      // TEMPORARY: Use constant depth to debug visibility issues
      // TODO: Implement proper isometric depth sorting once geometry is visible
      float depth = 0.0;
      gl_Position = vec4(clipSpace * vec2(1, -1), depth, 1);

      // Transform normal to isometric screen space (same transformation as position)
      // This allows lighting to work correctly in 2D isometric view
      vec3 isoNormalX = a_normal.x * vec3(0.866, 0.5, 0.0);
      vec3 isoNormalY = a_normal.y * vec3(0.0, -1.0, 0.0);
      vec3 isoNormalZ = a_normal.z * vec3(-0.866, 0.5, 0.0);
      vec3 isoNormal = isoNormalX + isoNormalY + isoNormalZ;

      v_uv = a_uv;
      v_normal = normalize(isoNormal);
      v_worldPos = worldPos;
    }
  `;

  const cellMapFragmentShaderSource = `
    precision mediump float;

    uniform sampler2D u_albedoTexture;
    uniform vec4 u_uvBounds;

    varying vec2 v_uv;
    varying vec3 v_normal;
    varying vec3 v_worldPos;

    void main() {
      // Sample albedo texture
      vec2 atlasUV = mix(u_uvBounds.xy, u_uvBounds.zw, v_uv);
      vec4 albedo = texture2D(u_albedoTexture, atlasUV);

      // Directional light in screen space (top-right, typical for isometric)
      vec3 lightDir = normalize(vec3(0.5, -0.7, 0.0));
      vec3 normal = normalize(v_normal);

      // Diffuse lighting with ambient
      float diffuse = max(dot(normal, lightDir), 0.0);
      float ambient = 0.4;  // 40% ambient light
      float lighting = ambient + diffuse * 0.6;  // 60% directional contribution

      gl_FragColor = vec4(albedo.rgb * lighting, albedo.a);
    }
  `;

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

  // 4. Create cube mesh buffers for cell-map rendering
  // Import default cube mesh geometry from cell-map component
  const { generateDefaultCubeMesh } = await import('../cell-map/data');
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
  camera.glResources.cubeVertexBuffer = null;
  camera.glResources.cubeUVBuffer = null;
  camera.glResources.cubeNormalBuffer = null;
  camera.glResources.cubeIndexBuffer = null;

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
