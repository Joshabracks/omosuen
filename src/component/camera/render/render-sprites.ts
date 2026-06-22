import { AtlasManagerT } from '../../atlas-manager';
import { CellMapT } from '../../cell-map';
import { LightT } from '../../light';
import { NexusT } from '../../nexus';
import type { SpriteT } from '../../sprite';
import { TextureMapT } from '../../texture-map';
import { TransformT } from '../../transform';
import { castTo } from '../../types';
import { ViewportT } from '../../viewport';
import { CameraT } from '../data';
import {
  FBO_OVERSCAN_PX,
  setAngleUniform,
  setLightUniforms,
} from './light-uniforms';

/** Default cell dimensions when no cell-maps are in the scene. */
const DEFAULT_CELL_SIZE_X = 32;
const DEFAULT_CELL_SIZE_Y = 16;
const DEFAULT_CELL_SIZE_Z = 32;

/** Default map dimension when no cell-maps provide actual dimensions. */
const DEFAULT_MAP_DIMENSION = 20;

/**
 * Attempts to bind a sprite's normal texture to TEXTURE1.
 * Sets u_hasNormal to 1 on success, 0 on any failure (early return).
 */
function bindNormalTexture(
  sprite: SpriteT,
  textureMapCache: Map<string, TextureMapT>,
  camera: CameraT,
  gl: WebGL2RenderingContext,
  u_normalTexture: WebGLUniformLocation | null,
  u_normalUVBounds: WebGLUniformLocation | null,
  u_hasNormal: WebGLUniformLocation | null,
  atlasSize: number,
): void {
  if (!sprite.textureMapKeys.normal) {
    gl.uniform1i(u_hasNormal, 0);
    return;
  }

  const normalTextureMap = textureMapCache.get(sprite.textureMapKeys.normal);
  if (!normalTextureMap || normalTextureMap.packedFrames.length === 0) {
    gl.uniform1i(u_hasNormal, 0);
    return;
  }

  const normalFrame = normalTextureMap.frameIndexMap.get(sprite.frame.normal);
  if (!normalFrame) {
    gl.uniform1i(u_hasNormal, 0);
    return;
  }

  const normalAtlasTexture =
    camera.glResources.atlasTextures[normalFrame.atlasIndex];
  if (!normalAtlasTexture) {
    gl.uniform1i(u_hasNormal, 0);
    return;
  }

  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, normalAtlasTexture);
  gl.uniform1i(u_normalTexture, 1);

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

  gl.uniform1i(u_hasNormal, 1);
}

/**
 * Renders sprites directly to screen at full resolution (no pixelation).
 * Sprites are depth-sorted against cell-maps using the FBO depth texture.
 */
export function renderSprites(
  camera: CameraT,
  viewport: ViewportT,
  sprites: SpriteT[],
  cellMaps: CellMapT[],
  transform: TransformT,
  sceneRoot: NexusT,
  gl: WebGL2RenderingContext,
  textureMapCache: Map<string, TextureMapT>,
  lights: LightT[],
  subPixelOffset: { remainderX: number; remainderY: number },
  sinA: number,
  heightScale: number,
): void {
  const program = camera.glResources.unifiedProgram;
  if (!program) {
    console.warn(
      `[camera] Camera '${camera.name}' unified shader program not initialized`,
    );
    return;
  }

  // Bind default framebuffer (screen) and set full-resolution viewport
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, viewport.width, viewport.height);

  // Calculate unified map bounds from all cell-maps for consistent depth sorting
  // Sprites need to use the maximum dimensions across all maps to ensure
  // they depth-sort correctly with all cell-maps in the scene
  let maxMapWidth = 0;
  let maxMapHeight = 0;
  let maxMapDepth = 0;
  let unifiedCellSizeX = DEFAULT_CELL_SIZE_X;
  let unifiedCellSizeY = DEFAULT_CELL_SIZE_Y;
  let unifiedCellSizeZ = DEFAULT_CELL_SIZE_Z;

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
  if (maxMapWidth === 0) maxMapWidth = DEFAULT_MAP_DIMENSION;
  if (maxMapHeight === 0) maxMapHeight = DEFAULT_MAP_DIMENSION;
  if (maxMapDepth === 0) maxMapDepth = DEFAULT_MAP_DIMENSION;

  // Enable blending so transparent sprite pixels show cells underneath
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  // Disable hardware depth test — occlusion is handled in the fragment
  // shader by sampling the cell FBO's depth texture
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
  const a_position = gl.getAttribLocation(program, 'a_position');
  const a_uv = gl.getAttribLocation(program, 'a_uv');
  const u_viewportSize = gl.getUniformLocation(program, 'u_viewportSize');
  const u_cameraPosition = gl.getUniformLocation(program, 'u_cameraPosition');
  const u_zoom = gl.getUniformLocation(program, 'u_zoom');
  const u_cellSize = gl.getUniformLocation(program, 'u_cellSize');
  const u_mapSize = gl.getUniformLocation(program, 'u_mapSize');
  const u_spritePosition = gl.getUniformLocation(program, 'u_spritePosition');
  const u_spriteSize = gl.getUniformLocation(program, 'u_spriteSize');
  const u_anchor = gl.getUniformLocation(program, 'u_anchor');
  const u_rotation = gl.getUniformLocation(program, 'u_rotation');
  const u_albedoTexture = gl.getUniformLocation(program, 'u_albedoTexture');
  const u_normalTexture = gl.getUniformLocation(program, 'u_normalTexture');
  const u_hasNormal = gl.getUniformLocation(program, 'u_hasNormal');
  const u_hasMaterial = gl.getUniformLocation(program, 'u_hasMaterial');
  const u_hasEmission = gl.getUniformLocation(program, 'u_hasEmission');
  const u_tint = gl.getUniformLocation(program, 'u_tint');
  const u_opacity = gl.getUniformLocation(program, 'u_opacity');
  const u_uvBounds = gl.getUniformLocation(program, 'u_uvBounds');
  const u_normalUVBounds = gl.getUniformLocation(program, 'u_normalUVBounds');
  const u_depthTexture = gl.getUniformLocation(program, 'u_depthTexture');
  const u_fboUvScale = gl.getUniformLocation(program, 'u_fboUvScale');
  const u_fboUvOffset = gl.getUniformLocation(program, 'u_fboUvOffset');
  const u_screenSize = gl.getUniformLocation(program, 'u_screenSize');
  const u_showSilhouette = gl.getUniformLocation(program, 'u_showSilhouette');
  const u_silhouetteColor = gl.getUniformLocation(program, 'u_silhouetteColor');
  const u_hasVisibilityMask = gl.getUniformLocation(
    program,
    'u_hasVisibilityMask',
  );
  const u_cellSolidity = gl.getUniformLocation(program, 'u_cellSolidity');
  const u_revealTarget = gl.getUniformLocation(program, 'u_revealTarget');

  // Set constant uniforms (same for all sprites)
  // Sprites render at full resolution to screen (not via FBO), so they use
  // the raw camera position for smooth movement instead of the snapped position.
  gl.uniform2f(
    u_viewportSize,
    viewport.width / camera.zoom,
    viewport.height / camera.zoom,
  );
  // Project camera 3D world position to 2D axonometric space
  // (same projection the vertex shader applies to every world position)
  const ISO_H = 0.8660254; // cos(30deg) — constant horizontal spread
  const camIsoX = transform.position.x * ISO_H - transform.position.z * ISO_H;
  const camIsoY =
    transform.position.x * sinA -
    transform.position.y * heightScale +
    transform.position.z * sinA;
  gl.uniform2f(u_cameraPosition, camIsoX, camIsoY);
  gl.uniform1f(u_zoom, camera.zoom);
  gl.uniform3f(
    u_cellSize,
    unifiedCellSizeX,
    unifiedCellSizeY,
    unifiedCellSizeZ,
  );
  gl.uniform3f(u_mapSize, maxMapWidth, maxMapHeight, maxMapDepth);

  // Set dynamic light uniforms (same lights as cell-maps)
  setLightUniforms(gl, camera.id!, lights);

  // Set axonometric angle uniform (GPU computes cos/sin)
  setAngleUniform(gl, camera.id!, camera.axonometricAngle);

  // Bind cell FBO depth texture for occlusion masking
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, camera.glResources.depthTexture);
  gl.uniform1i(u_depthTexture, 2);

  // Pass FBO UV mapping so the sprite shader can sample the depth texture
  // Uses the same UV transform as the post-process shader
  const fboWidth = camera.glResources.baseResolution.width;
  const fboHeight = camera.glResources.baseResolution.height;
  const unpaddedWidth = fboWidth - FBO_OVERSCAN_PX;
  const unpaddedHeight = fboHeight - FBO_OVERSCAN_PX;
  gl.uniform2f(
    u_fboUvScale,
    unpaddedWidth / fboWidth,
    unpaddedHeight / fboHeight,
  );

  const fboOffsetX =
    camera.pixelScale > 1
      ? (subPixelOffset.remainderX * camera.zoom) / camera.pixelScale
      : 0;
  const fboOffsetY =
    camera.pixelScale > 1
      ? (subPixelOffset.remainderY * camera.zoom) / camera.pixelScale
      : 0;
  gl.uniform2f(
    u_fboUvOffset,
    fboOffsetX / fboWidth,
    (2 - fboOffsetY) / fboHeight,
  );
  gl.uniform2f(u_screenSize, viewport.width, viewport.height);

  // Bind cell solidity texture and reveal target for per-fragment raycasting
  if (camera.revealTarget && camera.glResources.visibilityTexture) {
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, camera.glResources.visibilityTexture);
    gl.uniform1i(u_cellSolidity, 3);
    gl.uniform3f(
      u_revealTarget,
      camera.revealTarget.x,
      camera.revealTarget.y,
      camera.revealTarget.z,
    );
    gl.uniform1i(u_hasVisibilityMask, 1);
  } else {
    gl.uniform1i(u_hasVisibilityMask, 0);
  }

  // Disable cell-only attributes that may be left enabled from cell rendering
  const a_origPosition = gl.getAttribLocation(program, 'a_origPosition');
  if (a_origPosition >= 0) {
    gl.disableVertexAttribArray(a_origPosition);
    gl.vertexAttrib3f(a_origPosition, 0, 0, 0);
  }

  // Bind vertex buffers (shared for all sprites)
  gl.bindBuffer(gl.ARRAY_BUFFER, camera.glResources.quadVertexBuffer);
  gl.enableVertexAttribArray(a_position);
  gl.vertexAttribPointer(a_position, 2, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, camera.glResources.quadUVBuffer);
  gl.enableVertexAttribArray(a_uv);
  gl.vertexAttribPointer(a_uv, 2, gl.FLOAT, false, 0, 0);

  // Get atlas manager for texture size
  const atlasManager = sceneRoot.getComponentByType(
    'atlas-manager',
    true,
  ) as AtlasManagerT | null;
  const atlasSize = atlasManager?.config.atlasSize ?? 1024;

  // Render each sprite
  for (const sprite of sprites) {
    // Skip hidden sprites entirely (no draw call). Use `=== false` so any legacy
    // sprite lacking the field still renders.
    if (sprite.visible === false) continue;

    // Get sprite's parent nexus
    if (!sprite.parent || sprite.parent.type !== 'nexus') continue;
    const spriteNexus = castTo<NexusT>(sprite.parent);

    // Get sprite transform (sibling component)
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
    const albedoTextureMap = textureMapCache.get(sprite.textureMapKeys.albedo);
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
    const albedoFrame = albedoTextureMap.frameIndexMap.get(sprite.frame.albedo);
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
    const maxU = (albedoFrame.atlasPosition.x + albedoFrame.size.x) / atlasSize;
    const maxV = (albedoFrame.atlasPosition.y + albedoFrame.size.y) / atlasSize;
    gl.uniform4f(u_uvBounds, minU, minV, maxU, maxV);

    // Bind normal texture if available
    bindNormalTexture(
      sprite,
      textureMapCache,
      camera,
      gl,
      u_normalTexture,
      u_normalUVBounds,
      u_hasNormal,
      atlasSize,
    );

    // Set other channel flags (not yet implemented)
    gl.uniform1i(u_hasMaterial, 0);
    gl.uniform1i(u_hasEmission, 0);

    // Set sprite transformation uniforms
    // Pass 3D world position: (x, y=height, z=depth)
    gl.uniform3f(
      u_spritePosition,
      spriteTransform.position.x,
      spriteTransform.position.y,
      spriteTransform.position.z,
    );
    gl.uniform2f(
      u_spriteSize,
      albedoFrame.size.x * spriteTransform.scale.x,
      albedoFrame.size.y * spriteTransform.scale.y,
    );
    gl.uniform2f(u_anchor, sprite.anchor.x, sprite.anchor.y);
    gl.uniform1f(u_rotation, spriteTransform.rotation.y);

    // Set sprite appearance uniforms
    gl.uniform4f(
      u_tint,
      sprite.tint.x,
      sprite.tint.y,
      sprite.tint.z,
      sprite.tint.w,
    );
    gl.uniform1f(u_opacity, sprite.opacity);

    // Set silhouette uniforms
    gl.uniform1i(u_showSilhouette, sprite.showSilhouette ? 1 : 0);
    if (sprite.showSilhouette) {
      gl.uniform4f(
        u_silhouetteColor,
        sprite.silhouetteColor.x,
        sprite.silhouetteColor.y,
        sprite.silhouetteColor.z,
        sprite.silhouetteColor.w,
      );
    }

    // Draw the sprite quad (6 vertices = 2 triangles)
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  // Restore depth mask state
  gl.depthMask(true);

  // Unbind depth texture from TEXTURE2 to prevent feedback loop on next frame.
  // The FBO uses this same texture as its depth attachment — if it's still bound
  // as a sampler when we bindFramebuffer for cell rendering, WebGL silently fails.
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, null);
}
