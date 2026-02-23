import { AtlasManagerT } from '../../atlas-manager';
import { CellMapT, rebuildDirtyChunks } from '../../cell-map';
import { LightT } from '../../light';
import { NexusT } from '../../nexus';
import { TextureMapT } from '../../texture-map';
import { TransformT } from '../../transform';
import { CameraT } from '../data';
import { setLightUniforms } from './light-uniforms';
import { computeVisibilityMask } from './visibility-mask';

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
 * Uploads a per-cell visibility mask as a flattened 2D R8 texture.
 * Texture layout: width = mapX, height = mapY * mapZ.
 * Texel at (x, y + z * mapY) → cell (x, y, z).
 */
function uploadVisibilityTexture(
  gl: WebGL2RenderingContext,
  camera: CameraT,
  mask: Uint8Array,
  mapSize: { x: number; y: number; z: number },
): void {
  if (!camera.glResources.visibilityTexture) {
    camera.glResources.visibilityTexture = gl.createTexture();
  }

  gl.activeTexture(gl.TEXTURE3);
  gl.bindTexture(gl.TEXTURE_2D, camera.glResources.visibilityTexture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.R8,
    mapSize.x,
    mapSize.y * mapSize.z,
    0,
    gl.RED,
    gl.UNSIGNED_BYTE,
    mask,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

/**
 * Renders all cell-maps using chunk-based batched rendering.
 * Each chunk has a pre-built mesh with hidden face culling and greedy meshing applied.
 * Indices are grouped by material for efficient multi-material draw calls.
 */
export function renderCellMaps(
  camera: CameraT,
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

  // Visibility mask uniform locations
  const uHasVisibilityMask = gl.getUniformLocation(
    program,
    'u_hasVisibilityMask',
  );
  const uVisibilityMask = gl.getUniformLocation(program, 'u_visibilityMask');

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

    // Visibility mask clipping (per cell-map — respects revealExempt)
    if (camera.revealTarget && !cellMap.revealExempt) {
      // Recompute mask when reveal target crosses a cell boundary
      const cx = Math.floor(camera.revealTarget.x / cellMap.cellSize.x);
      const cy = Math.floor(camera.revealTarget.y / cellMap.cellSize.y);
      const cz = Math.floor(camera.revealTarget.z / cellMap.cellSize.z);

      const last = camera.glResources.lastRevealCell;
      if (!last || last.x !== cx || last.y !== cy || last.z !== cz) {
        camera.glResources.lastRevealCell = { x: cx, y: cy, z: cz };

        const mask = computeVisibilityMask(
          cellMap.packedData,
          cellMap.mapSize,
          { x: cx, y: cy, z: cz },
        );
        uploadVisibilityTexture(gl, camera, mask, cellMap.mapSize);
      }

      // Bind visibility texture
      if (camera.glResources.visibilityTexture) {
        gl.activeTexture(gl.TEXTURE3);
        gl.bindTexture(gl.TEXTURE_2D, camera.glResources.visibilityTexture);
        gl.uniform1i(uVisibilityMask, 3);
        gl.uniform1i(uHasVisibilityMask, 1);
      } else {
        gl.uniform1i(uHasVisibilityMask, 0);
      }
    } else {
      gl.uniform1i(uHasVisibilityMask, 0);
    }

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
