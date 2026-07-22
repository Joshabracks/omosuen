import { AtlasManagerT } from '../../atlas-manager';
import { CellMapT, rebuildDirtyChunks } from '../../cell-map';
import { LightT } from '../../light';
import { NexusT } from '../../nexus';
import { TextureMapT } from '../../texture-map';
import { TransformT } from '../../transform';
import { CameraT } from '../data';
import {
  setAngleUniform,
  setOrbitYawUniform,
  setLightUniforms,
} from './light-uniforms';
import { computeSolidityMap } from './visibility-mask';

/** A resolved atlas frame: normalized UV bounds, pixel size, and atlas page. */
interface ResolvedFrame {
  bounds: [number, number, number, number];
  size: [number, number];
  atlasIndex: number;
}

/** Warn-once guard for per-side frames that resolve to a different atlas page. */
let warnedCrossAtlasFrame = false;

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
  // The R8 mask is tightly packed; default UNPACK_ALIGNMENT (4) would expect each
  // row padded to a multiple of 4 bytes and reject maps whose width isn't a multiple
  // of 4 ("ArrayBufferView not big enough"). Force tight row packing.
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
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
 * Builds the RGBA8 per-cell emission-color texture data from a cell-map's
 * `emissionColorMap` (packed (r<<16)|(g<<8)|b), flattened `x` + `y·mapX` +
 * `z·mapX·mapY` — the same order the fragment shader unflattens in
 * `cellEmissionColorAt`. Returns the byte buffer and whether any cell is non-black
 * (so an all-black map skips upload + shader term entirely).
 */
function buildCellEmissionColorBytes(cellMap: CellMapT): {
  bytes: Uint8Array;
  hasAny: boolean;
} {
  const packed = cellMap.emissionColorMap.value;
  const bytes = new Uint8Array(packed.length * 4);
  let hasAny = false;
  for (let i = 0; i < packed.length; i++) {
    const p = packed[i] | 0;
    if (p !== 0) hasAny = true;
    bytes[i * 4] = (p >> 16) & 0xff;
    bytes[i * 4 + 1] = (p >> 8) & 0xff;
    bytes[i * 4 + 2] = p & 0xff;
    bytes[i * 4 + 3] = 255;
  }
  return { bytes, hasAny };
}

function uploadCellEmissionColorTexture(
  gl: WebGL2RenderingContext,
  camera: CameraT,
  bytes: Uint8Array,
  mapSize: { x: number; y: number; z: number },
): void {
  if (!camera.glResources.cellEmissionColorTexture) {
    camera.glResources.cellEmissionColorTexture = gl.createTexture();
  }
  gl.activeTexture(gl.TEXTURE4);
  gl.bindTexture(gl.TEXTURE_2D, camera.glResources.cellEmissionColorTexture);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA8,
    mapSize.x,
    mapSize.y * mapSize.z,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    bytes,
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
  sinA: number,
  heightScale: number,
  cosYaw: number,
  sinYaw: number,
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
  const aOrigPosition = gl.getAttribLocation(program, 'a_origPosition');
  const aEmission = gl.getAttribLocation(program, 'a_emission');

  // Get uniform locations
  const uViewportSize = gl.getUniformLocation(program, 'u_viewportSize');
  const uCameraPosition = gl.getUniformLocation(program, 'u_cameraPosition');
  const uZoom = gl.getUniformLocation(program, 'u_zoom');
  const uCellSize = gl.getUniformLocation(program, 'u_cellSize');
  const uMapSize = gl.getUniformLocation(program, 'u_mapSize');
  const uAlbedoTexture = gl.getUniformLocation(program, 'u_albedoTexture');
  const uNormalTexture = gl.getUniformLocation(program, 'u_normalTexture');
  const uHasNormal = gl.getUniformLocation(program, 'u_hasNormal');

  // Per-side (per-triplanar-plane) frame uniforms.
  // Plane <-> visible side: YZ = +X (south-east), XZ = +Y (up), XY = +Z (south-west)
  const uAlbedoBoundsYZ = gl.getUniformLocation(program, 'u_albedoBoundsYZ');
  const uAlbedoBoundsXZ = gl.getUniformLocation(program, 'u_albedoBoundsXZ');
  const uAlbedoBoundsXY = gl.getUniformLocation(program, 'u_albedoBoundsXY');
  const uAlbedoSizeYZ = gl.getUniformLocation(program, 'u_albedoSizeYZ');
  const uAlbedoSizeXZ = gl.getUniformLocation(program, 'u_albedoSizeXZ');
  const uAlbedoSizeXY = gl.getUniformLocation(program, 'u_albedoSizeXY');
  const uNormalBoundsYZ = gl.getUniformLocation(program, 'u_normalBoundsYZ');
  const uNormalBoundsXZ = gl.getUniformLocation(program, 'u_normalBoundsXZ');
  const uNormalBoundsXY = gl.getUniformLocation(program, 'u_normalBoundsXY');
  const uNormalSizeYZ = gl.getUniformLocation(program, 'u_normalSizeYZ');
  const uNormalSizeXZ = gl.getUniformLocation(program, 'u_normalSizeXZ');
  const uNormalSizeXY = gl.getUniformLocation(program, 'u_normalSizeXY');

  // Per-material emissive texture (Part B) — same per-side layout as albedo/normal.
  const uEmissionTexture = gl.getUniformLocation(program, 'u_emissionTexture');
  const uHasEmissionTexture = gl.getUniformLocation(
    program,
    'u_hasEmissionTexture',
  );
  const uEmissionBoundsYZ = gl.getUniformLocation(program, 'u_emissionBoundsYZ');
  const uEmissionBoundsXZ = gl.getUniformLocation(program, 'u_emissionBoundsXZ');
  const uEmissionBoundsXY = gl.getUniformLocation(program, 'u_emissionBoundsXY');
  const uEmissionSizeYZ = gl.getUniformLocation(program, 'u_emissionSizeYZ');
  const uEmissionSizeXZ = gl.getUniformLocation(program, 'u_emissionSizeXZ');
  const uEmissionSizeXY = gl.getUniformLocation(program, 'u_emissionSizeXY');

  // Per-cell emission (highlight) color texture (Part A).
  const uHasCellEmissionColor = gl.getUniformLocation(
    program,
    'u_hasCellEmissionColor',
  );
  const uCellEmissionColor = gl.getUniformLocation(
    program,
    'u_cellEmissionColor',
  );

  // UV-mode uniforms: when a draw range carries mesh UVs, sample the material's
  // base frame by v_uv instead of triplanar.
  const uUseMeshUV = gl.getUniformLocation(program, 'u_useMeshUV');
  const uAlbedoBoundsBase = gl.getUniformLocation(
    program,
    'u_albedoBoundsBase',
  );
  const uNormalBoundsBase = gl.getUniformLocation(
    program,
    'u_normalBoundsBase',
  );

  // Per-fragment raycasting uniform locations
  const uHasVisibilityMask = gl.getUniformLocation(
    program,
    'u_hasVisibilityMask',
  );
  const uCellSolidity = gl.getUniformLocation(program, 'u_cellSolidity');
  const uRevealTarget = gl.getUniformLocation(program, 'u_revealTarget');

  // Depth-cue uniform locations (AO / cast shadow / height ramp; outline is post-process)
  const uAoWeight = gl.getUniformLocation(program, 'u_aoWeight');
  const uAoRadius = gl.getUniformLocation(program, 'u_aoRadius');
  const uAoScatter = gl.getUniformLocation(program, 'u_aoScatter');
  const uScatterType = gl.getUniformLocation(program, 'u_scatterType');
  const uShadowWeight = gl.getUniformLocation(program, 'u_shadowWeight');
  const uShadowDistance = gl.getUniformLocation(program, 'u_shadowDistance');
  const uShadowScatter = gl.getUniformLocation(program, 'u_shadowScatter');
  const uHeightRampWeight = gl.getUniformLocation(program, 'u_heightRampWeight');
  const uHeightRampMinY = gl.getUniformLocation(program, 'u_heightRampMinY');
  const uHeightRampMaxY = gl.getUniformLocation(program, 'u_heightRampMaxY');
  const uHeightRampLow = gl.getUniformLocation(program, 'u_heightRampLow');
  const uHeightRampHigh = gl.getUniformLocation(program, 'u_heightRampHigh');

  // Set constant uniforms
  const logicalWidth =
    camera.glResources.baseResolution.width * camera.pixelScale;
  const logicalHeight =
    camera.glResources.baseResolution.height * camera.pixelScale;
  gl.uniform2f(uViewportSize, logicalWidth, logicalHeight);

  // Project camera 3D WORLD position (cached, composed up the ancestry) to 2D
  // axonometric space — same projection the vertex shader applies to every vertex.
  const ISO_H = 0.8660254; // cos(30deg) — constant horizontal spread
  const camPos = cameraTransform.worldPosition;
  const camRx = camPos.x * cosYaw + camPos.z * sinYaw;
  const camRz = -camPos.x * sinYaw + camPos.z * cosYaw;
  const camIsoX = camRx * ISO_H - camRz * ISO_H;
  const camIsoY = camRx * sinA - camPos.y * heightScale + camRz * sinA;

  const snapped = snapCameraPosition(
    camIsoX,
    camIsoY,
    camera.pixelScale,
    camera.zoom,
  );
  gl.uniform2f(uCameraPosition, snapped.x, snapped.y);
  gl.uniform1f(uZoom, camera.zoom);

  // Set dynamic light uniforms
  setLightUniforms(gl, camera.id!, lights);

  // Set axonometric angle + orbit yaw uniforms (GPU computes cos/sin)
  setAngleUniform(gl, camera.id!, camera.axonometricAngle);
  setOrbitYawUniform(gl, camera.id!, camera.orbitYaw);

  // Depth-cue uniforms (AO / cast shadow / height ramp). null = all weights 0 (off).
  const dc = camera.depthCues;
  // Scatter style shared by AO + shadow: dither=0, soft-grain=1, smooth-fade=2, retro-dither=3.
  const scatterTypeIndex = dc
    ? { dither: 0, 'soft-grain': 1, 'smooth-fade': 2, 'retro-dither': 3 }[dc.scatterType]
    : 0;
  gl.uniform1i(uScatterType, scatterTypeIndex);
  gl.uniform1f(uAoWeight, dc ? dc.ao.weight : 0);
  gl.uniform1f(uAoRadius, dc ? dc.ao.radius : 1);
  gl.uniform1f(uAoScatter, dc ? dc.ao.scatter : 0);
  gl.uniform1f(uShadowWeight, dc ? dc.shadow.weight : 0);
  gl.uniform1f(uShadowDistance, dc ? dc.shadow.distance : 24);
  gl.uniform1f(uShadowScatter, dc ? dc.shadow.scatter : 0);
  gl.uniform1f(uHeightRampWeight, dc ? dc.heightRamp.weight : 0);
  gl.uniform1f(uHeightRampMinY, dc ? dc.heightRamp.minY : 0);
  gl.uniform1f(uHeightRampMaxY, dc ? dc.heightRamp.maxY : 1);
  if (dc) {
    gl.uniform3f(
      uHeightRampLow,
      dc.heightRamp.lowColor.x,
      dc.heightRamp.lowColor.y,
      dc.heightRamp.lowColor.z,
    );
    gl.uniform3f(
      uHeightRampHigh,
      dc.heightRamp.highColor.x,
      dc.heightRamp.highColor.y,
      dc.heightRamp.highColor.z,
    );
  } else {
    gl.uniform3f(uHeightRampLow, 1, 1, 1);
    gl.uniform3f(uHeightRampHigh, 1, 1, 1);
  }

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

  // Resolve a frame's atlas bounds + pixel size from a TextureMap.
  const frameBounds = (
    textureMap: TextureMapT | undefined,
    frameIndex: number,
  ): ResolvedFrame | null => {
    if (!textureMap) return null;
    const frame = textureMap.frameIndexMap.get(frameIndex);
    if (!frame) return null;
    const minU = frame.atlasPosition.x / atlasSize;
    const minV = frame.atlasPosition.y / atlasSize;
    const maxU = (frame.atlasPosition.x + frame.size.x) / atlasSize;
    const maxV = (frame.atlasPosition.y + frame.size.y) / atlasSize;
    return {
      bounds: [minU, minV, maxU, maxV],
      size: [frame.size.x, frame.size.y],
      atlasIndex: frame.atlasIndex,
    };
  };

  // Resolve the frame for one triplanar plane: a side override when present,
  // otherwise the material's base frame. Side frames must live in the same atlas
  // page as the base (single texture bind); a cross-atlas frame falls back to base.
  const resolvePlane = (
    textureMap: TextureMapT,
    sideFrameIndex: number | undefined,
    base: ResolvedFrame,
  ): ResolvedFrame => {
    if (sideFrameIndex === undefined) return base;
    const fb = frameBounds(textureMap, sideFrameIndex);
    if (!fb) return base;
    if (fb.atlasIndex !== base.atlasIndex) {
      if (!warnedCrossAtlasFrame) {
        warnedCrossAtlasFrame = true;
        console.warn(
          '[camera] per-side frame is in a different atlas page than the base ' +
            'frame; falling back to the base frame for that side.',
        );
      }
      return base;
    }
    return fb;
  };

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

    // Solidity texture (u_cellSolidity) is read by BOTH the reveal raycast and the
    // AO/cast-shadow depth cues — so upload/bind it whenever either needs it.
    const reveal = !!camera.revealTarget && !cellMap.revealExempt;
    const cues = camera.depthCues;
    const needSolidity =
      reveal || (!!cues && (cues.ao.weight > 0 || cues.shadow.weight > 0));

    if (needSolidity) {
      // Recompute every frame — cheap for small maps.
      const solidityMap = computeSolidityMap();
      uploadVisibilityTexture(gl, camera, solidityMap, cellMap.mapSize);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, camera.glResources.visibilityTexture);
      gl.uniform1i(uCellSolidity, 3);
    }

    // The reveal raycast (Y-slice clip) is separate from the cues.
    if (reveal && camera.revealTarget) {
      gl.uniform3f(
        uRevealTarget,
        camera.revealTarget.x,
        camera.revealTarget.y,
        camera.revealTarget.z,
      );
      gl.uniform1i(uHasVisibilityMask, 1);
    } else {
      gl.uniform1i(uHasVisibilityMask, 0);
    }

    // Per-cell emission (highlight) color texture (Part A). Rebuild the GPU texture
    // only when the map changed — setEmissionColor sets emissionColorDirty; no remesh
    // is involved. An all-black map skips upload and disables the shader term.
    if (cellMap.emissionColorDirty) {
      const { bytes, hasAny } = buildCellEmissionColorBytes(cellMap);
      camera.glResources.cellEmissionColorHasAny = hasAny;
      if (hasAny) {
        uploadCellEmissionColorTexture(gl, camera, bytes, cellMap.mapSize);
      }
      cellMap.emissionColorDirty = false;
    }
    if (
      camera.glResources.cellEmissionColorHasAny &&
      camera.glResources.cellEmissionColorTexture
    ) {
      gl.activeTexture(gl.TEXTURE4);
      gl.bindTexture(
        gl.TEXTURE_2D,
        camera.glResources.cellEmissionColorTexture,
      );
      gl.uniform1i(uCellEmissionColor, 4);
      gl.uniform1i(uHasCellEmissionColor, 1);
    } else {
      gl.uniform1i(uHasCellEmissionColor, 0);
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

      // Interleaved layout: pos3+normal3+origPos3+emission1 (stride 10), or +uv2
      // (stride 12 when the cell-map has UV custom shapes). emission is always
      // present at float 9 (byte 36); uv, when present, follows at byte 40.
      // Stride is per-chunk from WASM.
      const strideBytes = chunk.stride * 4;
      gl.enableVertexAttribArray(aPosition);
      gl.vertexAttribPointer(aPosition, 3, gl.FLOAT, false, strideBytes, 0);

      if (aNormal >= 0) {
        gl.enableVertexAttribArray(aNormal);
        gl.vertexAttribPointer(aNormal, 3, gl.FLOAT, false, strideBytes, 12);
      }

      if (aOrigPosition >= 0) {
        gl.enableVertexAttribArray(aOrigPosition);
        gl.vertexAttribPointer(
          aOrigPosition,
          3,
          gl.FLOAT,
          false,
          strideBytes,
          24,
        );
      }

      // Emission glow: always present at byte 36 (1 float).
      if (aEmission >= 0) {
        gl.enableVertexAttribArray(aEmission);
        gl.vertexAttribPointer(aEmission, 1, gl.FLOAT, false, strideBytes, 36);
      }

      // UV channel: present only at stride 12 (after emission). Else constant (0,0).
      if (aUv >= 0) {
        if (chunk.stride >= 12) {
          gl.enableVertexAttribArray(aUv);
          gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, strideBytes, 40);
        } else {
          gl.disableVertexAttribArray(aUv);
          gl.vertexAttrib2f(aUv, 0, 0);
        }
      }

      // Draw each material range
      for (const range of chunk.drawRanges) {
        const material = cellMap.materials[range.materialIndex];
        if (!material) continue;

        const sides = material.sides;

        // Get albedo texture (base frame anchors the atlas page + fallback)
        const albedoTextureMap = textureMapCache.get(material.albedoTextureKey);
        if (!albedoTextureMap || albedoTextureMap.packedFrames.length === 0)
          continue;

        const baseAlbedo = frameBounds(
          albedoTextureMap,
          material.albedoFrame ?? 0,
        );
        if (!baseAlbedo) continue;

        const atlasTexture =
          camera.glResources.atlasTextures[baseAlbedo.atlasIndex];
        if (!atlasTexture) continue;

        // Bind albedo texture
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, atlasTexture);
        gl.uniform1i(uAlbedoTexture, 0);

        // Per-plane albedo frames — XZ = up, YZ = south-east, XY = south-west
        const albedoUp = resolvePlane(
          albedoTextureMap,
          sides?.up?.albedoFrame,
          baseAlbedo,
        );
        const albedoSE = resolvePlane(
          albedoTextureMap,
          sides?.southEast?.albedoFrame,
          baseAlbedo,
        );
        const albedoSW = resolvePlane(
          albedoTextureMap,
          sides?.southWest?.albedoFrame,
          baseAlbedo,
        );
        gl.uniform4f(uAlbedoBoundsXZ, ...albedoUp.bounds);
        gl.uniform2f(uAlbedoSizeXZ, ...albedoUp.size);
        gl.uniform4f(uAlbedoBoundsYZ, ...albedoSE.bounds);
        gl.uniform2f(uAlbedoSizeYZ, ...albedoSE.size);
        gl.uniform4f(uAlbedoBoundsXY, ...albedoSW.bounds);
        gl.uniform2f(uAlbedoSizeXY, ...albedoSW.size);

        // UV mode (custom shapes with mesh UVs): sample the base frame by v_uv.
        gl.uniform1i(uUseMeshUV, range.useMeshUV ? 1 : 0);
        gl.uniform4f(uAlbedoBoundsBase, ...baseAlbedo.bounds);

        // Bind normal texture if available
        const normalTextureMap = textureMapCache.get(material.normalTextureKey);
        const baseNormal = normalTextureMap
          ? frameBounds(normalTextureMap, material.normalFrame ?? 0)
          : null;
        if (normalTextureMap && baseNormal) {
          const normalAtlasTexture =
            camera.glResources.atlasTextures[baseNormal.atlasIndex];

          if (normalAtlasTexture) {
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, normalAtlasTexture);
            gl.uniform1i(uNormalTexture, 1);

            const normalUp = resolvePlane(
              normalTextureMap,
              sides?.up?.normalFrame,
              baseNormal,
            );
            const normalSE = resolvePlane(
              normalTextureMap,
              sides?.southEast?.normalFrame,
              baseNormal,
            );
            const normalSW = resolvePlane(
              normalTextureMap,
              sides?.southWest?.normalFrame,
              baseNormal,
            );
            gl.uniform4f(uNormalBoundsXZ, ...normalUp.bounds);
            gl.uniform2f(uNormalSizeXZ, ...normalUp.size);
            gl.uniform4f(uNormalBoundsYZ, ...normalSE.bounds);
            gl.uniform2f(uNormalSizeYZ, ...normalSE.size);
            gl.uniform4f(uNormalBoundsXY, ...normalSW.bounds);
            gl.uniform2f(uNormalSizeXY, ...normalSW.size);
            gl.uniform4f(uNormalBoundsBase, ...baseNormal.bounds);
            gl.uniform1i(uHasNormal, 1);
          } else {
            gl.uniform1i(uHasNormal, 0);
          }
        } else {
          gl.uniform1i(uHasNormal, 0);
        }

        // Bind emissive texture if the material provides one (Part B). Same per-side
        // atlas layout as normal maps; the shader scales it by per-cell v_emission and
        // falls back to albedo when u_hasEmissionTexture is false.
        const emissionTextureMap = textureMapCache.get(
          material.emissionTextureKey,
        );
        const baseEmission = emissionTextureMap
          ? frameBounds(emissionTextureMap, material.emissionFrame ?? 0)
          : null;
        if (emissionTextureMap && baseEmission) {
          const emissionAtlasTexture =
            camera.glResources.atlasTextures[baseEmission.atlasIndex];

          if (emissionAtlasTexture) {
            gl.activeTexture(gl.TEXTURE2);
            gl.bindTexture(gl.TEXTURE_2D, emissionAtlasTexture);
            gl.uniform1i(uEmissionTexture, 2);

            const emissionUp = resolvePlane(
              emissionTextureMap,
              sides?.up?.emissionFrame,
              baseEmission,
            );
            const emissionSE = resolvePlane(
              emissionTextureMap,
              sides?.southEast?.emissionFrame,
              baseEmission,
            );
            const emissionSW = resolvePlane(
              emissionTextureMap,
              sides?.southWest?.emissionFrame,
              baseEmission,
            );
            gl.uniform4f(uEmissionBoundsXZ, ...emissionUp.bounds);
            gl.uniform2f(uEmissionSizeXZ, ...emissionUp.size);
            gl.uniform4f(uEmissionBoundsYZ, ...emissionSE.bounds);
            gl.uniform2f(uEmissionSizeYZ, ...emissionSE.size);
            gl.uniform4f(uEmissionBoundsXY, ...emissionSW.bounds);
            gl.uniform2f(uEmissionSizeXY, ...emissionSW.size);
            gl.uniform1i(uHasEmissionTexture, 1);
          } else {
            gl.uniform1i(uHasEmissionTexture, 0);
          }
        } else {
          gl.uniform1i(uHasEmissionTexture, 0);
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
