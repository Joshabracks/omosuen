#version 300 es

in vec3 a_position;      // Used by cells
in vec2 a_uv;
in vec3 a_normal;        // Used by cells
in vec3 a_origPosition;  // Pre-smoothing position (cells only)
in float a_emission;     // Per-vertex emission glow 0..1 (cells only)
in vec3 a_trueFaceDir;   // Exact, always-axis-aligned face direction (cells only)

    // Render mode selector
uniform lowp int u_renderMode;  // 0 = cells, 1 = sprites

    // Shared uniforms
uniform vec2 u_viewportSize;
uniform vec2 u_cameraPosition;
uniform float u_zoom;
uniform mediump float u_axonometricAngle;
uniform mediump float u_orbitYaw;
uniform vec3 u_cellSize;   // Used by both for grid calculations
    // Size of the currently-resident cell-map window, and the window's
    // world-space origin offset (window origin * chunkSize * cellSize).
    // Used by the shared depth-bias block below for BOTH render modes: cells
    // set these from the cell-map's actual window each frame (render-cell-maps.ts),
    // while sprites set u_windowSize from the scene's max map bounds (falling
    // back to a default when there are no cell-maps) and u_worldOffset to
    // (0,0,0), since sprites have no shiftable window of their own
    // (render-sprites.ts). Leaving either unset zero-initializes it, which
    // sends maxRawDepth to 0 and every vertex's clip-space depth to
    // +/-Infinity -- silently clipping all geometry in that render mode.
uniform vec3 u_windowSize;
uniform vec3 u_worldOffset;

    // Sprite-specific uniforms (Mode 1)
uniform vec3 u_spritePosition;  // 3D world position (x, y=height, z)
uniform vec2 u_spriteSize;
uniform vec2 u_anchor;   // normalized [0,1] from the sprite's top-left
uniform float u_rotation;

    // Outputs
out vec2 v_uv;
out vec3 v_worldPos;
out vec2 v_screenPos;
out vec3 v_worldNormal;
out vec3 v_origWorldPos;
out float v_emission;
flat out vec3 v_trueFaceDir;

void main() {
    const float ISO_H = 0.8660254; // cos(30deg) — constant horizontal spread
    float clampedAngle = clamp(u_axonometricAngle, 0.0, 90.0);
    float sinA = sin(radians(clampedAngle));
    float heightScale = cos(radians(clampedAngle)) * 1.1547005; // cos(a)/cos(30deg)
    float cosYaw = cos(radians(u_orbitYaw));
    float sinYaw = sin(radians(u_orbitYaw));

    // Depth-buffer normalization must stay valid for ANY yaw, and now for any
    // window world-position (not just an origin-anchored map). Two distinct
    // quantities, kept separate on purpose:
    //  - windowHalfX/Z: the window's HALF-EXTENT (a magnitude, no offset) --
    //    bounds how far (rx-rotCenterX)/(rz-rotCenterZ) can range, which
    //    depends only on window SIZE, not where it sits in the world.
    //  - windowCenterX/Z: the window's ABSOLUTE world-space center
    //    (u_worldOffset + half-extent) -- what rx/rz (already absolute,
    //    post-u_worldOffset) need to be re-centered against so they land
    //    back in a small bounded range before the yaw-safety argument below
    //    applies. Conflating these two (reusing the half-extent as if it
    //    were the absolute center) only happened to work historically
    //    because the map's origin was always (0,0,0).
    //
    // Once re-centered, rx/rz can go negative under rotation (e.g. yaw=90:
    // rz = -x), which without centering would push rawDepth below 0 — past
    // the far clip plane, silently culling a wedge of the window. Centering
    // on the window's own center and biasing by 2x the (yaw-invariant)
    // half-diagonal keeps rawDepth provably within [0, maxRawDepth] for any
    // yaw AND any window position; at offset=0, yaw=0 this is bit-for-bit
    // the original formula, so today's occlusion ordering is unchanged.
    float windowHalfX = u_windowSize.x * u_cellSize.x * 0.5;
    float windowHalfZ = u_windowSize.z * u_cellSize.z * 0.5;
    float windowCenterX = u_worldOffset.x + windowHalfX;
    float windowCenterZ = u_worldOffset.z + windowHalfZ;
    float rotCenterX = windowCenterX * cosYaw + windowCenterZ * sinYaw;
    float rotCenterZ = -windowCenterX * sinYaw + windowCenterZ * cosYaw;
    float halfDiag = length(vec2(windowHalfX, windowHalfZ));
    float depthBias = 2.0 * halfDiag;
    float maxRawDepth = 4.0 * halfDiag + heightScale * u_windowSize.y * u_cellSize.y;

    if(u_renderMode == 0) {
        // ============================================================
        // MODE 0: CELL RENDERING
        // ============================================================

        // The chunk mesh builder bakes each vertex's absolute world-space
        // position in at mesh-build time (see mesh-builder.ts's
        // bakeWorldOffsetInPlace) -- a_position is already true world
        // position, no per-frame offset needed here. u_worldOffset is still
        // used below for the depth-bias centering math, just not for this.
        vec3 worldPos = a_position;

        // Rotate world X/Z around +Y by orbit yaw before the diamond projection
        // (yaw 0 = identity, bit-for-bit original behavior).
        float rx = worldPos.x * cosYaw + worldPos.z * sinYaw;
        float rz = -worldPos.x * sinYaw + worldPos.z * cosYaw;

        // Apply axonometric projection
        vec2 isoX = rx * vec2(ISO_H, sinA);
        vec2 isoY = worldPos.y * vec2(0.0, -heightScale);
        vec2 isoZ = rz * vec2(-ISO_H, sinA);
        vec2 isoProjected = isoX + isoY + isoZ;

        // Convert to view space and apply zoom
        vec2 isoPos = (isoProjected - u_cameraPosition) * u_zoom;

        v_screenPos = isoPos;

        // Convert to clip space
        vec2 clipSpace = (isoPos / u_viewportSize) * 2.0;

        // Depth = projection onto axonometric view direction (centered + biased
        // to stay within [0, maxRawDepth] for any yaw — see comment above).
        // Higher sum = closer to camera = lower depth buffer value.
        float rawDepth = (rx - rotCenterX) + heightScale * worldPos.y + (rz - rotCenterZ) + depthBias;
        float clipDepth = 1.0 - rawDepth / maxRawDepth;

        gl_Position = vec4(clipSpace * vec2(1, -1), clipDepth, 1.0);

        v_uv = a_uv;
        v_worldPos = worldPos;
        v_worldNormal = a_normal;
        // Same reasoning as worldPos above -- a_origPosition is already
        // baked to true world-space at mesh-build time. The fragment
        // shader's reveal/AO/shadow sampling depends on this being real
        // world-space.
        v_origWorldPos = a_origPosition;
        v_emission = a_emission;
        v_trueFaceDir = a_trueFaceDir;

    } else {
        // ============================================================
        // MODE 1: SPRITE RENDERING
        // ============================================================

        // Rotate the sprite's world X/Z around +Y by orbit yaw before projecting
        // (same rotation as cell mode; only the anchor moves — the billboard
        // quad itself stays screen-space via u_rotation below).
        float rx = u_spritePosition.x * cosYaw + u_spritePosition.z * sinYaw;
        float rz = -u_spritePosition.x * sinYaw + u_spritePosition.z * cosYaw;

        // Apply axonometric projection to sprite's 3D world position
        vec2 isoX = rx * vec2(ISO_H, sinA);
        vec2 isoY = u_spritePosition.y * vec2(0.0, -heightScale);
        vec2 isoZ = rz * vec2(-ISO_H, sinA);
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

        // Per-vertex depth compensation: without this, gl_Position.z depends only on
        // u_spritePosition (the anchor), so the WHOLE quad -- feet and canopy alike --
        // shares one depth, even though canopy pixels land on different screen pixels
        // than the feet (via scaledVertex, a pure clip-space XY offset above). The
        // fragment shader's occlusion test (unified.frag) then compares that single
        // anchor depth against terrain's real per-pixel depth at each pixel's OWN
        // screen location -- over flat/open terrain this frequently misfires (a
        // canopy pixel gets compared against a neighboring ground cell's depth, not
        // the one under the sprite's own feet), silently discarding sprites that
        // should render normally.
        //
        // Fix: convert localVertex.y (this vertex's offset from the anchor, PRE-
        // rotation -- see below) into its equivalent world-Y contribution to
        // rawDepth, using the same heightScale relationship MODE 0 uses to turn a
        // world-Y delta into screen offset (isoY = worldPos.y * vec2(0.0,
        // -heightScale) above, then * u_zoom to enter view space -- localVertex.y *
        // u_spriteSize.y * u_zoom is already in that same view-space unit, matching
        // scaledVertex's own construction below). Equating the two and solving for
        // the equivalent world-Y delta gives effectiveYDelta = -(localVertex.y *
        // u_spriteSize.y) / heightScale; multiplying back by heightScale for
        // rawDepth cancels the division exactly, so it's written directly below
        // rather than ever dividing by heightScale (which -> 0 at a near-90-degree/
        // top-down axonometric angle -- avoiding the division avoids any Inf/NaN
        // risk on gl_Position.z entirely, not just approximately).
        //
        // At the anchor itself (localVertex == (0,0) by construction) this collapses
        // to the original heightScale * u_spritePosition.y bit-for-bit: no change to
        // where a sprite sits relative to the cell it's standing on. For a bottom-
        // center-anchored sprite (the common case), canopy vertices get
        // localVertex.y = -1, adding +u_spriteSize.y -- correctly reading as nearer
        // the camera than the feet, matching how a real MODE-0 vertex at that height
        // would behave. The adjustment is bounded by the sprite's own visual size
        // (|localVertex.y| <= ~1), so genuinely taller/nearer geometry (e.g. a wall
        // many cells tall) still correctly out-competes and occludes the whole
        // sprite -- this only corrects a sprite's depth against terrain at roughly
        // its own scale, it doesn't make it depth-cheat-proof.
        //
        // Uses PRE-rotation localVertex.y, not the rotated `rotated.y`/
        // `scaledVertex.y`: u_rotation is a cosmetic screen-plane billboard spin (see
        // this mode's header comment -- "the billboard quad itself stays screen-space
        // via u_rotation"), not a 3D lean, so it has no real height semantics to
        // preserve; keying depth to the image's own up/down axis keeps the depth
        // gradient stable (no flicker against nearby terrain) as a sprite spins in
        // place, at the cost that a rotated sprite's depth-boosted edge won't
        // visually track whichever edge currently reads as "top" on screen.
        float depthYTerm = heightScale * u_spritePosition.y - localVertex.y * u_spriteSize.y;

        // Same depth formula as cells (centered + biased for yaw safety), with
        // +1.0 so the sprite renders just in front of the cell surface at its position.
        float rawDepth = (rx - rotCenterX) + depthYTerm + (rz - rotCenterZ) + depthBias + 1.0;
        float clipDepth = 1.0 - rawDepth / maxRawDepth;

        gl_Position = vec4(clipSpace * vec2(1, -1), clipDepth, 1.0);
        v_uv = a_uv;

        v_worldPos = u_spritePosition;
        v_worldNormal = vec3(0.0, 0.0, 1.0);  // Unused by lighting (frag hardcodes world-up); kept for interface symmetry
        v_origWorldPos = u_spritePosition;
        v_screenPos = viewPos;
        v_emission = 0.0;  // Sprites have no per-vertex cell emission
        v_trueFaceDir = vec3(0.0, 1.0, 0.0);  // Unused (cell-highlight-only); kept for interface symmetry
    }
}
