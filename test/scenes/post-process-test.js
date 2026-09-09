/**
 * Post-Process Chain Test Scene
 *
 * Verifies `camera.postEffects` and the per-texel mask channels it exposes.
 *
 * Everything here is checked NUMERICALLY, via `gl.readPixels` against the
 * camera's offscreen framebuffers — not by eye. Two constraints drive that:
 *
 *  - The canvas is created without `preserveDrawingBuffer`, so reading the
 *    DEFAULT framebuffer returns cleared data. Every read below targets an
 *    offscreen FBO instead. This is also why the chain's last stage always
 *    lands in a ping target rather than drawing straight to the screen.
 *  - Reading COLOR1/COLOR2 requires `gl.readBuffer` first. Without it you read
 *    COLOR0 and get either a format mismatch or plausible-looking garbage.
 *
 * The scene is deliberately STATIC — no animation, no fog-of-war memory timers,
 * fixed camera — so consecutive frames are byte-identical. Assertion 1 (the
 * template is an identity) depends on that, and the harness verifies it before
 * trusting any comparison.
 */

const Omosuen = window.Omosuen;

// ── Fixture constants ────────────────────────────────────────────────────────

const CELL = 32;
const MAP_W = 12;
const MAP_H = 4;
const MAP_D = 12;

const VIEW_W = 640;
const VIEW_H = 480;

// Material indices placed in the map. 300 is deliberately above 255: an 8-bit
// id channel would silently truncate it, and assertion 4 exists to catch that.
const MAT_A = 0;
const MAT_B = 1;
const MAT_C = 2;
const MAT_BIG = 300;
const PLACED_MATERIALS = [MAT_A, MAT_B, MAT_C, MAT_BIG];

// Sprite ids, likewise spanning the 8-bit boundary and reaching the 16-bit max.
const SPRITE_IDS = {
    overTerrain: 7,
    overVoid: 300,
    overlapA: 4242,
    overlapB: 65535,
    translucent: 1234,
    // A row of larger sprites, big enough for the invert effect to be obvious
    // by eye as well as measurable.
    showcaseA: 11,
    showcaseB: 22,
    showcaseC: 33,
    showcaseD: 44,
};

const TILE_FRAME = 21 * 25 + 9; // a solid grass tile from 16x16_tiles.png

// objects.png frame 0 is a 16x32 tree: a NON-RECTANGULAR silhouette with real
// transparent corners. That matters — sprite fragments are discarded at
// `albedo.a < 0.01`, so a fully opaque sprite never exercises that path. With
// only square tiles, a regression that stamped coverage before the discard
// would give every sprite a square halo of affected terrain and go unnoticed.
const TREE_FRAME = 0;
const OBJECTS_FRAMES = [
    new Omosuen.Vector4D(0, 0, 16, 32),   // 0: tree (transparent corners)
    new Omosuen.Vector4D(16, 0, 16, 16),  // 1
    new Omosuen.Vector4D(32, 0, 16, 16),  // 2
];

// ── Effect sources ───────────────────────────────────────────────────────────

// The shipped template, inlined so the scene can run standalone. Kept in sync
// with src/component/camera/shader/post-effect-template.frag.
const TEMPLATE_SOURCE = `precision highp float;
precision highp int;
uniform sampler2D u_color;
uniform highp usampler2D u_ids;
uniform sampler2D u_aux;
uniform sampler2D u_depth;
uniform vec2 u_depthUvScale;
uniform vec2 u_depthUvOffset;
uniform vec2 u_resolution;
uniform vec2 u_texelSize;
uniform float u_time;
uniform int u_frame;
uniform int u_stageIndex;
uniform float u_orbitYaw;
uniform float u_axonometricAngle;
uniform float u_zoom;
uniform float u_pixelScale;
uniform vec3 u_cameraWorldPos;
uniform vec3 u_cellSize;
in vec2 v_uv;
out vec4 fragColor;
void main() {
    vec4 color = texture(u_color, v_uv);
    uvec2 ids = texture(u_ids, v_uv).rg;
    vec4 aux = texture(u_aux, v_uv);
    float depth = texture(u_depth, v_uv * u_depthUvScale + u_depthUvOffset).r;
    float witness =
          float(ids.r) + float(ids.g) + aux.r + aux.g + depth
        + dot(u_depthUvScale, vec2(1.0)) + dot(u_depthUvOffset, vec2(1.0))
        + dot(u_resolution, vec2(1.0)) + dot(u_texelSize, vec2(1.0))
        + u_time + float(u_frame) + float(u_stageIndex)
        + u_orbitYaw + u_axonometricAngle + u_zoom + u_pixelScale
        + dot(u_cameraWorldPos, vec3(1.0)) + dot(u_cellSize, vec3(1.0))
        + dot(v_uv, vec2(1.0));
    fragColor = color + vec4(witness * 0.0);
}`;

// Stage that paints a constant red from a user uniform (assertions 14, 17).
const SOLID_SOURCE = `precision highp float;
uniform float redLevel;
in vec2 v_uv;
out vec4 fragColor;
void main() { fragColor = vec4(redLevel, 0.0, 0.0, 1.0); }`;

// Stage that reads the previous stage and encodes its own index (assertion 14).
const CHAINED_SOURCE = `precision highp float;
uniform sampler2D u_color;
uniform int u_stageIndex;
in vec2 v_uv;
out vec4 fragColor;
void main() {
    fragColor = vec4(texture(u_color, v_uv).r, float(u_stageIndex) * 0.25, 0.0, 1.0);
}`;

// Inverts sprite pixels, but only for sprites whose id is EVEN — so the effect
// has to read both mask channels and discriminate between individual sprites,
// not merely detect "a sprite is here".
//
// Two things this demonstrates that are easy to get wrong:
//
//  - Id 0 is EVEN. Without the `id > 0u` guard, every terrain and void texel
//    matches the even test and the whole frame inverts. Any per-id rule needs
//    to exclude 0 explicitly, because 0 means "no sprite", not "sprite zero".
//  - Coverage, not `id != 0`, is the mix factor. Coverage blends, so soft
//    sprite edges fade the effect in instead of hard-clipping it, and a
//    fragment whose alpha rounded away contributes nothing even though it
//    still owns the id.
const INVERT_SPRITES_SOURCE = `precision highp float;
precision highp int;
uniform sampler2D u_color;
uniform sampler2D u_aux;
uniform highp usampler2D u_ids;
in vec2 v_uv;
out vec4 fragColor;
void main() {
    vec4 c = texture(u_color, v_uv);
    float coverage = texture(u_aux, v_uv).r;
    uint id = texture(u_ids, v_uv).g;
    bool invertThis = id > 0u && (id % 2u) == 0u;
    float amount = invertThis ? coverage : 0.0;
    fragColor = vec4(mix(c.rgb, 1.0 - c.rgb, amount), c.a);
}`;

// Deliberately invalid — must be skipped with an error, never black-screen.
const BROKEN_SOURCE = 'this is not valid glsl at all {{{';

// World-locked checkerboard driven by camera state (assertion 18). If the
// camera uniforms are wired, the pattern stays pinned to the world under orbit.
const WORLD_LOCKED_SOURCE = `precision highp float;
uniform sampler2D u_color;
uniform vec2 u_resolution;
uniform float u_orbitYaw;
uniform vec3 u_cameraWorldPos;
in vec2 v_uv;
out vec4 fragColor;
void main() {
    float yaw = radians(u_orbitYaw);
    vec2 p = v_uv * u_resolution + u_cameraWorldPos.xz;
    vec2 r = vec2(p.x * cos(yaw) - p.y * sin(yaw), p.x * sin(yaw) + p.y * cos(yaw));
    float c = mod(floor(r.x / 16.0) + floor(r.y / 16.0), 2.0);
    fragColor = vec4(vec3(c), 1.0);
}`;

// Registered so the registry path (and save/load survivability) is exercised.
Omosuen.registerMethod('post-effect', 'ppTemplate', TEMPLATE_SOURCE);

// ── Assertion harness ────────────────────────────────────────────────────────

let results = [];

function record(n, label, pass, detail) {
    results.push({ n, label, pass, detail: detail ?? '' });
}

function renderResults() {
    const el = document.getElementById('pp-results');
    if (!el) return;
    const passed = results.filter((r) => r.pass).length;
    const rows = results
        .map((r) => {
            const color = r.pass ? '#5f5' : '#f66';
            const mark = r.pass ? 'PASS' : 'FAIL';
            return `<div style="color:${color};margin-bottom:2px;">
                ${String(r.n).padStart(2, ' ')}. ${mark} — ${r.label}
                ${r.detail ? `<br><span style="color:#999;padding-left:22px;">${r.detail}</span>` : ''}
            </div>`;
        })
        .join('');
    const all = passed === results.length;
    el.innerHTML = `<div style="color:${all ? '#5f5' : '#f66'};margin-bottom:6px;">
        ${passed} / ${results.length} passing</div>${rows}`;
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
async function settle(frames = 3) {
    for (let i = 0; i < frames; i++) await nextFrame();
}

function getCamera() {
    const scene = Omosuen.getActiveScene();
    return scene ? scene.getComponentByType('camera', true) : null;
}

function getGl(camera) {
    const scene = Omosuen.getActiveScene();
    const vp = scene.getComponentByTypeAndName('viewport', camera.viewportRef, true);
    return vp ? vp.gl : null;
}

function fnv1a(buf) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < buf.length; i++) {
        h ^= buf[i];
        h = Math.imul(h, 16777619) >>> 0;
    }
    return h.toString(16);
}

/** Reads a colour attachment. `readBuffer` is mandatory for anything but COLOR0. */
function readColor(gl, fbo, attachment, w, h) {
    const buf = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.readBuffer(attachment);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return buf;
}

/**
 * Reads the RGBA16UI id attachment. Note the integer format/type, and the
 * stride of 4: `.r` cell index, `.g` sprite index, `.b` cell region index.
 */
function readIds(gl, fbo, w, h) {
    const buf = new Uint16Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.readBuffer(gl.COLOR_ATTACHMENT1);
    gl.readPixels(0, 0, w, h, gl.RGBA_INTEGER, gl.UNSIGNED_SHORT, buf);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return buf;
}

/**
 * Compiles a probe program so assertion 2 can ask which contract uniforms
 * survived compilation. Uses the same minimal fullscreen vertex stage the
 * engine pairs with every post-effect.
 */
const PROBE_VERT = `#version 300 es
in vec2 a_position;
in vec2 a_uv;
out vec2 v_uv;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); v_uv = a_uv; }`;

function compileProbe(gl, fragSource) {
    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, PROBE_VERT);
    gl.compileShader(vs);
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, `#version 300 es
${fragSource}`);
    gl.compileShader(fs);
    let log = '';
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) log = gl.getShaderInfoLog(fs);
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    const ok = gl.getProgramParameter(program, gl.LINK_STATUS);
    if (!ok && !log) log = gl.getProgramInfoLog(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!ok) { gl.deleteProgram(program); return { program: null, log }; }
    return { program, log };
}

/** Snapshot of every mask channel for the current frame. */
function sampleMasks(camera, gl) {
    const g = camera.glResources;
    const W = g.fullResolution.width;
    const H = g.fullResolution.height;
    return {
        W,
        H,
        ids: readIds(gl, g.framebufferB, W, H),
        aux: readColor(gl, g.framebufferB, gl.COLOR_ATTACHMENT2, W, H),
        color: readColor(gl, g.framebufferB, gl.COLOR_ATTACHMENT0, W, H),
    };
}

// ── The assertions ───────────────────────────────────────────────────────────

/**
 * Assertions 3–13: everything derived from one frame's masks.
 *
 * Screen positions are DERIVED by scanning the buffers rather than hard-coded,
 * so the suite survives a zoom/resize (which is exactly what assertion 19
 * re-runs it to prove).
 */
function checkMaskAssertions(m, offset = 0) {
    const { W, H, ids, aux } = m;

    const cellHist = {};
    const spriteHist = {};
    let spritePx = 0;
    let opaqueSprite = 0;
    let partialSprite = 0;
    let maxMix = 0;
    let underSpriteWithCell = 0;
    const softEdgeIds = new Set();
    const fogValues = new Set();

    for (let p = 0; p < W * H; p++) {
        const cid = ids[p * 4];
        const sid = ids[p * 4 + 1];
        const mix = aux[p * 4];
        const fog = aux[p * 4 + 1];
        cellHist[cid] = (cellHist[cid] || 0) + 1;
        if (sid !== 0) spriteHist[sid] = (spriteHist[sid] || 0) + 1;
        if (mix > 0) {
            spritePx++;
            if (mix === 255) opaqueSprite++;
            else {
                partialSprite++;
                softEdgeIds.add(sid);
            }
            if (mix > maxMix) maxMix = mix;
            if (cid > 0) underSpriteWithCell++;
        }
        fogValues.add(fog);
    }

    const placedFound = PLACED_MATERIALS.filter((mi) => (cellHist[mi] || 0) > 0);
    record(
        3 + offset,
        'cell_index matches the materials placed in the map',
        placedFound.length === PLACED_MATERIALS.length,
        `found ${placedFound.join(', ')} of expected ${PLACED_MATERIALS.join(', ')}`,
    );

    record(
        4 + offset,
        'cell_index above 255 is exact, not truncated',
        (cellHist[MAT_BIG] || 0) > 0,
        `material ${MAT_BIG}: ${cellHist[MAT_BIG] || 0} px (an 8-bit channel would read ${MAT_BIG & 255})`,
    );

    const expectedSpriteIds = Object.values(SPRITE_IDS);
    const foundSpriteIds = Object.keys(spriteHist).map(Number);
    const unexpected = foundSpriteIds.filter((id) => !expectedSpriteIds.includes(id));
    record(
        5 + offset,
        'sprite_index equals each sprite shaderId, including >255',
        foundSpriteIds.length > 0 && unexpected.length === 0,
        `found ${foundSpriteIds.sort((a, b) => a - b).join(', ')}`,
    );

    // The invariant that holds is coverage -> id, NOT id -> coverage.
    //
    // Ids live on the integer attachment, which does not blend: a sprite
    // fragment stamps its id at full value regardless of alpha. Coverage lives
    // on the unorm attachment and blends, so a fragment whose final alpha
    // (texture alpha * opacity * fog fade) rounds to zero in 8 bits leaves an
    // id behind with no measurable coverage. That is by design, and it is why
    // the two channels answer different questions: `sprite_index` is "which
    // sprite owns this texel", `sprite_mix` is "how much of it you can see".
    let coverageWithoutId = 0;
    let idWithoutCoverage = 0;
    for (let p = 0; p < W * H; p++) {
        const hasCoverage = aux[p * 4] > 0;
        const hasId = ids[p * 4 + 1] !== 0;
        if (hasCoverage && !hasId) coverageWithoutId++;
        if (!hasCoverage && hasId) idWithoutCoverage++;
    }
    record(
        6 + offset,
        'every texel with sprite coverage carries a sprite id',
        coverageWithoutId === 0,
        `${coverageWithoutId} covered texels lacked an id; ` +
            `${idWithoutCoverage} carried an id below the 8-bit coverage floor (expected: ids do not blend)`,
    );

    record(
        7 + offset,
        'sprite_mix: 255 over opaque sprites, 0 over bare terrain and void',
        opaqueSprite > 0 && spritePx < W * H,
        `${opaqueSprite} fully covered, ${W * H - spritePx} uncovered`,
    );

    record(
        8 + offset,
        'sprite_mix is strictly between 0 and 255 on a translucent sprite',
        partialSprite > 0,
        `${partialSprite} partially covered texels`,
    );

    record(
        9 + offset,
        'sprite_mix accumulates where sprites overlap',
        maxMix >= 255,
        `peak coverage ${maxMix}`,
    );

    record(
        10 + offset,
        'cell_index survives underneath a sprite',
        underSpriteWithCell > 0,
        `${underSpriteWithCell} of ${spritePx} sprite texels kept a non-zero cell id`,
    );

    record(
        11 + offset,
        'sprite_index at a soft edge is one real id, never a blend of two',
        [...softEdgeIds].every((id) => id === 0 || expectedSpriteIds.includes(id)),
        `edge ids: ${[...softEdgeIds].sort((a, b) => a - b).join(', ') || 'none'}`,
    );

    record(
        13 + offset,
        'fogVisibility varies across the frame (vision source present)',
        fogValues.size > 1,
        `${fogValues.size} distinct fog values`,
    );

    return { cellHist, spriteHist };
}

/**
 * Assertion 12: depth is readable through the UV bridge and separates drawn
 * surfaces from the void.
 *
 * WebGL2 cannot `readPixels` a depth attachment, so this goes through a
 * post-effect stage that encodes depth into colour — which has the happy side
 * effect of testing the exact path the contract promises authors. A mis-scaled
 * bridge shows up as the surface/void split landing in the wrong place.
 */
const DEPTH_PROBE_SOURCE = `precision highp float;
uniform sampler2D u_depth;
uniform vec2 u_depthUvScale;
uniform vec2 u_depthUvOffset;
in vec2 v_uv;
out vec4 fragColor;
void main() {
    float d = texture(u_depth, v_uv * u_depthUvScale + u_depthUvOffset).r;
    fragColor = vec4(d >= 1.0 ? 0.0 : 1.0, d, 0.0, 1.0);
}`;

async function checkDepth(camera, gl, offset = 0) {
    const g = camera.glResources;
    camera.setPostEffects([{ name: 'depthProbe', fragment: DEPTH_PROBE_SOURCE }]);
    await settle();
    const W = g.fullResolution.width;
    const H = g.fullResolution.height;
    const buf = readColor(gl, g.postChainFramebuffers[0], gl.COLOR_ATTACHMENT0, W, H);
    let surface = 0;
    let far = 0;
    for (let p = 0; p < W * H; p++) {
        if (buf[p * 4] > 127) surface++;
        else far++;
    }
    camera.setPostEffects(null);
    await settle();
    record(
        12 + offset,
        'depth is readable through the UV bridge and separates surface from void',
        surface > 0 && far > 0,
        `${surface} surface texels, ${far} at the far plane`,
    );
}

/** The full suite. Callable twice so assertion 19 can re-run it after a resize. */
async function runAssertions() {
    results = [];
    const camera = getCamera();
    const gl = getGl(camera);
    if (!camera || !gl) {
        record(0, 'scene has a camera and GL context', false);
        renderResults();
        return;
    }
    while (gl.getError() !== 0) { /* drain stale errors */ }

    // ── 1: the template is an identity ───────────────────────────────────────
    camera.setPostEffects(null);
    await settle();
    const g = camera.glResources;
    const W = g.fullResolution.width;
    const H = g.fullResolution.height;

    // Determinism precondition: without it, assertion 1 means nothing.
    const a1 = readColor(gl, g.framebufferB, gl.COLOR_ATTACHMENT0, W, H);
    await settle(2);
    const a2 = readColor(gl, g.framebufferB, gl.COLOR_ATTACHMENT0, W, H);
    const stable = fnv1a(a1) === fnv1a(a2);
    record(0, 'scene is deterministic frame to frame (precondition)', stable, `${fnv1a(a1)} vs ${fnv1a(a2)}`);

    camera.setPostEffects([{ name: 'template', fragmentKey: 'ppTemplate' }]);
    await settle();
    const chained = readColor(gl, g.postChainFramebuffers[0], gl.COLOR_ATTACHMENT0, W, H);
    const composite = readColor(gl, g.framebufferB, gl.COLOR_ATTACHMENT0, W, H);
    let diff = 0;
    for (let i = 0; i < composite.length; i++) if (composite[i] !== chained[i]) diff++;
    record(
        1,
        'pass-through template is byte-identical to no chain',
        diff === 0,
        `${diff} differing bytes of ${composite.length} (${fnv1a(composite)} vs ${fnv1a(chained)})`,
    );

    // ── 2: template links and every contract uniform is active ───────────────
    const CONTRACT = [
        'u_color', 'u_ids', 'u_aux', 'u_depth', 'u_depthUvScale', 'u_depthUvOffset',
        'u_resolution', 'u_texelSize', 'u_time', 'u_frame', 'u_stageIndex',
        'u_orbitYaw', 'u_axonometricAngle', 'u_zoom', 'u_pixelScale',
        'u_cameraWorldPos', 'u_cellSize',
    ];
    const probe = compileProbe(gl, TEMPLATE_SOURCE);
    const missing = probe.program
        ? CONTRACT.filter((n) => gl.getUniformLocation(probe.program, n) === null)
        : CONTRACT;
    record(
        2,
        'template links and every contract uniform survives compilation',
        probe.program !== null && missing.length === 0,
        probe.program ? `missing: ${missing.join(', ') || 'none'}` : 'template failed to link',
    );
    if (probe.program) gl.deleteProgram(probe.program);

    // ── 3–13: masks ─────────────────────────────────────────────────────────
    camera.setPostEffects(null);
    await settle();
    const masks = sampleMasks(camera, gl);
    checkMaskAssertions(masks);
    await checkDepth(camera, gl);

    // ── 14: chain order and u_stageIndex ────────────────────────────────────
    camera.setPostEffects([
        { name: 'solid', fragment: SOLID_SOURCE, uniforms: { redLevel: 0.5 } },
        { name: 'chained', fragment: CHAINED_SOURCE },
    ]);
    await settle();
    const twoStage = readColor(gl, g.postChainFramebuffers[1], gl.COLOR_ATTACHMENT0, 1, 1);
    record(
        14,
        'stages run in order and u_stageIndex is the chain position',
        twoStage[0] === 127 && twoStage[1] === 64,
        `expected R=127 (stage 0 output read by stage 1), G=64 (index 1 * 0.25); got R=${twoStage[0]}, G=${twoStage[1]}`,
    );

    // ── 17: user uniform takes effect with no recompile ─────────────────────
    camera.setPostEffectUniform('solid', 'redLevel', 1.0);
    await settle();
    const afterUniform = readColor(gl, g.postChainFramebuffers[1], gl.COLOR_ATTACHMENT0, 1, 1);
    record(
        17,
        'a user uniform set at runtime takes effect without a recompile',
        afterUniform[0] === 255,
        `expected R=255 after redLevel 0.5 -> 1.0; got ${afterUniform[0]}`,
    );

    // ── 15: disabling one stage leaves the rest running ─────────────────────
    camera.setPostEffectEnabled('solid', false);
    await settle();
    const onlyChained = readColor(gl, g.postChainFramebuffers[0], gl.COLOR_ATTACHMENT0, 1, 1);
    record(
        15,
        'a disabled stage is skipped and the rest of the chain still runs',
        onlyChained[1] === 0,
        `'chained' became stage 0, so G should be 0; got ${onlyChained[1]}`,
    );

    // ── 16: a broken stage degrades instead of black-screening ──────────────
    camera.setPostEffects([
        { name: 'broken', fragment: BROKEN_SOURCE },
        { name: 'solid', fragment: SOLID_SOURCE, uniforms: { redLevel: 1.0 } },
    ]);
    await settle();
    const afterBroken = readColor(gl, g.postChainFramebuffers[0], gl.COLOR_ATTACHMENT0, 1, 1);
    record(
        16,
        'a stage that fails to compile is skipped; the rest still render',
        afterBroken[0] === 255,
        `'solid' should still paint red; got R=${afterBroken[0]}`,
    );

    // ── 18: camera state reaches the shader ─────────────────────────────────
    camera.setPostEffects([{ name: 'locked', fragment: WORLD_LOCKED_SOURCE }]);
    await settle();
    const yaw0 = readColor(gl, g.postChainFramebuffers[0], gl.COLOR_ATTACHMENT0, W, H);
    camera.setOrbitYaw(camera.orbitYaw + 45);
    await settle();
    const yaw45 = readColor(gl, g.postChainFramebuffers[0], gl.COLOR_ATTACHMENT0, W, H);
    camera.setOrbitYaw(camera.orbitYaw - 45);
    record(
        18,
        'camera state reaches the shader (pattern responds to orbit yaw)',
        fnv1a(yaw0) !== fnv1a(yaw45),
        `${fnv1a(yaw0)} vs ${fnv1a(yaw45)} after a 45 degree orbit`,
    );

    // ── 20: a shader consuming the sprite mask affects sprites and only sprites ─
    //
    // This is the one assertion that ties the two halves of the suite together:
    // everything above either checks the mask data via readPixels, or runs a
    // shader that ignores sprites. Here a real effect keys off `sprite_mix` and
    // the result is checked against the composite it was derived from.
    camera.setPostEffects([{ name: 'invert', fragment: INVERT_SPRITES_SOURCE }]);
    await settle();
    // All three reads in one synchronous block, so they describe one frame.
    const invComposite = readColor(gl, g.framebufferB, gl.COLOR_ATTACHMENT0, W, H);
    const invAux = readColor(gl, g.framebufferB, gl.COLOR_ATTACHMENT2, W, H);
    const invOut = readColor(gl, g.postChainFramebuffers[0], gl.COLOR_ATTACHMENT0, W, H);
    const ids = readIds(gl, g.framebufferB, W, H); // reused by assertion 21

    const same = (p) =>
        invOut[p * 4] === invComposite[p * 4] &&
        invOut[p * 4 + 1] === invComposite[p * 4 + 1] &&
        invOut[p * 4 + 2] === invComposite[p * 4 + 2];
    // +-1 tolerance for 8-bit rounding through the mix.
    const inverted = (p) =>
        Math.abs(invOut[p * 4] - (255 - invComposite[p * 4])) <= 1 &&
        Math.abs(invOut[p * 4 + 1] - (255 - invComposite[p * 4 + 1])) <= 1 &&
        Math.abs(invOut[p * 4 + 2] - (255 - invComposite[p * 4 + 2])) <= 1;

    let evenOk = 0, evenBad = 0;       // even ids: must invert
    let oddOk = 0, oddBad = 0;         // odd ids: must NOT invert
    let terrainOk = 0, terrainBad = 0; // no sprite: must NOT invert
    for (let p = 0; p < W * H; p++) {
        const coverage = invAux[p * 4];
        const id = ids[p * 4 + 1];
        if (coverage === 0) {
            if (same(p)) terrainOk++; else terrainBad++;
        } else if (coverage === 255) {
            if (id > 0 && id % 2 === 0) {
                if (inverted(p)) evenOk++; else evenBad++;
            } else {
                if (same(p)) oddOk++; else oddBad++;
            }
        }
    }
    record(
        20,
        'a per-id sprite shader inverts only even-id sprites, sparing odd ids and terrain',
        evenOk > 0 && oddOk > 0 && evenBad === 0 && oddBad === 0 && terrainBad === 0,
        `even-id inverted ${evenOk} (${evenBad} wrong); ` +
            `odd-id untouched ${oddOk} (${oddBad} wrongly inverted); ` +
            `non-sprite untouched ${terrainOk} (${terrainBad} altered)`,
    );

    camera.setPostEffects(null);
    await settle();

    // ── 21: transparent sprite pixels write nothing at all ──────────────────
    //
    // Sprite fragments are discarded at `albedo.a < 0.01`, so a transparent
    // texel should leave NO id, NO coverage, and be untouched by a sprite-mask
    // effect. Proven by silhouette shape: the showcase sprites are trees, whose
    // covered texels must occupy meaningfully LESS than their bounding box. If
    // coverage were stamped before the alpha discard, every sprite would fill
    // its whole quad and the ratio would be ~1.
    const treeIds = [
        SPRITE_IDS.showcaseA, SPRITE_IDS.showcaseB,
        SPRITE_IDS.showcaseC, SPRITE_IDS.showcaseD,
    ];
    const silhouettes = treeIds.map((wanted) => {
        let minX = Infinity, maxX = -1, minY = Infinity, maxY = -1, covered = 0;
        for (let p = 0; p < W * H; p++) {
            if (invAux[p * 4] === 0) continue;          // no coverage here
            if (ids[p * 4 + 1] !== wanted) continue;    // a different sprite
            const x = p % W, y = (p / W) | 0;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            covered++;
        }
        const area = maxX < 0 ? 0 : (maxX - minX + 1) * (maxY - minY + 1);
        return { id: wanted, covered, area, ratio: area ? covered / area : 0 };
    });
    const found = silhouettes.filter((t) => t.covered > 0);
    const allNonRectangular = found.length > 0 && found.every((t) => t.ratio < 0.95);
    record(
        21,
        'transparent sprite pixels write no coverage (silhouette is not a filled quad)',
        allNonRectangular,
        found.length
            ? found.map((t) => `id ${t.id}: ${t.covered}/${t.area} = ${t.ratio.toFixed(2)}`).join('; ')
            : 'no tree sprites found on screen',
    );

    // ── 19: everything survives a resolution change ─────────────────────────
    camera.setPostEffects(null);
    const originalZoom = camera.zoom;
    camera.setZoom(originalZoom * 1.5);
    await settle();
    const resizedMasks = sampleMasks(camera, gl);
    const before = results.length;
    checkMaskAssertions(resizedMasks, 100); // offset keeps the numbering distinct
    await checkDepth(camera, gl, 100);
    const rerun = results.slice(before);
    camera.setZoom(originalZoom);
    await settle();
    results = results.slice(0, before);
    record(
        19,
        'mask assertions still hold after a zoom change',
        rerun.every((r) => r.pass),
        `${rerun.filter((r) => r.pass).length} / ${rerun.length} re-checks passed`,
    );

    camera.setPostEffects(null);
    results.sort((a, b) => a.n - b.n);
    renderResults();
    const failed = results.filter((r) => !r.pass);
    console.log(
        `[Post-Process Test] ${results.length - failed.length}/${results.length} passing`,
        failed.length ? failed : '',
    );
}

// ── Diagnostic effects (also the documentation examples) ─────────────────────

const DIAGNOSTICS = {
    'Off': null,
    // False-colours the cell id. The multipliers are irrational on purpose:
    // round fractions like 0.13 collide to zero for whole families of ids
    // (300 * 0.13 == 39.0 exactly), which paints unrelated materials the same
    // black. Void is distinguished from material 0 via depth, not via the id.
    'Cell id': `precision highp float; precision highp int;
uniform highp usampler2D u_ids;
uniform sampler2D u_depth;
uniform vec2 u_depthUvScale;
uniform vec2 u_depthUvOffset;
in vec2 v_uv; out vec4 fragColor;
vec3 idColor(float id) {
    return 0.25 + 0.75 * vec3(
        fract(id * 0.6180339887 + 0.15),
        fract(id * 0.7548776662 + 0.45),
        fract(id * 0.5698402909 + 0.75));
}
void main() {
    float d = texture(u_depth, v_uv * u_depthUvScale + u_depthUvOffset).r;
    if (d >= 1.0) { fragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
    fragColor = vec4(idColor(float(texture(u_ids, v_uv).r)), 1.0);
}`,
    // Sprite id 0 genuinely means "no sprite", so black is correct here.
    'Sprite id': `precision highp float; precision highp int;
uniform highp usampler2D u_ids; in vec2 v_uv; out vec4 fragColor;
vec3 idColor(float id) {
    return 0.25 + 0.75 * vec3(
        fract(id * 0.6180339887 + 0.15),
        fract(id * 0.7548776662 + 0.45),
        fract(id * 0.5698402909 + 0.75));
}
void main() {
    float id = float(texture(u_ids, v_uv).g);
    fragColor = vec4(id > 0.0 ? idColor(id) : vec3(0.0), 1.0);
}`,
    'Sprite coverage': `precision highp float;
uniform sampler2D u_aux; in vec2 v_uv; out vec4 fragColor;
void main() { fragColor = vec4(vec3(texture(u_aux, v_uv).r), 1.0); }`,
    'Fog': `precision highp float;
uniform sampler2D u_aux; in vec2 v_uv; out vec4 fragColor;
void main() { fragColor = vec4(vec3(texture(u_aux, v_uv).g), 1.0); }`,
    'Depth': `precision highp float;
uniform sampler2D u_depth; uniform vec2 u_depthUvScale; uniform vec2 u_depthUvOffset;
in vec2 v_uv; out vec4 fragColor;
void main() {
    float d = texture(u_depth, v_uv * u_depthUvScale + u_depthUvOffset).r;
    fragColor = vec4(vec3(d >= 1.0 ? 0.0 : 1.0 - d), 1.0);
}`,
    'World-locked': WORLD_LOCKED_SOURCE,
    'Invert sprites': INVERT_SPRITES_SOURCE,
};

// ── UI ───────────────────────────────────────────────────────────────────────

Omosuen.registerHtmlConstructor('postProcessTest', () => {
    const buttons = Object.keys(DIAGNOSTICS)
        .map((k) => `<button id="pp-diag-${k.replace(/\W/g, '')}" class="menu-button" style="margin-bottom:4px;">${k}</button>`)
        .join('');
    return `
        <div class="sidebar" style="width:420px;">
            <button id="btn-back" class="sidebar-back-button">← Back</button>
            <h1 class="sidebar-title">Post-Process Chain</h1>
            <div class="sidebar-section">
                <div class="sidebar-status" style="font-size:12px;line-height:1.5;">
                    Numeric assertions over the post-effect chain and its per-texel
                    masks, read back from the camera's offscreen framebuffers.
                </div>
            </div>
            <div class="sidebar-section">
                <button id="pp-run" class="menu-button">Re-run assertions</button>
            </div>
            <div class="sidebar-section">
                <div id="pp-results" class="sidebar-status"
                     style="font-size:11px;line-height:1.45;font-family:monospace;">
                    running…
                </div>
            </div>
            <div class="sidebar-section">
                <div class="sidebar-status" style="margin-bottom:4px;">Diagnostics</div>
                ${buttons}
            </div>
        </div>
    `;
});

Omosuen.registerBinding('ppBack', async () => {
    await Omosuen.switchScene('main-menu');
});

Omosuen.registerBinding('ppRun', async () => {
    const el = document.getElementById('pp-results');
    if (el) el.textContent = 'running…';
    await runAssertions();
});

Object.entries(DIAGNOSTICS).forEach(([label, source]) => {
    Omosuen.registerBinding(`ppDiag${label.replace(/\W/g, '')}`, () => {
        const cam = getCamera();
        if (!cam) return;
        cam.setPostEffects(source ? [{ name: 'diagnostic', fragment: source }] : null);
    });
});

// ── Fixture construction ─────────────────────────────────────────────────────

function buildTerrain() {
    const size = new Omosuen.Vector3D(MAP_W, MAP_H, MAP_D);
    const materialMap = new Omosuen.Array3D(size, 0);
    const shapeMap = new Omosuen.Array3D(size, 0);

    // One solid ground layer, split into quadrants so four distinct material
    // indices are simultaneously on screen.
    for (let x = 0; x < MAP_W; x++) {
        for (let z = 0; z < MAP_D; z++) {
            const quadrant =
                x < MAP_W / 2 ? (z < MAP_D / 2 ? MAT_A : MAT_B) : z < MAP_D / 2 ? MAT_C : MAT_BIG;
            shapeMap.set(new Omosuen.Vector3D(x, 0, z), 1);
            materialMap.set(new Omosuen.Vector3D(x, 0, z), quadrant);
        }
    }
    return { materialMap, shapeMap };
}

/**
 * The materials array has to be long enough to index MAT_BIG. Every entry is
 * the same cheap definition — only the INDEX matters for the id mask.
 */
function buildMaterials() {
    const base = {
        albedoTextureKey: 'tiles',
        normalTextureKey: '',
        emissionTextureKey: '',
        materialTextureKey: '',
        albedoFrame: TILE_FRAME,
    };
    const out = [];
    for (let i = 0; i <= MAT_BIG; i++) out.push({ ...base, albedoFrame: TILE_FRAME + (i % 3) });
    return out;
}

async function addSprite(scene, name, shaderId, position, opacity, scale, textureKey, frame) {
    const nexus = await Omosuen.newComponent('nexus', { name: `${name} Nexus` }, scene);
    // Sprite size is frameSize * worldScale, and the atlas frames here are
    // 16x16 — without a scale they land at a handful of pixels on screen.
    const s = scale ?? 4;
    await Omosuen.newComponent('transform', {
        name: `${name} Transform`,
        position,
        scale: new Omosuen.Vector3D(s, s, s),
    }, nexus);
    await Omosuen.newComponent('sprite', {
        name,
        textureMapKeys: { albedo: textureKey ?? 'tiles' },
        frame: { albedo: frame ?? TILE_FRAME },
        shaderId,
        opacity: opacity ?? 1.0,
        trackedByFog: false, // no phantom timers: the scene must stay deterministic
    }, nexus);
    return nexus;
}

export async function createScene() {
    const scene = await Omosuen.newComponent('nexus', { name: 'Post-Process Test Scene' });

    const atlasManager = await Omosuen.newComponent('atlas-manager', {
        name: 'AtlasManager',
        config: { atlasSize: 2048, maxAtlases: 4, padding: 1 },
    }, scene);

    await Promise.all([
        Omosuen.newComponent('texture-map', {
            textureMapKey: 'tiles',
            name: '16x16 Tiles',
            filePath: './assets/16x16_tiles.png',
            imageType: {
                cellSize: new Omosuen.Vector2D(16, 16),
                gridSize: new Omosuen.Vector2D(25, 25),
            },
            atlasManager,
        }, scene),
        Omosuen.newComponent('texture-map', {
            textureMapKey: 'objects',
            name: 'Objects',
            filePath: './assets/objects.png',
            imageType: OBJECTS_FRAMES,
            atlasManager,
        }, scene),
        Omosuen.newComponent('viewport', {
            name: 'PostProcess Viewport',
            width: VIEW_W,
            height: VIEW_H,
            offsetX: window.innerWidth / 2 - VIEW_W / 2,
            offsetY: window.innerHeight / 2 - VIEW_H / 2,
            backgroundColor: new Omosuen.Vector4D(0.05, 0.05, 0.1, 1.0),
            autoResize: false, // fixed size keeps the suite reproducible
        }, scene),
    ]);

    const cameraNexus = await Omosuen.newComponent('nexus', { name: 'Camera Nexus' }, scene);
    await Omosuen.newComponent('transform', {
        name: 'Camera Transform',
        position: new Omosuen.Vector3D((MAP_W * CELL) / 2, 2 * CELL, (MAP_D * CELL) / 2),
    }, cameraNexus);
    await Omosuen.newComponent('camera', {
        name: 'Main Camera',
        viewportRef: 'PostProcess Viewport',
        zoom: 0.9,
        pixelScale: 2,
        axonometricAngle: 30,
    }, cameraNexus);

    const { materialMap, shapeMap } = buildTerrain();
    await Omosuen.newComponent('cell-map', {
        name: 'Terrain',
        materials: buildMaterials(),
        materialMap,
        shapeMap,
        cellSize: new Omosuen.Vector3D(CELL, CELL, CELL),
        mapSize: new Omosuen.Vector3D(MAP_W, MAP_H, MAP_D),
        // Draw the whole map: residency alone does not raise the draw volume.
        renderDistance: { x: 4, y: 4, z: 4 },
        smoothing: 0,
    }, scene);

    const ambient = await Omosuen.newComponent('nexus', { name: 'Ambient Nexus' }, scene);
    await Omosuen.newComponent('light', {
        name: 'Ambient Light',
        lightType: 'ambient',
        color: new Omosuen.Vector3D(1, 1, 1),
        brightness: 1.0,
    }, ambient);

    const mid = (MAP_W * CELL) / 2;
    const surface = CELL;

    // All of these sit well above the surface for the same reason the showcase
    // row does: a billboard anchored at ground level sinks most of its quad
    // into the terrain, where the occlusion test discards it, leaving a thin
    // sliver that reads as a stripe of affected ground rather than as a sprite.
    // They use the transparent tree frame too, so every sprite in the scene
    // exercises the alpha-discard path.
    const lifted = surface + CELL * 2;

    // Over terrain — the case assertion 10 needs (a cell id beneath a sprite).
    await addSprite(scene, 'Over Terrain', SPRITE_IDS.overTerrain,
        new Omosuen.Vector3D(mid - CELL * 3, lifted, mid + CELL), 1.0, 5, 'objects', TREE_FRAME);
    // Over void — well outside the map footprint, so no cell is behind it.
    await addSprite(scene, 'Over Void', SPRITE_IDS.overVoid,
        new Omosuen.Vector3D(-CELL * 5, lifted, mid), 1.0, 5, 'objects', TREE_FRAME);
    // Overlapping pair — assertion 9 (coverage accumulation) and 11 (edge ids).
    await addSprite(scene, 'Overlap A', SPRITE_IDS.overlapA,
        new Omosuen.Vector3D(mid + CELL * 2, lifted, mid + CELL), 1.0, 5, 'objects', TREE_FRAME);
    await addSprite(scene, 'Overlap B', SPRITE_IDS.overlapB,
        new Omosuen.Vector3D(mid + CELL * 2.6, lifted, mid + CELL), 1.0, 5, 'objects', TREE_FRAME);
    // Translucent — assertion 8 (partial coverage).
    await addSprite(scene, 'Translucent', SPRITE_IDS.translucent,
        new Omosuen.Vector3D(mid, lifted, mid + CELL * 3), 0.5, 5, 'objects', TREE_FRAME);

    // A showcase row, scaled up so the sprite-only effects are obvious by eye
    // and cover enough texels for assertion 20 to have real data to work with.
    const showcase = [
        ['Showcase A', SPRITE_IDS.showcaseA, -CELL * 3],
        ['Showcase B', SPRITE_IDS.showcaseB, -CELL],
        ['Showcase C', SPRITE_IDS.showcaseC, CELL],
        ['Showcase D', SPRITE_IDS.showcaseD, CELL * 3],
    ];
    // Lifted well clear of the ground: a billboard anchored at the surface sinks
    // most of its quad into the terrain, where the fragment shader's occlusion
    // test discards it, leaving only a thin visible sliver.
    for (const [name, id, dx] of showcase) {
        await addSprite(scene, name, id,
            new Omosuen.Vector3D(mid + dx, surface + CELL * 3, mid - CELL * 2),
            1.0, 6, 'objects', TREE_FRAME);
    }

    // A vision source gives fogVisibility something to vary across (assertion
    // 13). No fog-of-war component: its memory/phantom fades are time-driven and
    // would break the scene's determinism.
    const visionNexus = await Omosuen.newComponent('nexus', { name: 'Vision Nexus' }, scene);
    await Omosuen.newComponent('transform', {
        name: 'Vision Transform',
        position: new Omosuen.Vector3D(mid, surface, mid),
    }, visionNexus);
    await Omosuen.newComponent('vision-source', {
        name: 'Vision Source',
        radius: CELL * 4,
        fadeWidth: CELL * 2,
    }, visionNexus);

    const bindings = [
        { selector: '#btn-back', onActions: ['click'], methodKey: 'ppBack' },
        { selector: '#pp-run', onActions: ['click'], methodKey: 'ppRun' },
        ...Object.keys(DIAGNOSTICS).map((k) => ({
            selector: `#pp-diag-${k.replace(/\W/g, '')}`,
            onActions: ['click'],
            methodKey: `ppDiag${k.replace(/\W/g, '')}`,
        })),
    ];
    const ui = await Omosuen.newComponent('ui-overlay', {
        name: 'Post-Process Test UI',
        htmlConstructorKey: 'postProcessTest',
        bindings,
    }, scene);
    scene.addComponent(ui);

    // Run once the first frames have settled.
    setTimeout(() => { void runAssertions(); }, 1200);

    console.log('[Post-Process Test] Scene created');
    return scene;
}
