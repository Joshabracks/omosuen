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
    if(u_renderMode == 0) {
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
        vec2 rotated = vec2(a_position.x * c - a_position.y * s, a_position.x * s + a_position.y * c);

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