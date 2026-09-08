#version 300 es

// Shared vertex stage for every fullscreen pass that needs GLSL ES 3.00 —
// currently the present blit, and later each user post-effect stage.
//
// post.vert is GLSL ES 1.00 and cannot be linked against a 3.00 fragment
// shader, so passes that need 3.00 features (integer samplers, in particular)
// use this instead. It is otherwise identical: a pass-through over the
// interleaved fullscreen quad buffer (position.xy, uv.xy — stride 16).

in vec2 a_position;
in vec2 a_uv;

out vec2 v_uv;

void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_uv = a_uv;
}
