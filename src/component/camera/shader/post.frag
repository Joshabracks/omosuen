precision mediump float;
uniform sampler2D u_renderTexture;
uniform sampler2D u_depthTexture;
uniform vec2 u_uvScale;
uniform vec2 u_uvOffset;
uniform vec2 u_texelSize;        // 1 / fbo size, for neighbor sampling
uniform vec3 u_outlineColor;
uniform float u_outlineWeight;   // 0 = off (plain blit)
uniform float u_outlineThreshold;
uniform float u_outlineWidth;    // line thickness in pixels
varying vec2 v_uv;

void main() {
    vec2 uv = v_uv * u_uvScale + u_uvOffset;
    vec4 scene = texture2D(u_renderTexture, uv);

    // Cliff-edge outline: the depth buffer is linear (orthographic w=1), so a
    // neighbor depth-difference directly flags silhouette / elevation discontinuities.
    if(u_outlineWeight > 0.0) {
        // Sampling neighbors `width` pixels out flags every pixel within `width` of a
        // depth step → a ~width-thick contour band.
        vec2 ox = vec2(u_texelSize.x * u_outlineWidth, 0.0);
        vec2 oy = vec2(0.0, u_texelSize.y * u_outlineWidth);
        float c = texture2D(u_depthTexture, uv).r;
        float l = texture2D(u_depthTexture, uv - ox).r;
        float r = texture2D(u_depthTexture, uv + ox).r;
        float d = texture2D(u_depthTexture, uv - oy).r;
        float u = texture2D(u_depthTexture, uv + oy).r;
        float edge = max(max(abs(c - l), abs(c - r)), max(abs(c - d), abs(c - u)));
        float amt = step(u_outlineThreshold, edge) * u_outlineWeight;
        scene.rgb = mix(scene.rgb, u_outlineColor, amt);
    }

    gl_FragColor = scene;
}
