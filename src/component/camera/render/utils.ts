import { AtlasManagerT } from '../../atlas-manager';
import { CellMapT, rebuildDirtyChunks } from '../../cell-map';
import { LightT } from '../../light';
import { NexusT } from '../../nexus';
import { TextureMapT } from '../../texture-map';
import { TransformT } from '../../transform';
import { castTo } from '../../types';
import { ViewportT } from '../../viewport';
import { Vector3D } from '../../../math';
import { CameraT } from '../data';

// Light uniform location caches — keyed by camera component ID
const _ambientColor = new Map<number, WebGLUniformLocation | null>();
const _ambientBrightness = new Map<number, WebGLUniformLocation | null>();
const _numDirLights = new Map<number, WebGLUniformLocation | null>();
const _numPointLights = new Map<number, WebGLUniformLocation | null>();
const _numSpotLights = new Map<number, WebGLUniformLocation | null>();
const _dirLightDir = new Map<number, (WebGLUniformLocation | null)[]>();
const _dirLightColor = new Map<number, (WebGLUniformLocation | null)[]>();
const _dirLightBrightness = new Map<number, (WebGLUniformLocation | null)[]>();
const _pointLightPos = new Map<number, (WebGLUniformLocation | null)[]>();
const _pointLightColor = new Map<number, (WebGLUniformLocation | null)[]>();
const _pointLightBrightness = new Map<
  number,
  (WebGLUniformLocation | null)[]
>();
const _pointLightRadius = new Map<number, (WebGLUniformLocation | null)[]>();
const _pointLightHardness = new Map<number, (WebGLUniformLocation | null)[]>();
const _spotLightPos = new Map<number, (WebGLUniformLocation | null)[]>();
const _spotLightColor = new Map<number, (WebGLUniformLocation | null)[]>();
const _spotLightBrightness = new Map<number, (WebGLUniformLocation | null)[]>();
const _spotLightRadius = new Map<number, (WebGLUniformLocation | null)[]>();
const _spotLightHardness = new Map<number, (WebGLUniformLocation | null)[]>();

/** Pixels of overscan padding added to FBO dimensions (1px border each side). */
export const FBO_OVERSCAN_PX = 2;

/** Default ambient color when no lights are in the scene. */
const DEFAULT_AMBIENT_COLOR: [number, number, number] = [0.4, 0.4, 0.4];

/** Default directional light direction when no lights are in the scene. */
const DEFAULT_DIR_DIRECTION: [number, number, number] = [0.5, -0.7, 0.0];

/** Default directional light brightness when no lights are in the scene. */
const DEFAULT_DIR_BRIGHTNESS = 0.6;

export function cacheLightUniformLocations(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  cameraId: number,
): void {
  _ambientColor.set(cameraId, gl.getUniformLocation(program, 'u_ambientColor'));
  _ambientBrightness.set(
    cameraId,
    gl.getUniformLocation(program, 'u_ambientBrightness'),
  );
  _numDirLights.set(cameraId, gl.getUniformLocation(program, 'u_numDirLights'));
  _numPointLights.set(
    cameraId,
    gl.getUniformLocation(program, 'u_numPointLights'),
  );
  _numSpotLights.set(
    cameraId,
    gl.getUniformLocation(program, 'u_numSpotLights'),
  );

  const dirDir: (WebGLUniformLocation | null)[] = [];
  const dirColor: (WebGLUniformLocation | null)[] = [];
  const dirBrightness: (WebGLUniformLocation | null)[] = [];
  for (let i = 0; i < 4; i++) {
    dirDir[i] = gl.getUniformLocation(program, `u_dirLightDir[${i}]`);
    dirColor[i] = gl.getUniformLocation(program, `u_dirLightColor[${i}]`);
    dirBrightness[i] = gl.getUniformLocation(
      program,
      `u_dirLightBrightness[${i}]`,
    );
  }
  _dirLightDir.set(cameraId, dirDir);
  _dirLightColor.set(cameraId, dirColor);
  _dirLightBrightness.set(cameraId, dirBrightness);

  const ptPos: (WebGLUniformLocation | null)[] = [];
  const ptColor: (WebGLUniformLocation | null)[] = [];
  const ptBrightness: (WebGLUniformLocation | null)[] = [];
  const ptRadius: (WebGLUniformLocation | null)[] = [];
  const ptHardness: (WebGLUniformLocation | null)[] = [];
  const spPos: (WebGLUniformLocation | null)[] = [];
  const spColor: (WebGLUniformLocation | null)[] = [];
  const spBrightness: (WebGLUniformLocation | null)[] = [];
  const spRadius: (WebGLUniformLocation | null)[] = [];
  const spHardness: (WebGLUniformLocation | null)[] = [];
  for (let i = 0; i < 8; i++) {
    ptPos[i] = gl.getUniformLocation(program, `u_pointLightPos[${i}]`);
    ptColor[i] = gl.getUniformLocation(program, `u_pointLightColor[${i}]`);
    ptBrightness[i] = gl.getUniformLocation(
      program,
      `u_pointLightBrightness[${i}]`,
    );
    ptRadius[i] = gl.getUniformLocation(program, `u_pointLightRadius[${i}]`);
    ptHardness[i] = gl.getUniformLocation(
      program,
      `u_pointLightHardness[${i}]`,
    );
    spPos[i] = gl.getUniformLocation(program, `u_spotLightPos[${i}]`);
    spColor[i] = gl.getUniformLocation(program, `u_spotLightColor[${i}]`);
    spBrightness[i] = gl.getUniformLocation(
      program,
      `u_spotLightBrightness[${i}]`,
    );
    spRadius[i] = gl.getUniformLocation(program, `u_spotLightRadius[${i}]`);
    spHardness[i] = gl.getUniformLocation(program, `u_spotLightHardness[${i}]`);
  }
  _pointLightPos.set(cameraId, ptPos);
  _pointLightColor.set(cameraId, ptColor);
  _pointLightBrightness.set(cameraId, ptBrightness);
  _pointLightRadius.set(cameraId, ptRadius);
  _pointLightHardness.set(cameraId, ptHardness);
  _spotLightPos.set(cameraId, spPos);
  _spotLightColor.set(cameraId, spColor);
  _spotLightBrightness.set(cameraId, spBrightness);
  _spotLightRadius.set(cameraId, spRadius);
  _spotLightHardness.set(cameraId, spHardness);
}

export function clearLightUniformCache(cameraId: number): void {
  _ambientColor.delete(cameraId);
  _ambientBrightness.delete(cameraId);
  _numDirLights.delete(cameraId);
  _numPointLights.delete(cameraId);
  _numSpotLights.delete(cameraId);
  _dirLightDir.delete(cameraId);
  _dirLightColor.delete(cameraId);
  _dirLightBrightness.delete(cameraId);
  _pointLightPos.delete(cameraId);
  _pointLightColor.delete(cameraId);
  _pointLightBrightness.delete(cameraId);
  _pointLightRadius.delete(cameraId);
  _pointLightHardness.delete(cameraId);
  _spotLightPos.delete(cameraId);
  _spotLightColor.delete(cameraId);
  _spotLightBrightness.delete(cameraId);
  _spotLightRadius.delete(cameraId);
  _spotLightHardness.delete(cameraId);
}

/**
 * Snaps camera position to FBO pixel boundaries so the pixel grid
 * is locked to world space instead of screen space during panning.
 */
export function snapCameraPosition(
  camX: number,
  camY: number,
  pixelScale: number,
  zoom: number,
): { x: number; y: number; remainderX: number; remainderY: number } {
  if (pixelScale <= 1)
    return { x: camX, y: camY, remainderX: 0, remainderY: 0 };
  const snapSize = pixelScale / zoom;
  const snappedX = Math.floor(camX / snapSize) * snapSize;
  const snappedY = Math.floor(camY / snapSize) * snapSize;
  return {
    x: snappedX,
    y: snappedY,
    remainderX: camX - snappedX,
    remainderY: camY - snappedY,
  };
}

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
  subPixelOffset?: { remainderX: number; remainderY: number },
): void {
  // Bind default framebuffer (screen)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  // Reset viewport to full canvas size
  gl.viewport(0, 0, viewport.width, viewport.height);

  // Clear screen with viewport background color so edge gaps blend seamlessly
  gl.clearColor(
    viewport.backgroundColor.x,
    viewport.backgroundColor.y,
    viewport.backgroundColor.z,
    viewport.backgroundColor.w,
  );
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

  // Set UV scale and offset for world-locked pixelation with FBO overscan.
  // The FBO is 2 pixels larger per dimension. The padding is ASYMMETRIC:
  // - X: camera is at left edge (UV=0), +2 padding on RIGHT
  // - Y: camera is at top edge (UV=1 due to Y-flip), +2 padding on BOTTOM (UV=0 side)
  // u_uvScale maps the fullscreen quad to the unpadded viewport region.
  // u_uvOffset slides the sampling into the right/bottom padding as needed.
  const uUvScale = gl.getUniformLocation(postProgram, 'u_uvScale');
  const uUvOffset = gl.getUniformLocation(postProgram, 'u_uvOffset');

  const fboWidth = camera.glResources.baseResolution.width; // padded
  const fboHeight = camera.glResources.baseResolution.height; // padded
  const unpaddedWidth = fboWidth - FBO_OVERSCAN_PX;
  const unpaddedHeight = fboHeight - FBO_OVERSCAN_PX;

  // UV scale: map [0,1] quad UV to the unpadded viewport region
  gl.uniform2f(uUvScale, unpaddedWidth / fboWidth, unpaddedHeight / fboHeight);

  if (subPixelOffset && camera.pixelScale > 1) {
    const fboOffsetX =
      (subPixelOffset.remainderX * camera.zoom) / camera.pixelScale;
    const fboOffsetY =
      (subPixelOffset.remainderY * camera.zoom) / camera.pixelScale;
    // X: no border on left (camera edge), offset slides right into right padding
    // Y: skip 2-pixel bottom border, offset slides down into bottom padding
    gl.uniform2f(
      uUvOffset,
      fboOffsetX / fboWidth,
      (FBO_OVERSCAN_PX - fboOffsetY) / fboHeight,
    );
  } else {
    // No offset; X starts at 0 (camera edge), Y skips 2-pixel bottom border
    gl.uniform2f(uUvOffset, 0, FBO_OVERSCAN_PX / fboHeight);
  }

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
 * Renders all cell-maps using chunk-based batched rendering.
 * Each chunk has a pre-built mesh with hidden face culling and greedy meshing applied.
 * Indices are grouped by material for efficient multi-material draw calls.
 */
export function renderCellMaps(
  camera: CameraT,
  _viewport: ViewportT,
  cellMaps: CellMapT[],
  cameraTransform: TransformT,
  sceneRoot: NexusT,
  gl: WebGL2RenderingContext,
  textureMapCache: Map<string, TextureMapT>,
  lights: LightT[],
): void {
  const program = camera.glResources.unifiedProgram;
  if (!program) {
    console.warn('[camera] Unified shader program not initialized');
    return;
  }

  // Enable depth testing for 3D rendering with depth writes enabled
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LESS);
  gl.depthMask(true);

  // Enable backface culling
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);

  gl.useProgram(program);

  // Set render mode to 0 (cells)
  if (camera.glResources.renderModeLocation) {
    gl.uniform1i(camera.glResources.renderModeLocation, 0);
  }

  // Get attribute locations
  const aPosition = gl.getAttribLocation(program, 'a_position');
  const aNormal = gl.getAttribLocation(program, 'a_normal');
  const aUv = gl.getAttribLocation(program, 'a_uv');

  // Get uniform locations
  const uViewportSize = gl.getUniformLocation(program, 'u_viewportSize');
  const uCameraPosition = gl.getUniformLocation(program, 'u_cameraPosition');
  const uZoom = gl.getUniformLocation(program, 'u_zoom');
  const uCellSize = gl.getUniformLocation(program, 'u_cellSize');
  const uMapSize = gl.getUniformLocation(program, 'u_mapSize');
  const uAlbedoTexture = gl.getUniformLocation(program, 'u_albedoTexture');
  const uNormalTexture = gl.getUniformLocation(program, 'u_normalTexture');
  const uUvBounds = gl.getUniformLocation(program, 'u_uvBounds');
  const uNormalUVBounds = gl.getUniformLocation(program, 'u_normalUVBounds');
  const uTextureSize = gl.getUniformLocation(program, 'u_textureSize');
  const uHasNormal = gl.getUniformLocation(program, 'u_hasNormal');

  // Set constant uniforms
  const logicalWidth =
    camera.glResources.baseResolution.width * camera.pixelScale;
  const logicalHeight =
    camera.glResources.baseResolution.height * camera.pixelScale;
  gl.uniform2f(uViewportSize, logicalWidth, logicalHeight);

  const snapped = snapCameraPosition(
    cameraTransform.position.x,
    cameraTransform.position.z,
    camera.pixelScale,
    camera.zoom,
  );
  gl.uniform2f(uCameraPosition, snapped.x, snapped.y);
  gl.uniform1f(uZoom, camera.zoom);

  // Set dynamic light uniforms
  setLightUniforms(gl, camera.id!, lights);

  // Disable the UV attribute for chunk rendering (triplanar mapping doesn't use it)
  if (aUv >= 0) {
    gl.disableVertexAttribArray(aUv);
    gl.vertexAttrib2f(aUv, 0, 0);
  }

  // Get atlas manager for texture size
  // @ts-expect-error - Proxy methods exist at runtime
  const atlasManager = sceneRoot.getComponentByType(
    'atlas-manager',
    true,
  ) as AtlasManagerT | null;
  const atlasSize = atlasManager?.config.atlasSize ?? 1024;

  const BYTES_PER_VERTEX = 6 * 4; // 6 floats × 4 bytes (pos3 + normal3)

  // Render each cell-map
  for (const cellMap of cellMaps) {
    // Rebuild any dirty chunks
    rebuildDirtyChunks(cellMap);

    // Set per-cell-map uniforms
    gl.uniform3f(
      uCellSize,
      cellMap.cellSize.x,
      cellMap.cellSize.y,
      cellMap.cellSize.z,
    );
    gl.uniform3f(
      uMapSize,
      cellMap.mapSize.x,
      cellMap.mapSize.y,
      cellMap.mapSize.z,
    );

    let totalFaces = 0;
    let drawCalls = 0;

    // Render each chunk
    for (const chunk of cellMap.chunks) {
      if (chunk.faceCount === 0 || !chunk.vertices || !chunk.indices) continue;

      // Upload GPU buffers if needed
      if (!chunk.glVertexBuffer) {
        chunk.glVertexBuffer = gl.createBuffer();
      }
      if (!chunk.glIndexBuffer) {
        chunk.glIndexBuffer = gl.createBuffer();
      }

      // Upload vertex data (interleaved pos3+normal3)
      gl.bindBuffer(gl.ARRAY_BUFFER, chunk.glVertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, chunk.vertices, gl.STATIC_DRAW);

      // Upload index data
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, chunk.glIndexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, chunk.indices, gl.STATIC_DRAW);

      // Set vertex attribute pointers for interleaved layout
      gl.enableVertexAttribArray(aPosition);
      gl.vertexAttribPointer(
        aPosition,
        3,
        gl.FLOAT,
        false,
        BYTES_PER_VERTEX,
        0,
      );

      if (aNormal >= 0) {
        gl.enableVertexAttribArray(aNormal);
        gl.vertexAttribPointer(
          aNormal,
          3,
          gl.FLOAT,
          false,
          BYTES_PER_VERTEX,
          12,
        );
      }

      // Draw each material range
      for (const range of chunk.drawRanges) {
        const material = cellMap.materials[range.materialIndex];
        if (!material) continue;

        // Get albedo texture
        const albedoTextureMap = textureMapCache.get(material.albedoTextureKey);
        if (!albedoTextureMap || albedoTextureMap.packedFrames.length === 0)
          continue;

        const albedoFrame = albedoTextureMap.packedFrames[0];
        if (!albedoFrame) continue;

        const atlasTexture =
          camera.glResources.atlasTextures[albedoFrame.atlasIndex];
        if (!atlasTexture) continue;

        // Bind albedo texture
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, atlasTexture);
        gl.uniform1i(uAlbedoTexture, 0);

        // Set UV bounds and texture size
        const minU = albedoFrame.atlasPosition.x / atlasSize;
        const minV = albedoFrame.atlasPosition.y / atlasSize;
        const maxU =
          (albedoFrame.atlasPosition.x + albedoFrame.size.x) / atlasSize;
        const maxV =
          (albedoFrame.atlasPosition.y + albedoFrame.size.y) / atlasSize;
        gl.uniform4f(uUvBounds, minU, minV, maxU, maxV);
        gl.uniform2f(uTextureSize, albedoFrame.size.x, albedoFrame.size.y);

        // Bind normal texture if available
        const normalTextureMap = textureMapCache.get(material.normalTextureKey);
        if (normalTextureMap && normalTextureMap.packedFrames.length > 0) {
          const normalFrame = normalTextureMap.packedFrames[0];
          const normalAtlasTexture =
            camera.glResources.atlasTextures[normalFrame.atlasIndex];

          if (normalAtlasTexture) {
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, normalAtlasTexture);
            gl.uniform1i(uNormalTexture, 1);

            const normalMinU = normalFrame.atlasPosition.x / atlasSize;
            const normalMinV = normalFrame.atlasPosition.y / atlasSize;
            const normalMaxU =
              (normalFrame.atlasPosition.x + normalFrame.size.x) / atlasSize;
            const normalMaxV =
              (normalFrame.atlasPosition.y + normalFrame.size.y) / atlasSize;
            gl.uniform4f(
              uNormalUVBounds,
              normalMinU,
              normalMinV,
              normalMaxU,
              normalMaxV,
            );
            gl.uniform1i(uHasNormal, 1);
          } else {
            gl.uniform1i(uHasNormal, 0);
          }
        } else {
          gl.uniform1i(uHasNormal, 0);
        }

        // Draw this material's faces
        gl.drawElements(
          gl.TRIANGLES,
          range.indexCount,
          gl.UNSIGNED_INT,
          range.indexOffset * 4, // byte offset (Uint32 = 4 bytes per index)
        );
        drawCalls++;
      }

      totalFaces += chunk.faceCount;
    }
  }

  // Restore state for sprite rendering
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
}

/**
 * Sets light uniform values on the unified shader program.
 * Categorizes lights by type and uploads to GPU uniform arrays.
 * Uses module-level cached uniform locations (populated by cacheLightUniformLocations).
 * When no lights are present, applies defaults matching the old hardcoded values.
 */
export function setLightUniforms(
  gl: WebGL2RenderingContext,
  cameraId: number,
  lights: LightT[],
): void {
  // Accumulate ambient light (additive)
  const ambientColor = [0, 0, 0];
  let hasAmbient = false;

  const dirLights: LightT[] = [];
  const pointLights: { light: LightT; pos: Vector3D }[] = [];
  const spotLights: { light: LightT; pos: Vector3D }[] = [];

  for (const light of lights) {
    if (light.lightType === 'ambient') {
      ambientColor[0] += light.color.x * light.brightness;
      ambientColor[1] += light.color.y * light.brightness;
      ambientColor[2] += light.color.z * light.brightness;
      hasAmbient = true;
    } else if (light.lightType === 'directional') {
      dirLights.push(light);
    } else {
      // point or spot — need sibling transform for position
      const parent = light.parent;
      if (!parent || parent.type !== 'nexus') continue;
      const nexus = castTo<NexusT>(parent);
      // @ts-expect-error - Proxy methods exist at runtime
      const siblingTransform = nexus.getComponentByType(
        'transform',
        false,
      ) as TransformT | null;
      if (!siblingTransform) continue;
      const pos = siblingTransform.position;
      if (light.lightType === 'point') {
        pointLights.push({ light, pos });
      } else {
        spotLights.push({ light, pos });
      }
    }
  }

  const locAmbientColor = _ambientColor.get(cameraId)!;
  const locAmbientBrightness = _ambientBrightness.get(cameraId)!;
  const locNumDir = _numDirLights.get(cameraId)!;
  const locNumPoint = _numPointLights.get(cameraId)!;
  const locNumSpot = _numSpotLights.get(cameraId)!;
  const locDirDir = _dirLightDir.get(cameraId)!;
  const locDirColor = _dirLightColor.get(cameraId)!;
  const locDirBrightness = _dirLightBrightness.get(cameraId)!;
  const locPtPos = _pointLightPos.get(cameraId)!;
  const locPtColor = _pointLightColor.get(cameraId)!;
  const locPtBrightness = _pointLightBrightness.get(cameraId)!;
  const locPtRadius = _pointLightRadius.get(cameraId)!;
  const locPtHardness = _pointLightHardness.get(cameraId)!;
  const locSpPos = _spotLightPos.get(cameraId)!;
  const locSpColor = _spotLightColor.get(cameraId)!;
  const locSpBrightness = _spotLightBrightness.get(cameraId)!;
  const locSpRadius = _spotLightRadius.get(cameraId)!;
  const locSpHardness = _spotLightHardness.get(cameraId)!;

  // Apply defaults when no lights exist (matches old hardcoded values)
  if (lights.length === 0) {
    gl.uniform3f(locAmbientColor, ...DEFAULT_AMBIENT_COLOR);
    gl.uniform1f(locAmbientBrightness, 1.0);
    gl.uniform1i(locNumDir, 1);
    gl.uniform3fv(locDirDir[0], DEFAULT_DIR_DIRECTION);
    gl.uniform3fv(locDirColor[0], [1.0, 1.0, 1.0]);
    gl.uniform1fv(locDirBrightness[0], [DEFAULT_DIR_BRIGHTNESS]);
    gl.uniform1i(locNumPoint, 0);
    gl.uniform1i(locNumSpot, 0);
    return;
  }

  // Ambient
  if (hasAmbient) {
    gl.uniform3f(
      locAmbientColor,
      ambientColor[0],
      ambientColor[1],
      ambientColor[2],
    );
    gl.uniform1f(locAmbientBrightness, 1.0);
  } else {
    gl.uniform3f(locAmbientColor, 0.0, 0.0, 0.0);
    gl.uniform1f(locAmbientBrightness, 0.0);
  }

  // Directional lights (capped at 4)
  const numDir = Math.min(dirLights.length, 4);
  gl.uniform1i(locNumDir, numDir);
  for (let i = 0; i < numDir; i++) {
    const l = dirLights[i];
    gl.uniform3fv(locDirDir[i], [l.direction.x, l.direction.y, l.direction.z]);
    gl.uniform3fv(locDirColor[i], [l.color.x, l.color.y, l.color.z]);
    gl.uniform1fv(locDirBrightness[i], [l.brightness]);
  }

  // Point lights (capped at 8)
  const numPoint = Math.min(pointLights.length, 8);
  gl.uniform1i(locNumPoint, numPoint);
  for (let i = 0; i < numPoint; i++) {
    const { light: l, pos } = pointLights[i];
    gl.uniform3fv(locPtPos[i], [pos.x, pos.y, pos.z]);
    gl.uniform3fv(locPtColor[i], [l.color.x, l.color.y, l.color.z]);
    gl.uniform1fv(locPtBrightness[i], [l.brightness]);
    gl.uniform1fv(locPtRadius[i], [l.radius]);
    gl.uniform1fv(locPtHardness[i], [l.hardness]);
  }

  // Spot lights (capped at 8)
  const numSpot = Math.min(spotLights.length, 8);
  gl.uniform1i(locNumSpot, numSpot);
  for (let i = 0; i < numSpot; i++) {
    const { light: l, pos } = spotLights[i];
    gl.uniform3fv(locSpPos[i], [pos.x, pos.y, pos.z]);
    gl.uniform3fv(locSpColor[i], [l.color.x, l.color.y, l.color.z]);
    gl.uniform1fv(locSpBrightness[i], [l.brightness]);
    gl.uniform1fv(locSpRadius[i], [l.radius]);
    gl.uniform1fv(locSpHardness[i], [l.hardness]);
  }
}
