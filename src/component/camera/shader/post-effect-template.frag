#version 300 es
//
// Post-effect template — the starting point for a `camera.postEffects` stage.
//
// Copy this file, then replace the `fragColor` line at the bottom. Everything
// above it documents the complete set of inputs the engine hands every stage.
//
// As written this stage is a provable identity: it references every contract
// input (so a missing or renamed uniform shows up at link time rather than the
// first time someone uses it), yet the output is bit-for-bit the input colour.
// That makes it a regression test as well as a template — publishing it and
// comparing against an empty chain proves the chain machinery is transparent.
//
// PRECISION: ids are 16-bit. `mediump int` is only guaranteed to +-32767 and
// `mediump float` is exact only to 2048, so anything touching an id must be
// highp. Do not lower these.
precision highp float;
precision highp int;

// ── Colour ───────────────────────────────────────────────────────────────────
// The previous stage's output; the composited frame for stage 0.
uniform sampler2D u_color;

// ── Per-texel masks ──────────────────────────────────────────────────────────
// r = cell material index, g = sprite `shaderId` (0 = no sprite here).
//
// `cell_index` is the LITERAL material index, so material 0 is a real material
// and reads as 0 just like empty space does. To ask "is there terrain here?",
// use depth: `u_depth >= 1.0` means nothing was drawn.
uniform highp usampler2D u_ids;

// r = sprite coverage 0..1 (0 = pure terrain/void, 1 = fully covered by a
//     sprite, in between = a soft sprite edge, accumulated across overlaps)
// g = fog-of-war visibility 0..1
//
// `sprite_index` and this coverage answer DIFFERENT questions, and they can
// disagree. Ids are written on an integer attachment, which does not blend, so
// a sprite fragment stamps its id whatever its alpha; coverage blends, so a
// fragment that ends up almost fully transparent contributes ~0 coverage while
// still owning the id. Key off `sprite_index` for "which sprite is here" and
// off coverage for "how much of it is visible".
uniform sampler2D u_aux;

// ── Depth ────────────────────────────────────────────────────────────────────
// Linear depth (the projection is orthographic, so this is genuinely linear in
// view distance — no un-projection needed). Lives at the BASE resolution, not
// the full one, so sample it through the bridge below rather than with v_uv.
uniform sampler2D u_depth;
uniform vec2 u_depthUvScale;
uniform vec2 u_depthUvOffset;

// ── Frame ────────────────────────────────────────────────────────────────────
uniform vec2 u_resolution;   // full-res target size, in pixels
uniform vec2 u_texelSize;    // 1.0 / u_resolution
uniform float u_time;        // seconds since engine start
uniform int u_frame;         // monotonically increasing frame counter
uniform int u_stageIndex;    // this stage's position in the chain, from 0

// ── Camera ───────────────────────────────────────────────────────────────────
// Present so a screen-space effect can stay locked to the world as the camera
// orbits — the halftone case this API was built for. Much harder to retrofit
// than to use, so reach for it rather than hard-coding screen space.
uniform float u_orbitYaw;           // degrees
uniform float u_axonometricAngle;   // degrees (pitch)
uniform float u_zoom;
uniform float u_pixelScale;
uniform vec3 u_cameraWorldPos;
uniform vec3 u_cellSize;

in vec2 v_uv;
out vec4 fragColor;

void main() {
    vec4 color = texture(u_color, v_uv);

    // Masks. Compare ids as integers — never round-trip them through a float.
    uvec2 ids = texture(u_ids, v_uv).rg;
    uint cellIndex = ids.r;
    uint spriteIndex = ids.g;

    vec4 aux = texture(u_aux, v_uv);
    float spriteMix = aux.r;
    float fogVisibility = aux.g;

    // Depth is base-resolution; the bridge maps a full-res UV into it.
    float depth = texture(u_depth, v_uv * u_depthUvScale + u_depthUvOffset).r;
    bool isVoid = depth >= 1.0;

    // Reference every input so none is dropped from the active-uniform set and
    // the whole contract is verified at link time. Multiplying by 0.0 keeps
    // this stage bit-identical to no stage at all.
    //
    // Caveat: `x * 0.0` is NaN when x is NaN or Inf. Every input above is
    // finite by construction, so the identity holds — but if that ever stops
    // being true, this template stops being an identity and the test scene's
    // first assertion will catch it.
    float witness =
          float(cellIndex) + float(spriteIndex)
        + spriteMix + fogVisibility + depth + (isVoid ? 1.0 : 0.0)
        + dot(u_depthUvScale, vec2(1.0)) + dot(u_depthUvOffset, vec2(1.0))
        + dot(u_resolution, vec2(1.0)) + dot(u_texelSize, vec2(1.0))
        + u_time + float(u_frame) + float(u_stageIndex)
        + u_orbitYaw + u_axonometricAngle + u_zoom + u_pixelScale
        + dot(u_cameraWorldPos, vec3(1.0)) + dot(u_cellSize, vec3(1.0))
        + dot(v_uv, vec2(1.0));

    // Replace this line with your effect.
    fragColor = color + vec4(witness * 0.0);
}
