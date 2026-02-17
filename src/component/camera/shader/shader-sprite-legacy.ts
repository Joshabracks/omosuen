// Legacy sprite shader (will be removed after migration)
export const vertexShaderSource = `
    attribute vec2 a_position;
    attribute vec2 a_uv;
    uniform vec3 u_spritePosition;  // 3D world position (x, y, z)
    uniform vec2 u_spriteSize;
    uniform vec2 u_anchor;          // Anchor offset in pixels (from top-left)
    uniform float u_rotation;
    uniform vec2 u_viewportSize;
    uniform vec2 u_cameraPosition;
    uniform float u_zoom;
    uniform vec3 u_cellSize;        // Cell size for grid position calculation
    uniform vec3 u_mapSize;         // Map dimensions (width, height, depth) in cells
    varying vec2 v_uv;

    void main() {
      // Apply isometric projection to sprite's 3D world position
      // +X projects right-down at 30° from horizontal
      // +Y projects straight up (vertical)
      // +Z projects left-down at 30° from horizontal (mirrored from X)
      vec2 isoX = u_spritePosition.x * vec2(0.866, 0.5);      // cos(30°), sin(30°)
      vec2 isoY = u_spritePosition.y * vec2(0.0, -1.0);       // straight up
      vec2 isoZ = u_spritePosition.z * vec2(-0.866, 0.5);     // cos(150°), sin(150°)

      // Combine isometric axes to get 2D projection
      vec2 isoProjected = isoX + isoY + isoZ;

      // Apply anchor offset in screen space (after projection, before camera transform)
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

      // Convert to view space (subtract camera) and add scaled vertex offset
      vec2 viewPos = (anchoredPosition - u_cameraPosition) * u_zoom + scaledVertex;

      // Convert to clip space
      vec2 clipSpace = (viewPos / u_viewportSize) * 2.0 - 1.0;

      // Calculate isometric depth for proper front-to-back rendering with cell-map
      // Use cell-based depth calculation to match the cell the sprite is standing on

      // First, calculate which cell grid position the sprite is on
      vec3 cellGridPos = floor(u_spritePosition / u_cellSize);

      // Sprites are placed at (cellY + 1) * cellHeight in the scene setup,
      // so we subtract 1 to get the Y coordinate of the cell they're standing on
      float standingOnCellY = cellGridPos.y - 1.0;

      // Calculate z-depth using the cell grid position (X, Z) and standing cell Y
      // Add small bias (-0.1) to ensure sprite renders slightly in front of cell surface
      // Use mapDepth (Z dimension) for multiplier to match Kalifo Shores working implementation
      float mapHeight = u_mapSize.y;
      float mapWidth = u_mapSize.x;
      float mapDepth = u_mapSize.z;
      float maxGridSum = (mapWidth - 1.0) + (mapDepth - 1.0);
      float zDepth = (cellGridPos.x + cellGridPos.z) * mapDepth + (standingOnCellY - 0.1) * 2.0;
      float maxDepth = maxGridSum * mapDepth + (mapDepth - 1.0) * 2.0;

      // Invert and normalize to match cell-map depth range
      float clipDepth = 1.0 - (zDepth / maxDepth);

      gl_Position = vec4(clipSpace * vec2(1, -1), clipDepth, 1);
      v_uv = a_uv;
    }
  `;

export const fragmentShaderSource = `
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

      // Discard fully transparent pixels early
      // This prevents transparent pixels from affecting the depth buffer
      // and skips unnecessary fragment processing
      if (albedo.a < 0.01) discard;

      // Optional channels (placeholder for now - just pass through albedo)
      // TODO: Implement normal mapping, material properties, emission

      // Apply tint to both RGB and alpha
      vec4 tinted = albedo * u_tint;

      // Apply opacity to final alpha channel
      // This ensures transparent pixels (albedo.a = 0) stay transparent
      // and opacity correctly modulates overall transparency
      gl_FragColor = vec4(tinted.rgb, tinted.a * u_opacity);
    }
  `;
