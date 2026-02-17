import { AtlasManagerT } from '../../atlas-manager';
import { CellMapT, unpackCell } from '../../cell-map';
import { NexusT } from '../../nexus';
import { TextureMapT } from '../../texture-map';
import { TransformT } from '../../transform';
import { ViewportT } from '../../viewport';
import { CameraT } from '../data';

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
): void {
  // Bind default framebuffer (screen)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  // Reset viewport to full canvas size
  gl.viewport(0, 0, viewport.width, viewport.height);

  // Clear screen
  gl.clearColor(0, 0, 0, 1);
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
export function renderCellMaps(
  camera: CameraT,
  viewport: ViewportT,
  cellMaps: CellMapT[],
  cameraTransform: TransformT,
  sceneRoot: NexusT,
  gl: WebGL2RenderingContext,
  textureMapCache: Map<string, TextureMapT>,
): void {
  console.log(
    '[camera] renderCellMaps() - viewport:',
    viewport.width,
    'x',
    viewport.height,
  );
  console.log(
    '[camera] renderCellMaps() - camera pos:',
    cameraTransform.position.x,
    cameraTransform.position.y,
  );
  console.log('[camera] renderCellMaps() - camera zoom:', camera.zoom);

  const program = camera.glResources.unifiedProgram;
  if (!program) {
    console.warn('[camera] Unified shader program not initialized');
    return;
  }

  // Enable depth testing for 3D rendering with depth writes enabled
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LESS);
  gl.depthMask(true); // Cells WRITE to depth buffer

  // Enable backface culling for performance
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);

  // Use unified shader program
  gl.useProgram(program);

  // Set render mode to 0 (cells)
  if (camera.glResources.renderModeLocation) {
    gl.uniform1i(camera.glResources.renderModeLocation, 0);
  }

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
  const u_mapSize = gl.getUniformLocation(program, 'u_mapSize');
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const u_albedoTexture = gl.getUniformLocation(program, 'u_albedoTexture');
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const u_normalTexture = gl.getUniformLocation(program, 'u_normalTexture');
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const u_uvBounds = gl.getUniformLocation(program, 'u_uvBounds');
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const u_normalUVBounds = gl.getUniformLocation(program, 'u_normalUVBounds');
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const u_textureSize = gl.getUniformLocation(program, 'u_textureSize');
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const u_hasNormal = gl.getUniformLocation(program, 'u_hasNormal');

  // Set constant uniforms (same for all cells)
  // Use logical resolution (viewport / zoom) for shader coordinate space.
  // pixelScale only affects the physical FBO size — not the coordinate system.
  const logicalWidth = viewport.width / camera.zoom;
  const logicalHeight = viewport.height / camera.zoom;
  gl.uniform2f(u_viewportSize, logicalWidth, logicalHeight);
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
      u_mapSize,
      u_albedoTexture,
      u_normalTexture,
      u_uvBounds,
      u_normalUVBounds,
      u_textureSize,
      u_hasNormal,
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
 * @param u_mapSize - Uniform location for map size
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
  u_mapSize: WebGLUniformLocation | null,
  u_albedoTexture: WebGLUniformLocation | null,
  u_normalTexture: WebGLUniformLocation | null,
  u_uvBounds: WebGLUniformLocation | null,
  u_normalUVBounds: WebGLUniformLocation | null,
  u_textureSize: WebGLUniformLocation | null,
  u_hasNormal: WebGLUniformLocation | null,
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

  // Set map size uniform (constant for this cell-map)
  gl.uniform3f(
    u_mapSize,
    cellMap.mapSize.x,
    cellMap.mapSize.y,
    cellMap.mapSize.z,
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
      console.log(
        '[camera] First cell size:',
        cellMap.cellSize.x,
        cellMap.cellSize.y,
        cellMap.cellSize.z,
      );
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

    // Set texture size for world-space pixel-perfect sampling
    gl.uniform2f(u_textureSize, albedoFrame.size.x, albedoFrame.size.y);

    // Bind normal texture if available
    const normalTextureMap = textureMapCache.get(material.normalTextureKey);
    if (normalTextureMap && normalTextureMap.packedFrames.length > 0) {
      const normalFrame = normalTextureMap.packedFrames[0];
      const normalAtlasTexture =
        camera.glResources.atlasTextures[normalFrame.atlasIndex];

      if (normalAtlasTexture) {
        // Bind normal texture to TEXTURE1
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, normalAtlasTexture);
        gl.uniform1i(u_normalTexture, 1);

        // Calculate normal UV bounds in atlas
        const normalMinU = normalFrame.atlasPosition.x / atlasSize;
        const normalMinV = normalFrame.atlasPosition.y / atlasSize;
        const normalMaxU =
          (normalFrame.atlasPosition.x + normalFrame.size.x) / atlasSize;
        const normalMaxV =
          (normalFrame.atlasPosition.y + normalFrame.size.y) / atlasSize;
        gl.uniform4f(
          u_normalUVBounds,
          normalMinU,
          normalMinV,
          normalMaxU,
          normalMaxV,
        );

        // Enable normal mapping
        gl.uniform1i(u_hasNormal, 1);
      } else {
        // No normal map available
        gl.uniform1i(u_hasNormal, 0);
      }
    } else {
      // No normal map available
      gl.uniform1i(u_hasNormal, 0);
    }

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
