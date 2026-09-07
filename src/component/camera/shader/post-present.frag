#version 300 es
precision highp float;

// Final blit: composite target (FBO_B) → default framebuffer.
//
// A straight 1:1 NEAREST copy, so it is exact — no filtering, no scaling, no
// colour math. The upscale already happened on the way into FBO_B.
//
// Alpha is copied verbatim rather than forced to 1.0. The canvas is created
// with `premultipliedAlpha: true` and the sprite pass blends into this target,
// so the alpha accumulated in FBO_B is exactly what the old direct-to-screen
// path left in the backbuffer. Overwriting it would change how the canvas
// composites against the page.

uniform sampler2D u_color;

in vec2 v_uv;
out vec4 fragColor;

void main() {
    fragColor = texture(u_color, v_uv);
}
