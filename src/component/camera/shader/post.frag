#version 300 es
// Deliberately mediump, matching this shader before it was ported to ES 3.00:
// the outline's depth-difference threshold below is tuned against mediump
// rounding, and promoting it would shift which edges fire.
precision mediump float;
// The id attachment is 16-bit; anything touching it must be highp.
precision highp int;

uniform sampler2D u_renderTexture;
uniform sampler2D u_depthTexture;
// Cell FBO's id attachment. R = material index, G = fogVisibility quantised to
// 16 bits (the cell pass has no aux attachment to put it in).
uniform highp usampler2D u_idTexture;
uniform vec2 u_uvScale;
uniform vec2 u_uvOffset;
uniform vec2 u_texelSize;        // 1 / fbo size, for neighbor sampling
uniform vec3 u_outlineColor;
uniform float u_outlineWeight;   // 0 = off (plain blit)
uniform float u_outlineThreshold;
uniform float u_outlineWidth;    // line thickness in pixels

in vec2 v_uv;

layout(location = 0) out vec4 fragColor;
layout(location = 1) out uvec2 fragIds;
layout(location = 2) out vec4 fragAux;

void main() {
    vec2 uv = v_uv * u_uvScale + u_uvOffset;
    vec4 scene = texture(u_renderTexture, uv);

    // Cliff-edge outline: the depth buffer is linear (orthographic w=1), so a
    // neighbor depth-difference directly flags silhouette / elevation discontinuities.
    if(u_outlineWeight > 0.0) {
        // Sampling neighbors `width` pixels out flags every pixel within `width` of a
        // depth step → a ~width-thick contour band.
        vec2 ox = vec2(u_texelSize.x * u_outlineWidth, 0.0);
        vec2 oy = vec2(0.0, u_texelSize.y * u_outlineWidth);
        float c = texture(u_depthTexture, uv).r;
        float l = texture(u_depthTexture, uv - ox).r;
        float r = texture(u_depthTexture, uv + ox).r;
        float d = texture(u_depthTexture, uv - oy).r;
        float u = texture(u_depthTexture, uv + oy).r;
        float edge = max(max(abs(c - l), abs(c - r)), max(abs(c - d), abs(c - u)));
        float amt = step(u_outlineThreshold, edge) * u_outlineWeight;
        scene.rgb = mix(scene.rgb, u_outlineColor, amt);
    }

    fragColor = scene;

    // Carry the cell masks base → full resolution. NEAREST on an integer
    // texture makes this exact, so ids survive the upscale unchanged.
    uvec2 ids = texture(u_idTexture, uv).rg;
    // Sprite id starts at 0 ("no sprite here"); the sprite pass overwrites it
    // where it draws.
    fragIds = uvec2(ids.r, 0u);
    // Sprite coverage starts at 0 and accumulates through the sprite pass's
    // alpha blend. Fog is unpacked from the 16-bit carrier above. Alpha is 1.0
    // so this pass lays down a fully-opaque base for that blend to work
    // against — this pass itself runs with blending disabled.
    fragAux = vec4(0.0, float(ids.g) / 65535.0, 0.0, 1.0);
}
