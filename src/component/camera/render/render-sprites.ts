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
  setOrbitYawUniform,
  setLightUniforms,
} from './light-uniforms';

/** Default cell dimensions when no cell-maps are in the scene. */
const DEFAULT_CELL_SIZE_X = 32;
const DEFAULT_CELL_SIZE_Y = 16;
const DEFAULT_CELL_SIZE_Z = 32;

/** Default map dimension when no cell-maps provide actual dimensions. */
const DEFAULT_MAP_DIMENSION = 20;

/**
 * World-unit padding applied to the camera-relative off-screen reject below,
 * so a sprite whose transform anchor sits just outside the viewport but
 * still has visible pixels on-screen isn't dropped. Separate from
 * transform/on-screen.ts's EDGE_PAD_PX (screen pixels, different consumer) --
 * a tunable starting default, not derived from real asset data, same status
 * as that constant. See
 * .design/spike_scene-graph-traversal/04-presentation-layer-visibility-skip/03-render-collection-visibility-split.md.
 */
const EDGE_PAD_WORLD = 64;

// Reused scratch buffers for the per-frame back-to-front depth sort. Parallel arrays
// (not an array of objects) grown only to the high-water sprite count, so steady-state
// rendering allocates nothing — no GC churn.
const _drawSprites: SpriteT[] = [];
const _drawTransforms: TransformT[] = [];
const _drawDepths: number[] = [];

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
 * Attempts to bind a sprite's emission texture to TEXTURE4.
 * Sets u_hasEmission to 1 on success, 0 on any failure (early return).
 */
function bindEmissionTexture(
  sprite: SpriteT,
  textureMapCache: Map<string, TextureMapT>,
  camera: CameraT,
  gl: WebGL2RenderingContext,
  u_emissionTexture: WebGLUniformLocation | null,
  u_emissionUVBounds: WebGLUniformLocation | null,
  u_hasEmission: WebGLUniformLocation | null,
  atlasSize: number,
): void {
  if (!sprite.textureMapKeys.emission) {
    gl.uniform1i(u_hasEmission, 0);
    return;
  }

  const emissionTextureMap = textureMapCache.get(
    sprite.textureMapKeys.emission,
  );
  if (!emissionTextureMap || emissionTextureMap.packedFrames.length === 0) {
    gl.uniform1i(u_hasEmission, 0);
    return;
  }

  const emissionFrame = emissionTextureMap.frameIndexMap.get(
    sprite.frame.emission,
  );
  if (!emissionFrame) {
    gl.uniform1i(u_hasEmission, 0);
    return;
  }

  const emissionAtlasTexture =
    camera.glResources.atlasTextures[emissionFrame.atlasIndex];
  if (!emissionAtlasTexture) {
    gl.uniform1i(u_hasEmission, 0);
    return;
  }

  gl.activeTexture(gl.TEXTURE4);
  gl.bindTexture(gl.TEXTURE_2D, emissionAtlasTexture);
  gl.uniform1i(u_emissionTexture, 4);

  const emissionMinU = emissionFrame.atlasPosition.x / atlasSize;
  const emissionMinV = emissionFrame.atlasPosition.y / atlasSize;
  const emissionMaxU =
    (emissionFrame.atlasPosition.x + emissionFrame.size.x) / atlasSize;
  const emissionMaxV =
    (emissionFrame.atlasPosition.y + emissionFrame.size.y) / atlasSize;
  gl.uniform4f(
    u_emissionUVBounds,
    emissionMinU,
    emissionMinV,
    emissionMaxU,
    emissionMaxV,
  );

  gl.uniform1i(u_hasEmission, 1);
}

/**
 * Attempts to bind a sprite's material (metallic/roughness) texture to TEXTURE5.
 * Sets u_hasMaterial to 1 on success, 0 on any failure (early return).
 */
function bindMaterialTexture(
  sprite: SpriteT,
  textureMapCache: Map<string, TextureMapT>,
  camera: CameraT,
  gl: WebGL2RenderingContext,
  u_materialTexture: WebGLUniformLocation | null,
  u_materialUVBounds: WebGLUniformLocation | null,
  u_hasMaterial: WebGLUniformLocation | null,
  atlasSize: number,
): void {
  if (!sprite.textureMapKeys.material) {
    gl.uniform1i(u_hasMaterial, 0);
    return;
  }

  const materialTextureMap = textureMapCache.get(
    sprite.textureMapKeys.material,
  );
  if (!materialTextureMap || materialTextureMap.packedFrames.length === 0) {
    gl.uniform1i(u_hasMaterial, 0);
    return;
  }

  const materialFrame = materialTextureMap.frameIndexMap.get(
    sprite.frame.material,
  );
  if (!materialFrame) {
    gl.uniform1i(u_hasMaterial, 0);
    return;
  }

  const materialAtlasTexture =
    camera.glResources.atlasTextures[materialFrame.atlasIndex];
  if (!materialAtlasTexture) {
    gl.uniform1i(u_hasMaterial, 0);
    return;
  }

  gl.activeTexture(gl.TEXTURE5);
  gl.bindTexture(gl.TEXTURE_2D, materialAtlasTexture);
  gl.uniform1i(u_materialTexture, 5);

  const materialMinU = materialFrame.atlasPosition.x / atlasSize;
  const materialMinV = materialFrame.atlasPosition.y / atlasSize;
  const materialMaxU =
    (materialFrame.atlasPosition.x + materialFrame.size.x) / atlasSize;
  const materialMaxV =
    (materialFrame.atlasPosition.y + materialFrame.size.y) / atlasSize;
  gl.uniform4f(
    u_materialUVBounds,
    materialMinU,
    materialMinV,
    materialMaxU,
    materialMaxV,
  );

  gl.uniform1i(u_hasMaterial, 1);
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
  cosYaw: number,
  sinYaw: number,
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
  const u_windowSize = gl.getUniformLocation(program, 'u_windowSize');
  const u_worldOffset = gl.getUniformLocation(program, 'u_worldOffset');
  const u_spritePosition = gl.getUniformLocation(program, 'u_spritePosition');
  const u_spriteSize = gl.getUniformLocation(program, 'u_spriteSize');
  const u_anchor = gl.getUniformLocation(program, 'u_anchor');
  const u_rotation = gl.getUniformLocation(program, 'u_rotation');
  const u_albedoTexture = gl.getUniformLocation(program, 'u_albedoTexture');
  const u_normalTexture = gl.getUniformLocation(program, 'u_normalTexture');
  const u_hasNormal = gl.getUniformLocation(program, 'u_hasNormal');
  const u_materialTexture = gl.getUniformLocation(program, 'u_materialTexture');
  const u_emissionTexture = gl.getUniformLocation(program, 'u_emissionTexture');
  const u_hasMaterial = gl.getUniformLocation(program, 'u_hasMaterial');
  const u_hasEmission = gl.getUniformLocation(program, 'u_hasEmission');
  const u_materialUVBounds = gl.getUniformLocation(
    program,
    'u_materialUVBounds',
  );
  const u_emissionUVBounds = gl.getUniformLocation(
    program,
    'u_emissionUVBounds',
  );
  const u_emissionIntensity = gl.getUniformLocation(
    program,
    'u_emissionIntensity',
  );
  const u_emissionColor = gl.getUniformLocation(program, 'u_emissionColor');
  const u_cameraWorldPos = gl.getUniformLocation(program, 'u_cameraWorldPos');
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
  const u_cellEmissionColor = gl.getUniformLocation(
    program,
    'u_cellEmissionColor',
  );
  const u_hasCellEmissionColor = gl.getUniformLocation(
    program,
    'u_hasCellEmissionColor',
  );

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
  // Camera uses its cached WORLD position (composed up the ancestry by
  // updateWorldTransforms), so a nested camera nexus offsets the view.
  const camPos = transform.worldPosition;
  const camRx = camPos.x * cosYaw + camPos.z * sinYaw;
  const camRz = -camPos.x * sinYaw + camPos.z * cosYaw;
  const camIsoX = camRx * ISO_H - camRz * ISO_H;
  const camIsoY = camRx * sinA - camPos.y * heightScale + camRz * sinA;
  gl.uniform2f(u_cameraPosition, camIsoX, camIsoY);
  // Real 3D world-space camera position (distinct from the 2D iso-projected
  // u_cameraPosition above) — used to build the view direction for specular.
  gl.uniform3f(u_cameraWorldPos, camPos.x, camPos.y, camPos.z);
  gl.uniform1f(u_zoom, camera.zoom);
  gl.uniform3f(
    u_cellSize,
    unifiedCellSizeX,
    unifiedCellSizeY,
    unifiedCellSizeZ,
  );
  gl.uniform3f(u_windowSize, maxMapWidth, maxMapHeight, maxMapDepth);
  // Sprites have no shiftable cell-window origin, so this stays (0,0,0) --
  // see the depth-bias comment in unified.vert.
  gl.uniform3f(u_worldOffset, 0, 0, 0);

  // Set dynamic light uniforms (same lights as cell-maps)
  setLightUniforms(gl, camera.id!, lights);

  // Set axonometric angle + orbit yaw uniforms (GPU computes cos/sin)
  setAngleUniform(gl, camera.id!, camera.axonometricAngle);
  setOrbitYawUniform(gl, camera.id!, camera.orbitYaw);

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

  // Bind cell solidity texture and reveal target for per-fragment raycasting.
  // Unit 3 is always pinned, even when there's no reveal target this frame --
  // a sampler uniform that's never explicitly set defaults to unit 0, which
  // u_albedoTexture (sampler2D) also uses; since u_cellSolidity is
  // sampler2DArray, a defaulted/stale unit-0 assignment throws
  // GL_INVALID_OPERATION ("two textures of different types use the same
  // sampler location") the moment both uniforms have ever been set anywhere
  // in this shared program.
  gl.activeTexture(gl.TEXTURE3);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, camera.glResources.visibilityTexture);
  gl.uniform1i(u_cellSolidity, 3);
  if (camera.revealTarget && camera.glResources.visibilityTexture) {
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

  // Same reasoning as u_cellSolidity above -- always pin u_cellEmissionColor
  // (also sampler2DArray) to unit 6, matching the unit render-cell-maps.ts
  // uses for it. Scenes with no cell-maps never run renderCellMaps, so
  // without this the uniform would default to unit 0 and collide with
  // u_albedoTexture (sampler2D) on every sprite draw.
  gl.activeTexture(gl.TEXTURE6);
  gl.bindTexture(
    gl.TEXTURE_2D_ARRAY,
    camera.glResources.cellEmissionColorTexture,
  );
  gl.uniform1i(u_cellEmissionColor, 6);
  if (
    camera.glResources.cellEmissionColorHasAny &&
    camera.glResources.cellEmissionColorTexture
  ) {
    gl.uniform1i(u_hasCellEmissionColor, 1);
  } else {
    gl.uniform1i(u_hasCellEmissionColor, 0);
  }

  // Disable cell-only attributes that may be left enabled from cell rendering
  const a_origPosition = gl.getAttribLocation(program, 'a_origPosition');
  if (a_origPosition >= 0) {
    gl.disableVertexAttribArray(a_origPosition);
    gl.vertexAttrib3f(a_origPosition, 0, 0, 0);
  }
  const a_emission = gl.getAttribLocation(program, 'a_emission');
  if (a_emission >= 0) {
    gl.disableVertexAttribArray(a_emission);
    gl.vertexAttrib1f(a_emission, 0);
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

  // Build the draw list into reused scratch arrays: apply the per-sprite skip checks
  // (hidden / no nexus parent / no transform), carry the transform, and compute each
  // sprite's axonometric depth (matches the vertex shader: rx + heightScale*y + rz,
  // where rx/rz are worldX/Z rotated by orbit yaw).
  let drawCount = 0;
  for (const sprite of sprites) {
    // Use `=== false` so any legacy sprite lacking the field still renders.
    if (sprite.visible === false) continue;
    if (!sprite.parent || sprite.parent.type !== 'nexus') continue;
    const t = castTo<NexusT>(sprite.parent).getComponentByType(
      'transform',
      false,
    ) as TransformT | null;
    if (!t) continue;
    // World position (cached) so a sprite under a transformed parent nexus is
    // placed/sorted by its composed world transform.
    const p = t.worldPosition;
    const pRx = p.x * cosYaw + p.z * sinYaw;
    const pRz = -p.x * sinYaw + p.z * cosYaw;

    // Camera-relative off-screen reject. Reuses this frame's already-computed
    // camIsoX/camIsoY (this camera's own iso-projected position, set above)
    // instead of routing through transform/on-screen.ts's resolveProjection/
    // worldToScreen, which would redundantly re-derive the same numbers
    // inside the hottest per-sprite loop in the renderer. Deliberately not
    // done in collect-renderables (see that module's comment) -- camera
    // position isn't tracked by the version-counter cache collection relies
    // on, so this filter must be re-evaluated fresh every draw, every frame.
    const isoX = ISO_H * (pRx - pRz);
    const isoY = sinA * (pRx + pRz) - heightScale * p.y;
    const halfW = viewport.width / (2 * camera.zoom) + EDGE_PAD_WORLD;
    const halfH = viewport.height / (2 * camera.zoom) + EDGE_PAD_WORLD;
    if (Math.abs(isoX - camIsoX) > halfW || Math.abs(isoY - camIsoY) > halfH) {
      continue;
    }

    _drawSprites[drawCount] = sprite;
    _drawTransforms[drawCount] = t;
    _drawDepths[drawCount] = pRx + heightScale * p.y + pRz;
    drawCount++;
  }

  // Sprite-vs-sprite order is pure draw order (the sprite pass has the depth test
  // disabled). Stable-sort back-to-front by depth (larger depth = nearer the camera =
  // drawn last/on top). In-place insertion sort over the parallel arrays: no temp
  // array / closures (zero GC), and ~O(n) frame-to-frame when depth order is mostly
  // stable (static sprites + unchanged/slowly-orbiting camera keep their relative
  // order). A large single-frame orbitYaw jump can reorder many sprites at once,
  // temporarily costing more swaps — still correct, just not the O(n) common case.
  // Strict `>` keeps it stable, so a composited entity's layers (equal depth)
  // preserve their segmentedRenderOrderSort renderOrder.
  for (let i = 1; i < drawCount; i++) {
    const s = _drawSprites[i];
    const st = _drawTransforms[i];
    const sd = _drawDepths[i];
    let j = i - 1;
    while (j >= 0 && _drawDepths[j] > sd) {
      _drawSprites[j + 1] = _drawSprites[j];
      _drawTransforms[j + 1] = _drawTransforms[j];
      _drawDepths[j + 1] = _drawDepths[j];
      j--;
    }
    _drawSprites[j + 1] = s;
    _drawTransforms[j + 1] = st;
    _drawDepths[j + 1] = sd;
  }

  // Render each sprite (back-to-front)
  for (let di = 0; di < drawCount; di++) {
    const sprite = _drawSprites[di];
    const spriteTransform = _drawTransforms[di];

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

    // Bind emission texture if available
    bindEmissionTexture(
      sprite,
      textureMapCache,
      camera,
      gl,
      u_emissionTexture,
      u_emissionUVBounds,
      u_hasEmission,
      atlasSize,
    );

    // Bind material (metallic/roughness) texture if available
    bindMaterialTexture(
      sprite,
      textureMapCache,
      camera,
      gl,
      u_materialTexture,
      u_materialUVBounds,
      u_hasMaterial,
      atlasSize,
    );

    // Set sprite transformation uniforms from the cached WORLD transform (composed
    // up the ancestry), so nesting under a transformed parent moves/scales/rotates it.
    const sWorldPos = spriteTransform.worldPosition;
    const sWorldScale = spriteTransform.worldScale;
    gl.uniform3f(u_spritePosition, sWorldPos.x, sWorldPos.y, sWorldPos.z);
    gl.uniform2f(
      u_spriteSize,
      albedoFrame.size.x * sWorldScale.x,
      albedoFrame.size.y * sWorldScale.y,
    );
    // Normalize the pixel anchor (from the frame's top-left) to [0,1] for the shader,
    // which re-bases the centered quad around it (anchor pixel lands on the transform).
    gl.uniform2f(
      u_anchor,
      albedoFrame.size.x !== 0 ? sprite.anchor.x / albedoFrame.size.x : 0.5,
      albedoFrame.size.y !== 0 ? sprite.anchor.y / albedoFrame.size.y : 0.5,
    );
    gl.uniform1f(u_rotation, spriteTransform.worldRotation.y);

    // Set sprite appearance uniforms
    gl.uniform4f(
      u_tint,
      sprite.tint.x,
      sprite.tint.y,
      sprite.tint.z,
      sprite.tint.w,
    );
    gl.uniform1f(u_opacity, sprite.opacity);

    // Set emission uniforms
    gl.uniform1f(u_emissionIntensity, sprite.emissionIntensity);
    gl.uniform3f(
      u_emissionColor,
      sprite.emissionColor.x,
      sprite.emissionColor.y,
      sprite.emissionColor.z,
    );

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
