import { AtlasManagerT } from '../../atlas-manager';
import { NexusT } from '../../nexus';
import { TextureMapT } from '../../texture-map';
import { TransformT } from '../../transform';
import { getProxiedComponent } from '../../types';
import { ViewportT } from '../../viewport';
import { CameraT } from '../data';
import { Camera } from '../methods';
import { renderCellMaps, renderPostProcess, snapCameraPosition } from './utils';

/**
 * Renders the scene from the camera's perspective.
 * This is called by the main render loop.
 *
 * @param camera - The camera component
 * @param deltaTime - Time elapsed since last frame in milliseconds
 */
export function render(camera: CameraT, _deltaTime: number): void {
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

  // PHASE 1: Bind framebuffer for offscreen rendering at base resolution
  gl.bindFramebuffer(gl.FRAMEBUFFER, camera.glResources.framebuffer);

  // Set viewport to base resolution (smaller than canvas for pixel-perfect zoom)
  const baseWidth = camera.glResources.baseResolution.width;
  const baseHeight = camera.glResources.baseResolution.height;
  gl.viewport(0, 0, baseWidth, baseHeight);

  // Clear framebuffer with depth buffer reset
  gl.clearColor(
    viewport.backgroundColor.x,
    viewport.backgroundColor.y,
    viewport.backgroundColor.z,
    viewport.backgroundColor.w,
  );
  gl.clearDepth(1.0); // Ensure depth buffer clears to far plane
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  // Compute camera snap for world-locked pixelation
  const cameraSnap = snapCameraPosition(
    transform.position.x,
    transform.position.y,
    camera.pixelScale,
    camera.zoom,
  );
  const subPixelOffset = {
    remainderX: cameraSnap.remainderX,
    remainderY: cameraSnap.remainderY,
  };

  // Early return if nothing to render
  if (sprites.length === 0 && cellMaps.length === 0) {
    // Still need to display the empty framebuffer
    renderPostProcess(camera, viewport, gl, subPixelOffset);
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

  // Render cell-maps FIRST (before sprites) with depth writes enabled
  // This populates the depth buffer with solid geometry
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

  // PHASE 2: Post-process cells to screen with pixel-perfect upscaling
  renderPostProcess(camera, viewport, gl, subPixelOffset);

  // PHASE 3: Render sprites directly to screen at full resolution (no pixelation)
  if (sprites.length > 0) {
    const program = camera.glResources.unifiedProgram;
    if (!program) {
      console.warn(
        `[camera] Camera '${camera.name}' unified shader program not initialized`,
      );
    } else {
      // Bind default framebuffer (screen) and set full-resolution viewport
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, viewport.width, viewport.height);

      // Calculate unified map bounds from all cell-maps for consistent depth sorting
      // Sprites need to use the maximum dimensions across all maps to ensure
      // they depth-sort correctly with all cell-maps in the scene
      let maxMapWidth = 0;
      let maxMapHeight = 0;
      let maxMapDepth = 0;
      let unifiedCellSizeX = 32; // Default cell size
      let unifiedCellSizeY = 16;
      let unifiedCellSizeZ = 32;

      for (const cellMap of cellMaps) {
        maxMapWidth = Math.max(maxMapWidth, cellMap.mapSize.x);
        maxMapHeight = Math.max(maxMapHeight, cellMap.mapSize.y);
        maxMapDepth = Math.max(maxMapDepth, cellMap.mapSize.z);
        // Use the first cell-map's cell size (assume all maps use same cell size)
        if (cellMap === cellMaps[0]) {
          unifiedCellSizeX = cellMap.cellSize.x;
          unifiedCellSizeY = cellMap.cellSize.y;
          unifiedCellSizeZ = cellMap.cellSize.z;
        }
      }

      // Fallback to reasonable defaults if no cell-maps found
      if (maxMapWidth === 0) maxMapWidth = 20;
      if (maxMapHeight === 0) maxMapHeight = 20;
      if (maxMapDepth === 0) maxMapDepth = 20;

      // Enable blending so transparent sprite pixels show cells underneath
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      // Disable depth test — sprites composite on top of cells in painter's order
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);

      // Disable backface culling for 2D sprites
      gl.disable(gl.CULL_FACE);

      // Use unified shader program
      gl.useProgram(program);

      // Set render mode to 1 (sprites)
      if (camera.glResources.renderModeLocation) {
        gl.uniform1i(camera.glResources.renderModeLocation, 1);
      }

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
      const u_cellSize = gl.getUniformLocation(program, 'u_cellSize');
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const u_mapSize = gl.getUniformLocation(program, 'u_mapSize');
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const u_spritePosition = gl.getUniformLocation(
        program,
        'u_spritePosition',
      );
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const u_spriteSize = gl.getUniformLocation(program, 'u_spriteSize');
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const u_anchor = gl.getUniformLocation(program, 'u_anchor');
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const u_rotation = gl.getUniformLocation(program, 'u_rotation');
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const u_albedoTexture = gl.getUniformLocation(program, 'u_albedoTexture');
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const u_normalTexture = gl.getUniformLocation(program, 'u_normalTexture');
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
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const u_normalUVBounds = gl.getUniformLocation(
        program,
        'u_normalUVBounds',
      );

      // Set constant uniforms (same for all sprites)
      // Sprites render at full resolution to screen (not via FBO), so they use
      // the raw camera position for smooth movement instead of the snapped position.
      gl.uniform2f(
        u_viewportSize,
        viewport.width / camera.zoom,
        viewport.height / camera.zoom,
      );
      gl.uniform2f(
        u_cameraPosition,
        transform.position.x,
        transform.position.y,
      );
      gl.uniform1f(u_zoom, camera.zoom);
      gl.uniform3f(
        u_cellSize,
        unifiedCellSizeX,
        unifiedCellSizeY,
        unifiedCellSizeZ,
      );
      gl.uniform3f(u_mapSize, maxMapWidth, maxMapHeight, maxMapDepth);

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

        // Calculate UV bounds in atlas (normalized 0-1 coordinates)
        const minU = albedoFrame.atlasPosition.x / atlasSize;
        const minV = albedoFrame.atlasPosition.y / atlasSize;
        const maxU =
          (albedoFrame.atlasPosition.x + albedoFrame.size.x) / atlasSize;
        const maxV =
          (albedoFrame.atlasPosition.y + albedoFrame.size.y) / atlasSize;
        gl.uniform4f(u_uvBounds, minU, minV, maxU, maxV);

        // Bind normal texture if available
        if (sprite.textureMapKeys.normal) {
          const normalTextureMap = textureMapCache.get(
            sprite.textureMapKeys.normal,
          );
          if (normalTextureMap && normalTextureMap.packedFrames.length > 0) {
            const normalFrame = normalTextureMap.packedFrames.find(
              (f) => f.frameIndex === sprite.frame.normal,
            );
            if (normalFrame) {
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
                  (normalFrame.atlasPosition.x + normalFrame.size.x) /
                  atlasSize;
                const normalMaxV =
                  (normalFrame.atlasPosition.y + normalFrame.size.y) /
                  atlasSize;
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
                // No normal atlas texture available
                gl.uniform1i(u_hasNormal, 0);
              }
            } else {
              // Normal frame not found
              gl.uniform1i(u_hasNormal, 0);
            }
          } else {
            // No normal texture map found
            gl.uniform1i(u_hasNormal, 0);
          }
        } else {
          // Sprite has no normal texture key
          gl.uniform1i(u_hasNormal, 0);
        }

        // Set other channel flags (not yet implemented)
        gl.uniform1i(u_hasMaterial, 0);
        gl.uniform1i(u_hasEmission, 0);

        // Set sprite transformation uniforms
        // Pass 3D world position: (x, y=height/vertical, z)
        gl.uniform3f(
          u_spritePosition,
          spriteTransform.position.x,
          spriteTransform.z, // y component = vertical height (worldY)
          spriteTransform.position.y, // z component = worldZ
        );
        gl.uniform2f(
          u_spriteSize,
          albedoFrame.size.x * spriteTransform.scale.x,
          albedoFrame.size.y * spriteTransform.scale.y,
        );
        gl.uniform2f(u_anchor, sprite.anchor.x, sprite.anchor.y);
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

      // Restore depth mask state
      gl.depthMask(true);
    }
  }
}
