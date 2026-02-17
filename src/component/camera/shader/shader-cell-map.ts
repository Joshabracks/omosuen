export const cellMapVertexShaderSource = `
    attribute vec3 a_position;
    attribute vec2 a_uv;
    attribute vec3 a_normal;

    uniform vec2 u_viewportSize;
    uniform vec2 u_cameraPosition;
    uniform float u_zoom;
    uniform vec3 u_cellPosition;
    uniform vec3 u_cellSize;
    uniform vec3 u_mapSize;  // Map dimensions (width, height, depth) in cells

    varying vec2 v_uv;
    varying vec3 v_normal;
    varying vec3 v_worldPos;
    varying vec2 v_screenPos;
    varying vec3 v_worldNormal;

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

      // PIXEL SNAPPING: Round to nearest pixel for perfect alignment
      // This eliminates sub-pixel misalignment, texture seams, and creates
      // consistent pixelation at all zoom levels (classic isometric look)
      vec2 pixelPos = floor(isoPos + 0.5);  // Round to nearest integer pixel
      v_screenPos = pixelPos;  // Pass to fragment shader for world-space texture sampling

      // Convert snapped pixel position to clip space
      vec2 clipSpace = (pixelPos / u_viewportSize) * 2.0 - 1.0;

      // Calculate isometric depth for proper back-to-front rendering
      // In isometric view, depth is determined by diagonal rows on screen
      // Primary factor: horizontal row = gridX + gridZ (same row = same diagonal line on screen)
      // Secondary factor: height within row = gridY / mapHeight (fractional, < 1.0)
      // Convert world coordinates to grid indices
      vec3 gridPos = worldPos / u_cellSize;

      // Calculate z-depth using isometric formula (adapted from Kalifo Shores)
      // (gridX + gridZ) * mapDepth + gridY * 2.0
      // - (gridX + gridZ) = horizontal diagonal row
      // - Multiply by mapDepth (Z dimension) for proper depth separation
      // - gridY * 2.0 = vertical layer offset within the same horizontal row
      float mapHeight = u_mapSize.y;
      float mapWidth = u_mapSize.x;
      float mapDepth = u_mapSize.z;
      float maxGridSum = (mapWidth - 1.0) + (mapDepth - 1.0);
      float zDepth = (gridPos.x + gridPos.z) * mapDepth + gridPos.y * 2.0;
      float maxDepth = maxGridSum * mapDepth + (mapDepth - 1.0) * 2.0;

      // Invert and normalize: 1.0 - (depth/max) ensures back cells render first
      // This creates proper back-to-front occlusion with gl.LESS depth test
      float clipDepth = 1.0 - (zDepth / maxDepth);
      gl_Position = vec4(clipSpace * vec2(1, -1), clipDepth, 1);

      // Transform normal to isometric screen space (same transformation as position)
      // This allows lighting to work correctly in 2D isometric view
      vec3 isoNormalX = a_normal.x * vec3(0.866, 0.5, 0.0);
      vec3 isoNormalY = a_normal.y * vec3(0.0, -1.0, 0.0);
      vec3 isoNormalZ = a_normal.z * vec3(-0.866, 0.5, 0.0);
      vec3 isoNormal = isoNormalX + isoNormalY + isoNormalZ;

      v_uv = a_uv;
      v_normal = normalize(isoNormal);
      v_worldPos = worldPos;
      v_worldNormal = a_normal;
    }
  `;

export const cellMapFragmentShaderSource = `
    precision mediump float;

    uniform sampler2D u_albedoTexture;
    uniform sampler2D u_normalTexture;
    uniform vec4 u_uvBounds;
    uniform vec4 u_normalUVBounds;
    uniform vec2 u_textureSize;
    uniform bool u_hasNormal;

    varying vec2 v_uv;
    varying vec3 v_normal;
    varying vec3 v_worldPos;
    varying vec2 v_screenPos;
    varying vec3 v_worldNormal;

    void main() {
      // TRIPLANAR WORLD-SPACE TEXTURE MAPPING
      // Sample texture from three world-space planes (XY, XZ, YZ) and blend
      // based on surface normal to prevent warping on side faces

      // Calculate blend weights from WORLD-SPACE normal (how much each plane contributes)
      // Use world-space normal (not isometric-transformed normal) to align with world axes
      vec3 blendWeights = abs(normalize(v_worldNormal));
      // Normalize so weights sum to 1.0
      blendWeights = blendWeights / (blendWeights.x + blendWeights.y + blendWeights.z);

      // Sample YZ plane (for X-facing sides: left/right walls)
      // Horizontal: Z-axis, Vertical: Y-axis (makes texture "upright")
      vec2 worldPixelYZ = floor(vec2(v_worldPos.z, v_worldPos.y));
      vec2 texelCoordYZ = mod(worldPixelYZ, u_textureSize);
      vec2 normalizedUV_YZ = (texelCoordYZ + 0.5) / u_textureSize;
      vec2 atlasUV_YZ = mix(u_uvBounds.xy, u_uvBounds.zw, normalizedUV_YZ);
      vec4 albedoYZ = texture2D(u_albedoTexture, atlasUV_YZ);

      // Sample XZ plane (for Y-facing sides: top/bottom faces)
      // Uses both horizontal axes (X and Z)
      vec2 worldPixelXZ = floor(vec2(v_worldPos.x, v_worldPos.z));
      vec2 texelCoordXZ = mod(worldPixelXZ, u_textureSize);
      vec2 normalizedUV_XZ = (texelCoordXZ + 0.5) / u_textureSize;
      vec2 atlasUV_XZ = mix(u_uvBounds.xy, u_uvBounds.zw, normalizedUV_XZ);
      vec4 albedoXZ = texture2D(u_albedoTexture, atlasUV_XZ);

      // Sample XY plane (for Z-facing sides: front/back walls)
      // Horizontal: X-axis, Vertical: Y-axis (makes texture "upright")
      vec2 worldPixelXY = floor(vec2(v_worldPos.x, v_worldPos.y));
      vec2 texelCoordXY = mod(worldPixelXY, u_textureSize);
      vec2 normalizedUV_XY = (texelCoordXY + 0.5) / u_textureSize;
      vec2 atlasUV_XY = mix(u_uvBounds.xy, u_uvBounds.zw, normalizedUV_XY);
      vec4 albedoXY = texture2D(u_albedoTexture, atlasUV_XY);

      // Blend the three albedo samples using normal weights
      // X weight → YZ plane, Y weight → XZ plane, Z weight → XY plane
      vec4 albedo = albedoYZ * blendWeights.x + albedoXZ * blendWeights.y + albedoXY * blendWeights.z;

      // TRIPLANAR NORMAL MAPPING (if normal map is available)
      vec3 finalNormal;
      if (u_hasNormal) {
        // Sample normal map from three planes using same UVs as albedo
        vec2 normalAtlasUV_YZ = mix(u_normalUVBounds.xy, u_normalUVBounds.zw, normalizedUV_YZ);
        vec2 normalAtlasUV_XZ = mix(u_normalUVBounds.xy, u_normalUVBounds.zw, normalizedUV_XZ);
        vec2 normalAtlasUV_XY = mix(u_normalUVBounds.xy, u_normalUVBounds.zw, normalizedUV_XY);

        vec3 normalMapYZ = texture2D(u_normalTexture, normalAtlasUV_YZ).rgb;
        vec3 normalMapXZ = texture2D(u_normalTexture, normalAtlasUV_XZ).rgb;
        vec3 normalMapXY = texture2D(u_normalTexture, normalAtlasUV_XY).rgb;

        // Blend normal maps
        vec3 normalMap = normalMapYZ * blendWeights.x + normalMapXZ * blendWeights.y + normalMapXY * blendWeights.z;

        // Convert from [0,1] range to [-1,1] range
        normalMap = normalMap * 2.0 - 1.0;

        // Combine with geometry normal (perturb the normal)
        // Scale normal map strength to avoid over-exaggerated bumps
        finalNormal = normalize(v_normal + normalMap * 0.5);
      } else {
        // Use geometry normal if no normal map available
        finalNormal = normalize(v_normal);
      }

      // Directional light in screen space (top-right, typical for isometric)
      vec3 lightDir = normalize(vec3(0.5, -0.7, 0.0));

      // Diffuse lighting with ambient (use final normal from normal mapping)
      float diffuse = max(dot(finalNormal, lightDir), 0.0);
      float ambient = 0.4;  // 40% ambient light
      float lighting = ambient + diffuse * 0.6;  // 60% directional contribution

      gl_FragColor = vec4(albedo.rgb * lighting, albedo.a);
    }
  `;
