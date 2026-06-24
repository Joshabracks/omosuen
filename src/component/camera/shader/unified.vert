attribute vec3 a_position;      // Used by cells
attribute vec2 a_uv;
attribute vec3 a_normal;        // Used by cells
attribute vec3 a_origPosition;  // Pre-smoothing position (cells only)

    // Render mode selector
uniform lowp int u_renderMode;  // 0 = cells, 1 = sprites

    // Shared uniforms
uniform vec2 u_viewportSize;
uniform vec2 u_cameraPosition;
uniform float u_zoom;
uniform mediump float u_axonometricAngle;
uniform vec3 u_cellSize;   // Used by both for grid calculations
uniform vec3 u_mapSize;    // Used by both for depth calculations

    // Sprite-specific uniforms (Mode 1)
uniform vec3 u_spritePosition;  // 3D world position (x, y=height, z)
uniform vec2 u_spriteSize;
uniform vec2 u_anchor;   // normalized [0,1] from the sprite's top-left
uniform float u_rotation;

    // Outputs
varying vec2 v_uv;
varying vec3 v_normal;
varying vec3 v_worldPos;
varying vec2 v_screenPos;
varying vec3 v_worldNormal;
varying vec3 v_origWorldPos;

void main() {
    const float ISO_H = 0.8660254; // cos(30deg) — constant horizontal spread
    float clampedAngle = clamp(u_axonometricAngle, 0.0, 90.0);
    float sinA = sin(radians(clampedAngle));
    float heightScale = cos(radians(clampedAngle)) * 1.1547005; // cos(a)/cos(30deg)

    if(u_renderMode == 0) {
        // ============================================================
        // MODE 0: CELL RENDERING
        // ============================================================

        // Chunk mesh builder provides world-space positions directly
        vec3 worldPos = a_position;

        // Apply axonometric projection
        vec2 isoX = worldPos.x * vec2(ISO_H, sinA);
        vec2 isoY = worldPos.y * vec2(0.0, -heightScale);
        vec2 isoZ = worldPos.z * vec2(-ISO_H, sinA);
        vec2 isoProjected = isoX + isoY + isoZ;

        // Convert to view space and apply zoom
        vec2 isoPos = (isoProjected - u_cameraPosition) * u_zoom;

        v_screenPos = isoPos;

        // Convert to clip space
        vec2 clipSpace = (isoPos / u_viewportSize) * 2.0;

        // Depth = projection onto axonometric view direction.
        // Higher sum = closer to camera = lower depth buffer value.
        float rawDepth = worldPos.x + heightScale * worldPos.y + worldPos.z;
        float maxRawDepth = u_mapSize.x * u_cellSize.x + u_mapSize.y * u_cellSize.y + u_mapSize.z * u_cellSize.z;
        float clipDepth = 1.0 - rawDepth / maxRawDepth;

        gl_Position = vec4(clipSpace * vec2(1, -1), clipDepth, 1.0);

        // Transform normal to isometric screen space
        vec3 isoNormalX = a_normal.x * vec3(ISO_H, sinA, 0.0);
        vec3 isoNormalY = a_normal.y * vec3(0.0, -1.0, 0.0);
        vec3 isoNormalZ = a_normal.z * vec3(-ISO_H, sinA, 0.0);
        vec3 isoNormal = isoNormalX + isoNormalY + isoNormalZ;

        v_uv = a_uv;
        v_normal = normalize(isoNormal);
        v_worldPos = worldPos;
        v_worldNormal = a_normal;
        v_origWorldPos = a_origPosition;

    } else {
        // ============================================================
        // MODE 1: SPRITE RENDERING
        // ============================================================

        // Apply axonometric projection to sprite's 3D world position
        vec2 isoX = u_spritePosition.x * vec2(ISO_H, sinA);
        vec2 isoY = u_spritePosition.y * vec2(0.0, -heightScale);
        vec2 isoZ = u_spritePosition.z * vec2(-ISO_H, sinA);
        vec2 isoProjected = isoX + isoY + isoZ;

        // Anchor (u_anchor) is normalized [0,1] from the sprite's TOP-LEFT. The quad
        // is centered (-0.5..0.5), so re-base it around the anchor: the anchor pixel
        // becomes the origin, so it lands exactly on the transform position and
        // rotation pivots around it. (a_position.y +0.5 = image-bottom, -0.5 = top;
        // u_anchor.y matches image space, top = 0, so no extra Y flip is needed.)
        vec2 anchorPos = u_anchor - 0.5;               // anchor in centered-quad space
        vec2 localVertex = a_position.xy - anchorPos;  // vertex relative to the anchor

        // Apply rotation around the anchor
        float c = cos(u_rotation);
        float s = sin(u_rotation);
        vec2 rotated = vec2(localVertex.x * c - localVertex.y * s, localVertex.x * s + localVertex.y * c);

        // Scale by size and zoom
        vec2 scaledVertex = rotated * u_spriteSize * u_zoom;

        // Convert to view space; the anchor pixel sits at the sprite's transform position
        vec2 viewPos = (isoProjected - u_cameraPosition) * u_zoom + scaledVertex;

        // Convert to clip space
        vec2 clipSpace = (viewPos / u_viewportSize) * 2.0;

        // Same depth formula as cells, with +1.0 bias so sprite renders
        // just in front of the cell surface at its position.
        float rawDepth = u_spritePosition.x + heightScale * u_spritePosition.y + u_spritePosition.z + 1.0;
        float maxRawDepth = u_mapSize.x * u_cellSize.x + u_mapSize.y * u_cellSize.y + u_mapSize.z * u_cellSize.z;
        float clipDepth = 1.0 - rawDepth / maxRawDepth;

        gl_Position = vec4(clipSpace * vec2(1, -1), clipDepth, 1.0);
        v_uv = a_uv;

        // Sprite base normal in isometric screen space (matches a top-facing cell surface).
        // worldDirToIso() projects light directions to the XY plane, so normals must also
        // live in XY to produce non-zero diffuse dot products.
        v_normal = vec3(0.0, -1.0, 0.0);  // Isometric up
        v_worldPos = u_spritePosition;
        v_worldNormal = vec3(0.0, 0.0, 1.0);  // Screen-space normal
        v_origWorldPos = u_spritePosition;
        v_screenPos = viewPos;
    }
}
