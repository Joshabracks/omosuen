// 1. Create unified shader program (combines cell and sprite rendering)
export const unifiedVertexShader = `
    attribute vec3 a_position;  // Used by cells
    attribute vec2 a_uv;
    attribute vec3 a_normal;    // Used by cells

    // Render mode selector
    uniform lowp int u_renderMode;  // 0 = cells, 1 = sprites

    // Shared uniforms
    uniform vec2 u_viewportSize;
    uniform vec2 u_cameraPosition;
    uniform float u_zoom;
    uniform vec3 u_cellSize;   // Used by both for grid calculations
    uniform vec3 u_mapSize;    // Used by both for depth calculations

    // Cell-specific uniforms (Mode 0)
    uniform vec3 u_cellPosition;

    // Sprite-specific uniforms (Mode 1)
    uniform vec3 u_spritePosition;  // 3D world position (x, y=height, z)
    uniform vec2 u_spriteSize;
    uniform vec2 u_anchor;
    uniform float u_rotation;

    // Outputs
    varying vec2 v_uv;
    varying vec3 v_normal;
    varying vec3 v_worldPos;
    varying vec2 v_screenPos;
    varying vec3 v_worldNormal;

    void main() {
      if (u_renderMode == 0) {
        // ============================================================
        // MODE 0: CELL RENDERING
        // ============================================================

        // Scale vertex by cell size and translate to world position
        vec3 worldPos = a_position * u_cellSize + u_cellPosition;

        // Apply standard isometric projection
        vec2 isoX = worldPos.x * vec2(0.866, 0.5);
        vec2 isoY = worldPos.y * vec2(0.0, -1.0);
        vec2 isoZ = worldPos.z * vec2(-0.866, 0.5);
        vec2 isoProjected = isoX + isoY + isoZ;

        // Convert to view space and apply zoom
        vec2 isoPos = (isoProjected - u_cameraPosition) * u_zoom;

        // Pixel snapping
        vec2 pixelPos = floor(isoPos + 0.5);
        v_screenPos = pixelPos;

        // Convert to clip space
        vec2 clipSpace = (pixelPos / u_viewportSize) * 2.0 - 1.0;

        // Calculate depth
        vec3 gridPos = worldPos / u_cellSize;
        float mapDepth = u_mapSize.z;
        float maxGridSum = (u_mapSize.x - 1.0) + (u_mapSize.z - 1.0);
        float zDepth = (gridPos.x + gridPos.z) * mapDepth + gridPos.y * 2.0;
        float maxDepth = maxGridSum * mapDepth + (mapDepth - 1.0) * 2.0;
        float clipDepth = 1.0 - (zDepth / maxDepth);

        gl_Position = vec4(clipSpace * vec2(1, -1), clipDepth, 1.0);

        // Transform normal to isometric screen space
        vec3 isoNormalX = a_normal.x * vec3(0.866, 0.5, 0.0);
        vec3 isoNormalY = a_normal.y * vec3(0.0, -1.0, 0.0);
        vec3 isoNormalZ = a_normal.z * vec3(-0.866, 0.5, 0.0);
        vec3 isoNormal = isoNormalX + isoNormalY + isoNormalZ;

        v_uv = a_uv;
        v_normal = normalize(isoNormal);
        v_worldPos = worldPos;
        v_worldNormal = a_normal;

      } else {
        // ============================================================
        // MODE 1: SPRITE RENDERING
        // ============================================================

        // Apply isometric projection to sprite's 3D world position
        vec2 isoX = u_spritePosition.x * vec2(0.866, 0.5);
        vec2 isoY = u_spritePosition.y * vec2(0.0, -1.0);
        vec2 isoZ = u_spritePosition.z * vec2(-0.866, 0.5);
        vec2 isoProjected = isoX + isoY + isoZ;

        // Apply anchor offset in screen space
        // Anchor values are already in pixels, no additional scaling needed
        vec2 scaledAnchor = u_anchor;
        vec2 anchoredPosition = isoProjected - scaledAnchor;

        // Apply rotation to sprite quad vertices
        float c = cos(u_rotation);
        float s = sin(u_rotation);
        vec2 rotated = vec2(
          a_position.x * c - a_position.y * s,
          a_position.x * s + a_position.y * c
        );

        // Scale sprite vertices by size and zoom
        vec2 scaledVertex = rotated * u_spriteSize * u_zoom;

        // Convert to view space and add scaled vertex offset
        vec2 viewPos = (anchoredPosition - u_cameraPosition) * u_zoom + scaledVertex;

        // Convert to clip space
        vec2 clipSpace = (viewPos / u_viewportSize) * 2.0 - 1.0;

        // Calculate depth (cell-based, with bias)
        vec3 cellGridPos = floor(u_spritePosition / u_cellSize);
        float standingOnCellY = cellGridPos.y - 1.0;
        float mapDepth = u_mapSize.z;
        float maxGridSum = (u_mapSize.x - 1.0) + (u_mapSize.z - 1.0);
        float zDepth = (cellGridPos.x + cellGridPos.z) * mapDepth + (standingOnCellY - 0.1) * 2.0;
        float maxDepth = maxGridSum * mapDepth + (mapDepth - 1.0) * 2.0;
        float clipDepth = 1.0 - (zDepth / maxDepth);

        gl_Position = vec4(clipSpace * vec2(1, -1), clipDepth, 1.0);
        v_uv = a_uv;

        // Sprites are 2D billboards facing the camera, so they use screen-space normals
        // Normal maps (if present) will be applied in the fragment shader for lighting
        v_normal = vec3(0.0, 0.0, 1.0);  // Billboard facing camera
        v_worldPos = vec3(u_spritePosition.x, u_spritePosition.z, u_spritePosition.y);
        v_worldNormal = vec3(0.0, 0.0, 1.0);  // Screen-space normal
        v_screenPos = viewPos;
      }
    }
  `;

// Unified fragment shader (combines cell and sprite fragment processing)
export const unifiedFragmentShader = `
    precision mediump float;

    // Render mode selector
    uniform lowp int u_renderMode;  // 0 = cells, 1 = sprites

    // Shared uniforms
    uniform sampler2D u_albedoTexture;
    uniform sampler2D u_normalTexture;
    uniform vec4 u_uvBounds;
    uniform bool u_hasNormal;

    // Cell-specific uniforms (Mode 0)
    uniform vec4 u_normalUVBounds;
    uniform vec2 u_textureSize;

    // Sprite-specific uniforms (Mode 1)
    uniform sampler2D u_materialTexture;
    uniform sampler2D u_emissionTexture;
    uniform bool u_hasMaterial;
    uniform bool u_hasEmission;
    uniform vec4 u_tint;
    uniform float u_opacity;

    // Varying inputs (shared)
    varying vec2 v_uv;
    varying vec3 v_normal;
    varying vec3 v_worldPos;
    varying vec2 v_screenPos;
    varying vec3 v_worldNormal;

    void main() {
      if (u_renderMode == 0) {
        // ============================================================
        // MODE 0: CELL RENDERING (Triplanar world-space texture mapping)
        // ============================================================

        // Calculate blend weights from world-space normal
        vec3 blendWeights = abs(normalize(v_worldNormal));
        blendWeights = blendWeights / (blendWeights.x + blendWeights.y + blendWeights.z);

        // Sample YZ plane (for X-facing sides: left/right walls)
        vec2 worldPixelYZ = floor(vec2(v_worldPos.z, v_worldPos.y));
        vec2 texelCoordYZ = mod(worldPixelYZ, u_textureSize);
        vec2 normalizedUV_YZ = (texelCoordYZ + 0.5) / u_textureSize;
        vec2 atlasUV_YZ = mix(u_uvBounds.xy, u_uvBounds.zw, normalizedUV_YZ);
        vec4 albedoYZ = texture2D(u_albedoTexture, atlasUV_YZ);

        // Sample XZ plane (for Y-facing sides: top/bottom faces)
        vec2 worldPixelXZ = floor(vec2(v_worldPos.x, v_worldPos.z));
        vec2 texelCoordXZ = mod(worldPixelXZ, u_textureSize);
        vec2 normalizedUV_XZ = (texelCoordXZ + 0.5) / u_textureSize;
        vec2 atlasUV_XZ = mix(u_uvBounds.xy, u_uvBounds.zw, normalizedUV_XZ);
        vec4 albedoXZ = texture2D(u_albedoTexture, atlasUV_XZ);

        // Sample XY plane (for Z-facing sides: front/back walls)
        vec2 worldPixelXY = floor(vec2(v_worldPos.x, v_worldPos.y));
        vec2 texelCoordXY = mod(worldPixelXY, u_textureSize);
        vec2 normalizedUV_XY = (texelCoordXY + 0.5) / u_textureSize;
        vec2 atlasUV_XY = mix(u_uvBounds.xy, u_uvBounds.zw, normalizedUV_XY);
        vec4 albedoXY = texture2D(u_albedoTexture, atlasUV_XY);

        // Blend the three albedo samples using normal weights
        vec4 albedo = albedoYZ * blendWeights.x + albedoXZ * blendWeights.y + albedoXY * blendWeights.z;

        // Triplanar normal mapping (if available)
        vec3 finalNormal;
        if (u_hasNormal) {
          vec2 normalAtlasUV_YZ = mix(u_normalUVBounds.xy, u_normalUVBounds.zw, normalizedUV_YZ);
          vec2 normalAtlasUV_XZ = mix(u_normalUVBounds.xy, u_normalUVBounds.zw, normalizedUV_XZ);
          vec2 normalAtlasUV_XY = mix(u_normalUVBounds.xy, u_normalUVBounds.zw, normalizedUV_XY);

          vec3 normalMapYZ = texture2D(u_normalTexture, normalAtlasUV_YZ).rgb;
          vec3 normalMapXZ = texture2D(u_normalTexture, normalAtlasUV_XZ).rgb;
          vec3 normalMapXY = texture2D(u_normalTexture, normalAtlasUV_XY).rgb;

          vec3 normalMap = normalMapYZ * blendWeights.x + normalMapXZ * blendWeights.y + normalMapXY * blendWeights.z;
          normalMap = normalMap * 2.0 - 1.0;
          finalNormal = normalize(v_normal + normalMap * 0.5);
        } else {
          finalNormal = normalize(v_normal);
        }

        // Directional light in screen space
        vec3 lightDir = normalize(vec3(0.5, -0.7, 0.0));
        float diffuse = max(dot(finalNormal, lightDir), 0.0);
        float ambient = 0.4;
        float lighting = ambient + diffuse * 0.6;

        gl_FragColor = vec4(albedo.rgb * lighting, albedo.a);

      } else {
        // ============================================================
        // MODE 1: SPRITE RENDERING (Atlas sampling with normal mapping and lighting)
        // ============================================================

        // Sample UV within atlas bounds
        vec2 atlasUV = mix(u_uvBounds.xy, u_uvBounds.zw, v_uv);

        // Albedo (always required)
        vec4 albedo = texture2D(u_albedoTexture, atlasUV);

        // Discard fully transparent pixels early
        if (albedo.a < 0.01) discard;

        // Normal mapping for sprites (if available)
        vec3 finalNormal;
        if (u_hasNormal) {
          // Sample normal map from same UV coords as albedo
          vec2 normalAtlasUV = mix(u_normalUVBounds.xy, u_normalUVBounds.zw, v_uv);
          vec3 normalMap = texture2D(u_normalTexture, normalAtlasUV).rgb;

          // Convert from [0,1] range to [-1,1] range
          normalMap = normalMap * 2.0 - 1.0;

          // Perturb the base normal (billboard facing camera)
          finalNormal = normalize(v_normal + normalMap * 0.5);
        } else {
          finalNormal = v_normal;
        }

        // Directional light in screen space (same as cell-maps for consistency)
        vec3 lightDir = normalize(vec3(0.5, -0.7, 0.0));
        float diffuse = max(dot(finalNormal, lightDir), 0.0);
        float ambient = 0.4;
        float lighting = ambient + diffuse * 0.6;

        // Apply lighting and tint
        vec4 tinted = albedo * u_tint * vec4(vec3(lighting), 1.0);

        // Apply opacity to final alpha channel
        gl_FragColor = vec4(tinted.rgb, tinted.a * u_opacity);
      }
    }
  `;
