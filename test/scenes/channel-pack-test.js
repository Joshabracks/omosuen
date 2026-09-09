/**
 * Channel-Pack Test Scene
 *
 * Covers the browser half of the channel-packing API — everything the headless
 * kernel test (`npx tsx test/channel-pack.test.ts`) structurally cannot reach:
 * `resolveSource`, the canvas premultiply rules, real image decode, and the
 * `image-loader` plugin's plain-image path.
 *
 * Two families of assertion:
 *
 *  1. BYTE assertions — read the packed canvas back with `getImageData` and
 *     check the actual bytes. Cheap, exact, and the primary signal.
 *  2. RENDER assertions — read the camera's offscreen colour FBO and compare
 *     sprites that differ only in their packed material. This is the only way
 *     to prove the packed canvas actually reached the GPU rather than merely
 *     having the right bytes on the CPU.
 *
 * Reads target an OFFSCREEN framebuffer, never the default one: the canvas is
 * created without `preserveDrawingBuffer`, so reading the drawing buffer after
 * a frame returns cleared data.
 *
 * ── The bug this scene exists to catch ──────────────────────────────────────
 *
 * `unified.frag:1082-1083` defaults an unset material to `metallic 0,
 * roughness 1` — fully rough. So the safe value for an UNAUTHORED roughness is
 * 1, and packing it as 0 (the natural "empty channel" value, and what a
 * zero-filled buffer gives you) means shininess 64 instead of 4: a tight mirror
 * highlight where the artist meant matte.
 *
 * `computeSpecular` early-outs at `metallic <= 0.0`, so this is only visible on
 * a sprite that authored a metallic — which is exactly why it could ship
 * unnoticed. Every material below therefore sets `metallic: 1`, and assertions
 * 6-8 compare an unauthored roughness against explicit matte and explicit
 * mirror sprites that are otherwise identical.
 *
 * ── Reading the picture ─────────────────────────────────────────────────────
 *
 * The row of three coloured squares is a visual aid, NOT what the assertions
 * measure. Specular is view-dependent, so the left and right squares differ
 * visibly even where their materials are byte-identical — the light favours one
 * side of the row. Assertions 11-14 use a single probe sprite whose material is
 * rebound between reads, which holds the geometry fixed; see `probeMaterial`.
 */

const Omosuen = window.Omosuen;

// ── Fixture constants ────────────────────────────────────────────────────────

const CELL = 32;
const MAP_W = 10;
const MAP_H = 3;
const MAP_D = 10;

const VIEW_W = 640;
const VIEW_H = 480;

const PACK_W = 32;
const PACK_H = 32;

// A sprite's world size is frameSize * scale, so these are PACK_W * 2 = 64
// units across. `SPRITE_SPACING` must exceed that or the three sprites overlap
// and the nearer ones overwrite the further ones' ids — which does not look
// like a bug, it just quietly makes the three coverage counts unequal and the
// specular means incomparable. Assertion 11 exists to catch exactly that.
const SPRITE_SCALE = 2;
const SPRITE_SPACING = PACK_W * SPRITE_SCALE * 1.5;

// Mask indices used for the quantise round-trip. 4 bands over 0..255 puts the
// levels at 0, 85, 170, 255 — all exactly representable, so a correct decode is
// byte-exact and any colour-management drift shows up immediately.
const MASK_LEVELS = 4;

// Hue cycles per second for the door's masked regions. Slow enough to read as a
// deliberate effect, fast enough that assertion 21 sees a change within a few
// frames without having to wait on a timer.
const MASK_CYCLE_SPEED = 0.35;

// How many mask bands door_mask.png declares, INCLUDING band 0 = "no region".
// It must match the number of distinct grey levels in the file, because
// `quantize` snaps to N evenly-spaced values across 0..255 and anything between
// two of them is rounded onto one:
//
//   bands  levels written           what an artist authors
//   2      0, 255                   black / white
//   3      0, 128, 255              black / mid-grey / white   <- this file
//   4      0, 85, 170, 255          black / 2 greys / white
//
// Getting this wrong is silent and total. At `2`, the file's mid-grey (127)
// quantises to round(round(127/255 * 1) * 255) = 0 — byte-identical to "no
// region", so that whole region vanishes before it reaches the GPU with no
// warning anywhere. One knob drives both the pack and the shader below.
const MASK_BANDS = 3;

// Vertical layout. Three constraints have to hold at once, and getting any
// one wrong fails quietly rather than loudly:
//   - CAMERA_Y > SPRITE_Y, or the specular half-vector points below the
//     sprite's world-up normal, dot() clamps to 0, and every material reads
//     zero specular — which makes assertions 12-14 pass-by-vacuum.
//   - SPRITE_Y high enough that the billboards clear the ground plane, since
//     a sprite anchored top-left hangs DOWN from its transform and the part
//     inside the terrain is discarded by the occlusion test.
//   - the whole stack inside the visible extent, about
//     VIEW_H / (zoom * pixelScale) tall, centred on CAMERA_Y. Overshoot and
//     the ground silently leaves frame.
// The single solid ground layer puts the surface at y = CELL.
const SPRITE_Y = CELL * 3;
const CAMERA_Y = CELL * 5;

// Ground material index. Deliberately not 0: the id attachment writes 0 for
// "no cell here", so a ground at index 0 is indistinguishable from empty
// space when reading that channel back.
const GROUND_MATERIAL = 1;
const GROUND_FRAME = 21 * 25 + 9; // a solid grass tile from 16x16_tiles.png

// ── The mask recolour effect ─────────────────────────────────────────────────

/**
 * Gives every masked REGION its own colour, and cycles them.
 *
 * This is the payoff for putting the mask in `fragAux.b`: the door needs no
 * shader of its own and no second sprite. One post stage reads `u_aux.b`,
 * recovers which region each texel belongs to, and assigns that region a hue —
 * so a single greyscale file authored beside the albedo becomes a set of
 * independently recolourable regions.
 *
 * The mask is an INDEX, not a boolean. An earlier version of this shader used
 * `step(0.5, mask)`, which can only ever express one region: every band above
 * the threshold collapsed into a single colour and everything below it vanished.
 * That is the whole point of the channel thrown away — `maskBands` and the
 * rounding below are what make "region 1" and "region 2" different things.
 *
 * Rounding to the nearest band, rather than testing for equality, is deliberate:
 * the aux attachment is a float buffer and BLENDS, so a sprite's antialiased
 * outer edge carries values between bands. Interior texels are exact (an opaque
 * fragment blends as src*1 + dst*0) and the atlas samples NEAREST, so no
 * interpolation smears one region into its neighbour.
 *
 * Luminance is preserved and re-tinted rather than replaced flat, so the door's
 * shading and its specular highlight survive the recolour — a flat fill would
 * look like a debug overlay rather than a material.
 */
const MASK_RECOLOR_SOURCE = `precision highp float;
uniform sampler2D u_color;
uniform sampler2D u_aux;
uniform float u_time;
// NOT u_cycleSpeed: the u_ prefix is reserved for the engine contract, and a
// stage-private uniform that claims it is dropped with a warning rather than
// bound. Silently reading 0.0 froze the hue and looked like the mask never
// arrived, which is a much harder failure to diagnose than it deserves to be.
uniform float cycleSpeed;
uniform float maskBands;
in vec2 v_uv;
out vec4 fragColor;

void main() {
    vec4 src = texture(u_color, v_uv);
    float mask = texture(u_aux, v_uv).b;

    // Recover the region index. The mask was quantised to maskBands levels
    // evenly spaced across 0..1, so scaling back up and rounding inverts it.
    // (No backticks in here -- this whole shader lives in a JS template
    // literal, and one would end the string mid-comment.)
    float steps = max(maskBands - 1.0, 1.0);
    float band = floor(mask * steps + 0.5);

    // Band 0 is "no region" — every unmasked sprite, and every cell, lands here.
    // Leaving it untouched is what keeps this stage a no-op for the rest of the
    // scene rather than something that has to be masked off by hand.
    if (band < 0.5) {
        fragColor = src;
        return;
    }

    // Each region gets its own point on the hue wheel, and the whole set turns
    // together, so regions stay distinguishable from each other at every moment.
    float hue = band / steps + u_time * cycleSpeed;
    vec3 tint = 0.5 + 0.5 * cos(6.2831853 * (hue + vec3(0.0, 0.33, 0.67)));
    float lum = dot(src.rgb, vec3(0.299, 0.587, 0.114));

    fragColor = vec4(tint * clamp(lum * 1.6 + 0.25, 0.0, 1.0), src.a);
}`;

// ── Assertion harness ────────────────────────────────────────────────────────

const results = [];

function record(n, label, pass, detail) {
    results.push({ n, label, pass, detail: detail ?? '' });
}

function renderResults() {
    const el = document.getElementById('cp-results');
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

const nextFrame = () =>
    new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
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

// ── Source fixtures ──────────────────────────────────────────────────────────

/**
 * A canvas whose red channel ramps left to right and whose alpha is fully
 * transparent down the right-hand quarter.
 *
 * The transparent strip is the point: canvas 2D stores premultiplied, so a
 * naive packer reads (0,0,0,0) there and writes 0 into the target channel —
 * silently turning "nothing authored here" into "roughness 0, mirror". The
 * packer instead pre-fills with the channel default at full opacity, and
 * assertion 4 checks that strip specifically.
 */
function rampCanvas(opaqueFraction = 0.75) {
    const c = document.createElement('canvas');
    c.width = PACK_W;
    c.height = PACK_H;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const img = ctx.createImageData(PACK_W, PACK_H);
    const cutoff = Math.floor(PACK_W * opaqueFraction);
    for (let y = 0; y < PACK_H; y++) {
        for (let x = 0; x < PACK_W; x++) {
            const i = (y * PACK_W + x) * 4;
            const v = Math.round((x / (PACK_W - 1)) * 255);
            img.data[i] = v;
            img.data[i + 1] = v;
            img.data[i + 2] = v;
            img.data[i + 3] = x < cutoff ? 255 : 0;
        }
    }
    ctx.putImageData(img, 0, 0);
    return c;
}

/** A flat grey canvas at a known 0..1 level, fully opaque. */
function flatCanvas(level, w = PACK_W, h = PACK_H) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const b = Math.round(level * 255);
    ctx.fillStyle = `rgb(${b},${b},${b})`;
    ctx.fillRect(0, 0, w, h);
    return c;
}

/** A solid-colour canvas, used as sprite albedo so lighting has something to lift. */
function solidCanvas(r, g, b, w = PACK_W, h = PACK_H) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(0, 0, w, h);
    return c;
}

function readCanvas(canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
}

/** Byte at (x, y), channel offset o. */
function px(data, w, x, y, o) {
    return data[(y * w + x) * 4 + o];
}

// ── Byte-level assertions (no rendering) ─────────────────────────────────────

async function checkPackedBytes() {
    // 1 — three distinct sources land in three distinct channels.
    let packed;
    try {
        packed = await Omosuen.packChannels({
            r: { source: flatCanvas(0.2) },
            g: { source: flatCanvas(0.6) },
            b: { source: flatCanvas(1.0) },
        });
        const d = readCanvas(packed);
        const [r, g, b] = [px(d, PACK_W, 4, 4, 0), px(d, PACK_W, 4, 4, 1), px(d, PACK_W, 4, 4, 2)];
        // ±2 absorbs the 0..1 → byte round trip through the canvas fill colour.
        const near = (a, want) => Math.abs(a - want) <= 2;
        record(1, 'packChannels routes three sources to R, G, B independently',
            near(r, 51) && near(g, 153) && near(b, 255), `got r=${r} g=${g} b=${b}, want ~51/~153/255`);
    } catch (e) {
        record(1, 'packChannels routes three sources to R, G, B independently', false, String(e));
    }

    // 2 — output alpha is forced opaque. A material image with alpha < 1 has its
    // RGB quantised by the atlas blit, and at alpha 0 collapses to roughness 0 —
    // mirror specular exactly where the artist meant "nothing".
    if (packed) {
        const d = readCanvas(packed);
        let minA = 255;
        for (let i = 3; i < d.length; i += 4) minA = Math.min(minA, d[i]);
        record(2, 'packed canvas alpha is 255 everywhere', minA === 255, `min alpha = ${minA}`);
    }

    // 3 — a numeric source needs no image at all. "roughness 0.6, metallic 0" is
    // the commonest 2D material and used to cost two flat PNGs.
    try {
        // All-constant, so the size cannot be inferred and must be given.
        const c = await Omosuen.packChannels(
            { r: 0, g: 0.6, b: 0 },
            { size: new Omosuen.Vector2D(4, 4) },
        );
        const d = readCanvas(c);
        const g = px(d, c.width, 0, 0, 1);
        record(3, 'a constant 0..1 source needs no image', Math.abs(g - 153) <= 2, `G = ${g}, want ~153`);
    } catch (e) {
        record(3, 'a constant 0..1 source needs no image', false, String(e));
    }

    // 4 — transparent regions resolve to the documented default, NOT to the
    // mangled premultiplied black canvas 2D actually stores there.
    try {
        const c = await Omosuen.packChannels({
            r: { source: rampCanvas(0.75), default: 1 },
            g: 0,
            b: 0,
        });
        const d = readCanvas(c);
        const inside = px(d, c.width, 4, 4, 0);   // opaque region: follows the ramp
        const outside = px(d, c.width, c.width - 2, 4, 0); // transparent region
        record(4, 'transparent source regions resolve to the channel default, not black',
            outside === 255 && inside < 128,
            `opaque=${inside} (ramp), transparent=${outside} (want 255 = default)`);
    } catch (e) {
        record(4, 'transparent source regions resolve to the channel default, not black', false, String(e));
    }

    // 5 — mismatched source sizes throw rather than silently resampling. A
    // material that no longer registers with its albedo looks plausible and is
    // misaligned, which is the worst failure mode available here.
    try {
        await Omosuen.packChannels({
            r: { source: flatCanvas(0.5, 32, 32) },
            g: { source: flatCanvas(0.5, 16, 16) },
        });
        record(5, 'mismatched source sizes throw by default', false, 'no error was thrown');
    } catch (e) {
        const msg = String(e);
        // The message must name the offenders — a bare "size mismatch" leaves
        // the artist guessing which of four files is wrong.
        const names = msg.includes('32') && msg.includes('16');
        record(5, 'mismatched source sizes throw by default', names,
            names ? 'error lists both dimensions' : `error omits dimensions: ${msg}`);
    }
}

async function checkMaterialDefaults() {
    // 6 — THE assertion. An unauthored roughness must pack as 255 (fully rough),
    // never 0. See the header: 0 is a mirror, and it is the value a zero-filled
    // buffer hands you for free.
    try {
        const c = await Omosuen.packMaterial({ metallic: 1 }, { size: new Omosuen.Vector2D(4, 4) });
        const d = readCanvas(c);
        const g = px(d, c.width, 0, 0, 1);
        const r = px(d, c.width, 0, 0, 0);
        record(6, 'unauthored roughness packs as 255 (matte), not 0 (mirror)',
            g === 255, `G = ${g} (want 255); R = ${r} (metallic)`);
    } catch (e) {
        record(6, 'unauthored roughness packs as 255 (matte), not 0 (mirror)', false, String(e));
    }

    // 7 — an unauthored metallic packs as 0, so a sprite that says nothing about
    // its material is bit-for-bit unchanged from having no material at all.
    try {
        const c = await Omosuen.packMaterial({}, { size: new Omosuen.Vector2D(4, 4) });
        const d = readCanvas(c);
        record(7, 'unauthored metallic packs as 0 (specular stays off)',
            px(d, c.width, 0, 0, 0) === 0, `R = ${px(d, c.width, 0, 0, 0)}`);
    } catch (e) {
        record(7, 'unauthored metallic packs as 0 (specular stays off)', false, String(e));
    }

    // 8 — the mask rides in B, quantised. Unquantised, an ICC-tagged PNG or a
    // resample can drift a mask index by an LSB and land it in the wrong band.
    try {
        const c = await Omosuen.packMaterial({
            metallic: 0,
            roughness: 1,
            mask: { source: rampCanvas(1.0), quantize: MASK_LEVELS },
        });
        const d = readCanvas(c);
        const seen = new Set();
        for (let x = 0; x < c.width; x++) seen.add(px(d, c.width, x, 4, 2));
        const levels = [...seen].sort((a, b) => a - b);
        const want = [0, 85, 170, 255];
        const ok = levels.length === MASK_LEVELS && levels.every((v, i) => Math.abs(v - want[i]) <= 1);
        record(8, `mask quantises to exactly ${MASK_LEVELS} bands in the B channel`, ok,
            `bands = [${levels.join(', ')}], want [${want.join(', ')}]`);
    } catch (e) {
        record(8, `mask quantises to exactly ${MASK_LEVELS} bands in the B channel`, false, String(e));
    }
}

async function checkFrameStrip() {
    // 9 — packFrameStrip lays loose files out and hands back a usable FrameMap.
    try {
        const strip = await Omosuen.packFrameStrip([
            solidCanvas(255, 0, 0),
            solidCanvas(0, 255, 0),
            solidCanvas(0, 0, 255),
        ]);
        const d = readCanvas(strip.canvas);
        const w = strip.canvas.width;
        const midY = Math.floor(strip.canvas.height / 2);
        const f0 = px(d, w, 4, midY, 0);
        const f1 = px(d, w, PACK_W + 4, midY, 1);
        const f2 = px(d, w, PACK_W * 2 + 4, midY, 2);
        const geom = w === PACK_W * 3 && strip.frames.length === 3;
        record(9, 'packFrameStrip composites loose frames left to right',
            geom && f0 > 200 && f1 > 200 && f2 > 200,
            `width=${w} (want ${PACK_W * 3}), frames=${strip.frames.length}, samples=${f0}/${f1}/${f2}`);

        // 10 — the returned rects must actually address those frames, or the
        // strip is unusable as a texture-map imageType.
        const r1 = strip.frames[1];
        record(10, 'the returned FrameMap addresses each frame',
            r1 && r1.x === PACK_W && r1.z === PACK_W && r1.w === PACK_H,
            r1 ? `frame[1] = (${r1.x}, ${r1.y}, ${r1.z}, ${r1.w})` : 'frame[1] missing');
    } catch (e) {
        record(9, 'packFrameStrip composites loose frames left to right', false, String(e));
    }
}

// ── Render assertions ────────────────────────────────────────────

/**
 * Reads the camera composite colour attachment. Never the default framebuffer:
 * the canvas has no `preserveDrawingBuffer`, so that one reads back cleared.
 */
function readAttachment(gl, fbo, attachment, w, h) {
    const buf = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    // `readBuffer` is mandatory for anything but COLOR0. Without it you read
    // COLOR0 and get plausible-looking garbage rather than an error.
    gl.readBuffer(attachment);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return buf;
}

function readColor(gl, fbo, w, h) {
    return readAttachment(gl, fbo, gl.COLOR_ATTACHMENT0, w, h);
}

/**
 * Reads the RGBA16UI id attachment: `.r` cell index, `.g` sprite index,
 * `.b` cell region index, `.a` reserved. Note the integer format and type —
 * asking for RGBA / UNSIGNED_BYTE here is a format mismatch, not a conversion,
 * and asking for RG_INTEGER (what this read before the attachment widened)
 * leaves the buffer silently unpopulated rather than erroring visibly.
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
 * Mean specular over the texels belonging to one sprite.
 *
 * Selection is by SPRITE ID, not by colour. Colour keying is the obvious
 * approach and is wrong twice over: other things in the scene share a hue (the
 * door sprite is red-dominant, so it lands in the "red" bucket), and any
 * threshold that excludes them also excludes the brightest texels of the sprite
 * being measured — which are precisely the high-specular ones the assertion is
 * about. Ids are exact and do not blend, so neither problem arises.
 *
 * The measurement itself: `litColor = albedo * lighting * tint + specular +
 * emission` (unified.frag:1105), and specular is achromatic. So on a sprite
 * whose albedo is a pure primary, the OTHER two channels carry nothing but
 * specular. Every sprite is measured the same way, so the numbers compare.
 */
function specularOf(color, ids, spriteId, keyChannel, width) {
    const others = [0, 1, 2].filter((c) => c !== keyChannel);
    let sum = 0;
    let n = 0;
    let minX = Infinity, maxX = -1, minY = Infinity, maxY = -1;
    for (let p = 0; p < ids.length / 2; p++) {
        if (ids[p * 4 + 1] !== spriteId) continue;
        const i = p * 4;
        sum += (color[i + others[0]] + color[i + others[1]]) / 2;
        n++;
        const x = p % width;
        const y = (p / width) | 0;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }
    if (n === 0) return null;
    // A rectangular billboard covers its whole bounding box. Anything less means
    // something is drawn in front of it — which would silently bias the mean.
    const boxArea = (maxX - minX + 1) * (maxY - minY + 1);
    return { spec: sum / n, n, boxArea, occluded: boxArea - n };
}

/**
 * Swaps the probe sprite's material channel and reads its mean specular back.
 *
 * ONE sprite at ONE position is measured three times, because specular is
 * view-dependent: `halfDir = normalize(lightDir + viewDir)` and `viewDir`
 * depends on where the sprite sits relative to the camera. Three sprites side
 * by side therefore disagree even when their materials are byte-identical —
 * measured at 67 vs 216 for two identical packs during development, purely from
 * the light favouring the right-hand side. Comparing materials across positions
 * would have been comparing the lighting geometry instead.
 *
 * Holding the position fixed and varying only the bound material makes the
 * packed bytes the single independent variable.
 */
async function probeMaterial(gl, camera, probe, materialKey) {
    probe.textureMapKeys = { ...probe.textureMapKeys, material: materialKey };
    await settle(3);

    const g = camera.glResources;
    const W = g.fullResolution.width;
    const H = g.fullResolution.height;
    const color = readColor(gl, g.framebufferB, W, H);
    const ids = readIds(gl, g.framebufferB, W, H);
    return specularOf(color, ids, PROBE_ID, PROBE_KEY, W);
}

async function checkRendered(gl, camera) {
    const scene = Omosuen.getActiveScene();
    const probe = scene.getComponentByTypeAndName('sprite', 'Probe', true);
    if (!probe) {
        record(11, 'the material probe sprite is on screen', false, 'sprite missing');
        return;
    }

    const restore = probe.textureMapKeys.material;
    const matte = await probeMaterial(gl, camera, probe, MATERIAL_KEYS.matte);
    const mirror = await probeMaterial(gl, camera, probe, MATERIAL_KEYS.mirror);
    const unauthored = await probeMaterial(gl, camera, probe, MATERIAL_KEYS.unauthored);
    // Leave the scene as the run found it, so what is on screen after a run does
    // not depend on which material happened to be probed last.
    await probeMaterial(gl, camera, probe, restore);

    if (!matte || !mirror || !unauthored) {
        record(11, 'the material probe sprite is on screen', false,
            `matte=${matte ? matte.n : 0} mirror=${mirror ? mirror.n : 0} unauthored=${unauthored ? unauthored.n : 0} texels`);
        return;
    }
    // Same sprite, same position, so the three reads must cover the same texels.
    // An unequal count means a swap did not take effect before the read and the
    // numbers below describe different frames.
    const counts = [matte.n, mirror.n, unauthored.n];
    const even = Math.max(...counts) === Math.min(...counts);
    // And nothing may be drawn in front of it. A partly occluded probe still
    // gives three equal counts — the same texels are hidden in every read — so
    // evenness alone would not notice, while the mean would be biased toward
    // whichever part of the sprite survived.
    const clear = matte.occluded === 0;
    record(11, 'the probe is unoccluded and covers identical texels across all three materials',
        even && clear,
        `${matte.n} / ${mirror.n} / ${unauthored.n} texels; ${matte.occluded} of ${matte.boxArea} occluded`);

    // 12 — the packed canvas reached the GPU at all. Only the bound material
    // changed between these reads; if the material texture never sampled,
    // `u_hasMaterial` would be false throughout and all three would be equal.
    // A byte-correct canvas that never uploads passes assertions 1-10.
    const spread = Math.abs(matte.spec - mirror.spec);
    record(12, 'packed roughness reaches the shader (matte != mirror on screen)',
        spread > 2,
        `specular matte=${matte.spec.toFixed(1)} mirror=${mirror.spec.toFixed(1)} spread=${spread.toFixed(1)}`);

    // 13 — direction check. shininess = mix(4, 64, 1 - roughness), so a rough
    // surface takes pow(d, 4) where a smooth one takes pow(d, 64): for any d < 1
    // the matte material carries the stronger term. An inversion here means R
    // and G swapped somewhere between packMaterial and the sampler.
    record(13, 'matte carries more specular than mirror (roughness widens the lobe)',
        matte.spec > mirror.spec,
        `matte=${matte.spec.toFixed(1)} vs mirror=${mirror.spec.toFixed(1)}`);

    // 14 — the payoff. `packMaterial({ metallic: 1 })` and
    // `packMaterial({ metallic: 1, roughness: 1 })` pack to identical bytes, so
    // on one sprite at one position they must render identically — not merely
    // "closer to matte than to mirror". A roughness default of 0 would instead
    // put this read on top of the mirror one.
    const toMatte = Math.abs(unauthored.spec - matte.spec);
    const toMirror = Math.abs(unauthored.spec - mirror.spec);
    record(14, 'an UNAUTHORED roughness renders exactly as explicit matte',
        toMatte <= 1 && toMirror > 2,
        `unauthored=${unauthored.spec.toFixed(1)}; dist to matte=${toMatte.toFixed(1)} (want 0), to mirror=${toMirror.toFixed(1)}`);
}

// ── image-loader plugin path ─────────────────────────────────────────────────

async function checkImageLoader(scene) {
    const loaderNexus = scene.getComponentByTypeAndName('nexus', 'Loader Nexus', true);
    if (!loaderNexus) {
        record(15, 'image-loader builds a sprite from declared images', false, 'nexus missing');
        return;
    }
    const sprite = loaderNexus.getComponentByType('sprite', true);
    if (!sprite) {
        record(15, 'image-loader builds a sprite from declared images', false, 'no sprite generated');
        return;
    }
    record(15, 'image-loader builds a sprite from declared images', true, `sprite '${sprite.name}'`);

    // 16 — the load-bearing one. `textureMapKeys` and the controller's channel
    // list were hardcoded to albedo-only, which is why the loader could never
    // populate a material channel however the images were declared.
    const keys = sprite.textureMapKeys || {};
    record(16, 'image-loader populates non-albedo channels',
        !!keys.albedo && !!keys.material,
        `albedo='${keys.albedo || ''}' normal='${keys.normal || ''}' material='${keys.material || ''}'`);

    // 17 — and the material it built is the packed one, with the right defaults.
    const scn = Omosuen.getActiveScene();
    const tm = keys.material
        ? scn.getComponentByTypeAndName('texture-map', keys.material, true)
        : null;
    record(17, "the loader's material channel is a packed canvas, not a fetched file",
        !!(tm && tm.sourceImage),
        tm ? `filePath='${tm.filePath}' sourceImage=${!!tm.sourceImage}` : 'texture-map missing');
}

// ── Mask channel end to end ──────────────────────────────────────────────────

/**
 * Assertions 18-20: a greyscale file authored beside the albedo survives all
 * the way to a post effect that recolours it.
 *
 * This is the whole chain in one path — `packMaterial` interleaves the mask
 * into B, the atlas uploads it, `unified.frag` samples it and writes it to
 * `fragAux.b`, and the post stage reads it back out of `u_aux`. Any break
 * anywhere in that chain shows up here, which is why it is worth testing on a
 * real two-tone image rather than a constant.
 */
async function checkMaskChannel(gl, camera) {
    const g = camera.glResources;
    const W = g.fullResolution.width;
    const H = g.fullResolution.height;

    const aux = readAttachment(gl, g.framebufferB, gl.COLOR_ATTACHMENT2, W, H);
    const ids = readIds(gl, g.framebufferB, W, H);

    // The door is the only sprite carrying a mask, and it is the only sprite
    // left with shaderId 0 — so "sprite coverage with no id" isolates it.
    //
    // Texels are bucketed by BAND, the same way the shader reads them: the pack
    // quantised to MASK_BANDS levels evenly spaced over 0..255, so band k sits
    // at k * 255 / (MASK_BANDS - 1). Counting "masked vs not" instead would
    // pass just as happily with every region collapsed into one, which is
    // exactly the bug that `maskLevels: 2` produced.
    const steps = MASK_BANDS - 1;
    const bandCounts = new Array(MASK_BANDS).fill(0);
    let doorTexels = 0;
    let offBand = 0;
    // Anything in a non-zero band that is NOT the door means the channel leaks.
    let maskedOffDoor = 0;

    for (let p = 0; p < W * H; p++) {
        const coverage = aux[p * 4];
        const b = aux[p * 4 + 2];
        const exact = (b / 255) * steps;
        const band = Math.round(exact);
        // Within a quarter-band of a real level; anything further out is an
        // edge texel where the float attachment blended toward the background.
        const onBand = Math.abs(exact - band) < 0.25;
        const isDoor = coverage > 0 && ids[p * 4 + 1] === 0;

        if (isDoor) {
            doorTexels++;
            if (onBand) bandCounts[band]++;
            else offBand++;
        } else if (onBand && band > 0) {
            maskedOffDoor++;
        }
    }

    // 18 — every band the file declares actually arrives, as its own
    // population. This is the assertion that would have caught the quantiser
    // eating the mid-grey: with maskLevels wrong, band 1 is empty and its
    // texels show up in band 0 instead.
    const populated = bandCounts.filter((n, i) => i === 0 || n > 100).length;
    record(18, `all ${MASK_BANDS} mask bands reach u_aux.b as distinct populations`,
        populated === MASK_BANDS,
        `of ${doorTexels} door texels: ${bandCounts.map((n, i) => `band${i}=${n}`).join(', ')}, ${offBand} edge-blended`);

    // 19 — and nowhere else. Every other sprite packs mask 0, the cell pass
    // writes fragAux = vec4(0), and the silhouette exit writes 0 deliberately.
    record(19, 'no mask bleeds outside the sprite that authored one',
        maskedOffDoor === 0, `${maskedOffDoor} masked texels outside the door`);

    const chain = g.postChainFramebuffers && g.postChainFramebuffers[0];
    if (!chain) {
        record(20, 'the post effect recolours the masked region', false,
            'no post-chain framebuffer \u2014 did the effect fail to compile?');
        return;
    }

    // 20 — the stage acts on the mask, and ONLY on the mask. This one is
    // time-independent: the shader is `mix(src, recolored, step(0.5, mask))`,
    // so outside the mask its output is src bit-for-bit. Comparing the chain
    // output against the composite therefore isolates exactly what the effect
    // touched, with no reliance on the animation having advanced.
    const composite = readColor(gl, g.framebufferB, W, H);
    const staged = readAttachment(gl, chain, gl.COLOR_ATTACHMENT0, W, H);

    let recoloredMasked = 0;
    let recoloredElsewhere = 0;
    for (let p = 0; p < W * H; p++) {
        const i = p * 4;
        const diff =
            Math.abs(composite[i] - staged[i]) +
            Math.abs(composite[i + 1] - staged[i + 1]) +
            Math.abs(composite[i + 2] - staged[i + 2]);
        if (diff <= 2) continue; // tolerate rounding through the blit
        if (aux[p * 4 + 2] >= 64) recoloredMasked++;
        else recoloredElsewhere++;
    }
    record(20, 'the post effect recolours the masked region and nothing else',
        recoloredMasked > 200 && recoloredElsewhere === 0,
        `${recoloredMasked} masked texels recoloured, ${recoloredElsewhere} outside the mask`);

    // 21 — and it is genuinely dynamic. The hue is driven by u_time, so two
    // reads a few frames apart must differ. This is what catches a stage-private
    // uniform that silently failed to bind: `cycleSpeed` would read 0.0, the
    // colour would freeze, and assertion 20 would still pass on a static tint.
    const before = readAttachment(gl, chain, gl.COLOR_ATTACHMENT0, W, H);
    await settle(20);
    const after = readAttachment(gl, chain, gl.COLOR_ATTACHMENT0, W, H);

    let changedMasked = 0;
    let changedElsewhere = 0;
    for (let p = 0; p < W * H; p++) {
        const i = p * 4;
        const diff =
            Math.abs(before[i] - after[i]) +
            Math.abs(before[i + 1] - after[i + 1]) +
            Math.abs(before[i + 2] - after[i + 2]);
        if (diff <= 2) continue;
        if (aux[p * 4 + 2] >= 64) changedMasked++;
        else changedElsewhere++;
    }
    record(21, 'the recolour animates on u_time, and only the mask moves',
        changedMasked > 200 && changedElsewhere === 0,
        `${changedMasked} masked texels changed over ~20 frames, ${changedElsewhere} outside the mask`);
}

// ── Runner ───────────────────────────────────────────────────────────────────

async function runAssertions() {
    results.length = 0;

    await checkPackedBytes();
    await checkMaterialDefaults();
    await checkFrameStrip();

    const camera = getCamera();
    const gl = camera ? getGl(camera) : null;
    if (!camera || !gl) {
        record(11, 'scene has a camera and GL context', false);
        renderResults();
        return;
    }

    await settle(4);
    await checkRendered(gl, camera);
    await checkImageLoader(Omosuen.getActiveScene());
    await checkMaskChannel(gl, camera);

    renderResults();
}

// ── UI ───────────────────────────────────────────────────────────────────────

Omosuen.registerHtmlConstructor('channelPackTest', () => `
    <div class="sidebar" style="width:440px;">
        <button id="btn-back" class="sidebar-back-button">← Back</button>
        <h1 class="sidebar-title">Channel Pack</h1>
        <div class="sidebar-section">
            <div class="sidebar-status" style="font-size:12px;line-height:1.5;">
                Byte assertions over <code>packChannels</code> / <code>packMaterial</code> /
                <code>packFrameStrip</code>, then render assertions proving the packed
                canvas reaches the GPU with the shader's own defaults.
            </div>
        </div>
        <div class="sidebar-section">
            <button id="cp-run" class="menu-button">Re-run assertions</button>
        </div>
        <div class="sidebar-section">
            <div id="cp-results" class="sidebar-status"
                 style="font-size:11px;line-height:1.4;">running…</div>
        </div>
    </div>
`);

Omosuen.registerBinding('cpBack', async () => {
    await Omosuen.switchScene('main-menu');
});

Omosuen.registerBinding('cpRun', async () => {
    const el = document.getElementById('cp-results');
    if (el) el.textContent = 'running…';
    await runAssertions();
});

// ── Scene ────────────────────────────────────────────────────────────────────

// Which albedo channel identifies each material sprite in the colour buffer.
// See `specularOf` — the two channels a sprite is NOT keyed on read as pure
// specular, which is the quantity assertions 12-14 compare.
const SPRITE_KEY = { matte: 0, mirror: 1, unauthored: 2 };
// Sprite indices written to the id attachment, used to select each sprite's
// texels exactly. Deliberately non-zero: id 0 means "no sprite here".
const SPRITE_ID = { matte: 101, mirror: 102, unauthored: 103 };
// The probe sprite that assertions 11-14 measure. It is the only one whose
// material changes, and it never moves — see `probeMaterial`.
const PROBE_ID = 110;
const PROBE_KEY = 0; // red albedo, so G and B carry only specular
const MATERIAL_KEYS = {
    matte: 'cp-material-Matte',
    mirror: 'cp-material-Mirror',
    unauthored: 'cp-material-Unauthored',
};
const KEY_RGB = [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
];

function buildFlatTerrain() {
    const size = new Omosuen.Vector3D(MAP_W, MAP_H, MAP_D);
    const materialMap = new Omosuen.Array3D(size, 0);
    const shapeMap = new Omosuen.Array3D(size, 0);
    // One solid ground layer. Deliberately dull and near-neutral: `specularOf`
    // keys sprites on a saturated dominant channel, and a colourful floor would
    // leak into those counts.
    for (let x = 0; x < MAP_W; x++) {
        for (let z = 0; z < MAP_D; z++) {
            shapeMap.set(new Omosuen.Vector3D(x, 0, z), 1);
            materialMap.set(new Omosuen.Vector3D(x, 0, z), GROUND_MATERIAL);
        }
    }
    return { materialMap, shapeMap };
}

async function addMaterialSprite(scene, atlasManager, name, keyChannel, spriteId, materialCanvas, position) {
    const albedoKey = `cp-albedo-${name}`;
    const materialKey = `cp-material-${name}`;

    await Omosuen.newComponent('texture-map', {
        textureMapKey: albedoKey,
        name: albedoKey,
        // Synthetic path: the atlas uses it only as a dedup key, exactly as the
        // image-loader's `image://` and `aseprite://` keys do.
        filePath: `channelpack://${name}/albedo`,
        // A pure primary, so the other two channels carry only the specular term.
        sourceImage: solidCanvas(...KEY_RGB[keyChannel]),
        atlasManager,
    }, scene);

    await Omosuen.newComponent('texture-map', {
        textureMapKey: materialKey,
        name: materialKey,
        filePath: `channelpack://${name}/material`,
        sourceImage: materialCanvas,
        atlasManager,
    }, scene);

    const nexus = await Omosuen.newComponent('nexus', { name: `${name} Nexus` }, scene);
    await Omosuen.newComponent('transform', {
        name: `${name} Transform`,
        position,
        scale: new Omosuen.Vector3D(SPRITE_SCALE, SPRITE_SCALE, SPRITE_SCALE),
    }, nexus);
    await Omosuen.newComponent('sprite', {
        name,
        textureMapKeys: { albedo: albedoKey, material: materialKey },
        frame: { albedo: 0, material: 0 },
        // Written to fragIds.g, and how specularOf finds this sprite's texels.
        shaderId: spriteId,
        trackedByFog: false, // no fog timers: consecutive frames must be identical
    }, nexus);
    return nexus;
}

export async function createScene() {
    const scene = await Omosuen.newComponent('nexus', { name: 'Channel Pack Test Scene' });

    const atlasManager = await Omosuen.newComponent('atlas-manager', {
        name: 'AtlasManager',
        config: { atlasSize: 2048, maxAtlases: 4, padding: 1 },
    }, scene);

    // The ground's albedo. 16x16_tiles.png is 400x400, so it packs into a
    // 2048 atlas without trouble — unlike the 2048x2048 hr_mats files, where a
    // single oversized frame fails the whole pack and nothing renders at all.
    await Omosuen.newComponent('texture-map', {
        textureMapKey: 'tiles',
        name: '16x16 Tiles',
        filePath: './assets/16x16_tiles.png',
        imageType: {
            cellSize: new Omosuen.Vector2D(16, 16),
            gridSize: new Omosuen.Vector2D(25, 25),
        },
        atlasManager,
    }, scene);

    await Omosuen.newComponent('viewport', {
        name: 'ChannelPack Viewport',
        width: VIEW_W,
        height: VIEW_H,
        offsetX: window.innerWidth / 2 - VIEW_W / 2,
        offsetY: window.innerHeight / 2 - VIEW_H / 2,
        backgroundColor: new Omosuen.Vector4D(0.05, 0.05, 0.1, 1.0),
        autoResize: false, // fixed size keeps the probe coordinates valid
    }, scene);

    const cameraNexus = await Omosuen.newComponent('nexus', { name: 'Camera Nexus' }, scene);
    await Omosuen.newComponent('transform', {
        name: 'Camera Transform',
        // Camera height matters to the assertions, not just the framing. The
        // sprite base normal is world-up, so the specular half-vector needs a
        // positive y — which means the camera has to look DOWN on the sprites.
        // With the camera below them, dot(normal, halfDir) clamps to 0 and every
        // material reads zero specular, making assertions 12-14 unfalsifiable.
        position: new Omosuen.Vector3D((MAP_W * CELL) / 2, CAMERA_Y, (MAP_D * CELL) / 2),
    }, cameraNexus);
    await Omosuen.newComponent('camera', {
        name: 'Main Camera',
        viewportRef: 'ChannelPack Viewport',
        zoom: 0.9,
        pixelScale: 2,
        axonometricAngle: 30,
        // Reads the door's mask out of u_aux.b and cycles its hue. Assertions
        // 11-14 are unaffected: they read framebufferB, the composite BEFORE
        // the chain runs, so this animation cannot make them flaky.
        postEffects: [{
            name: 'mask-recolor',
            fragment: MASK_RECOLOR_SOURCE,
            uniforms: { cycleSpeed: MASK_CYCLE_SPEED, maskBands: MASK_BANDS },
        }],
    }, cameraNexus);

    const { materialMap, shapeMap } = buildFlatTerrain();
    await Omosuen.newComponent('cell-map', {
        name: 'Ground',
        // Index 0 is a filler so the real ground can sit at index 1 — see
        // GROUND_MATERIAL. Both are textured, because an untextured cell
        // material draws nothing at all rather than a flat colour.
        materials: [
            { name: 'unused', albedoTextureKey: 'tiles', albedoFrame: GROUND_FRAME },
            { name: 'ground', albedoTextureKey: 'tiles', albedoFrame: GROUND_FRAME },
        ],
        materialMap,
        shapeMap,
        cellSize: new Omosuen.Vector3D(CELL, CELL, CELL),
        mapSize: new Omosuen.Vector3D(MAP_W, MAP_H, MAP_D),
        renderDistance: { x: 4, y: 4, z: 4 },
        smoothing: 0,
    }, scene);

    const lights = await Omosuen.newComponent('nexus', { name: 'Lights' }, scene);
    // Low ambient so the specular term dominates: with ambient at 1.0 every
    // sprite saturates to white and assertions 12-14 have nothing to measure.
    await Omosuen.newComponent('light', {
        name: 'Ambient',
        lightType: 'ambient',
        color: new Omosuen.Vector3D(1, 1, 1),
        brightness: 0.25,
    }, lights);
    // Angled so the half-vector dot lands clearly below 1 — that gap is what
    // pow(d, 4) and pow(d, 64) separate on.
    await Omosuen.newComponent('light', {
        name: 'Key',
        lightType: 'directional',
        direction: new Omosuen.Vector3D(-0.6, -0.7, -0.4),
        color: new Omosuen.Vector3D(1, 1, 1),
        brightness: 1.0,
    }, lights);

    const mid = (MAP_W * CELL) / 2;
    const lifted = SPRITE_Y;

    // Three sprites differing ONLY in their packed material. Metallic is 1 on
    // all three because computeSpecular early-outs at metallic <= 0 — without it
    // the roughness difference is unobservable and the suite would pass blind.
    // An all-constant pack has no size to infer from its sources, so `size` is
    // required here — see assertion 5's sibling case. The three materials are
    // otherwise identical.
    const matSize = { size: new Omosuen.Vector2D(PACK_W, PACK_H) };
    await addMaterialSprite(scene, atlasManager, 'Matte', SPRITE_KEY.matte, SPRITE_ID.matte,
        await Omosuen.packMaterial({ metallic: 1, roughness: 1 }, matSize),
        new Omosuen.Vector3D(mid - SPRITE_SPACING, lifted, mid));
    await addMaterialSprite(scene, atlasManager, 'Mirror', SPRITE_KEY.mirror, SPRITE_ID.mirror,
        await Omosuen.packMaterial({ metallic: 1, roughness: 0 }, matSize),
        new Omosuen.Vector3D(mid, lifted, mid));
    await addMaterialSprite(scene, atlasManager, 'Unauthored', SPRITE_KEY.unauthored, SPRITE_ID.unauthored,
        await Omosuen.packMaterial({ metallic: 1 }, matSize),
        new Omosuen.Vector3D(mid + SPRITE_SPACING, lifted, mid));

    // The probe: identical to the showcase sprites, but its material is
    // rebound between reads rather than fixed. This is what assertions 11-14
    // actually measure; the three above are the same materials laid out side
    // by side so the difference is visible to a person as well.
    await addMaterialSprite(scene, atlasManager, 'Probe', PROBE_KEY, PROBE_ID,
        await Omosuen.packMaterial({ metallic: 1, roughness: 1 }, matSize),
        new Omosuen.Vector3D(mid, lifted, mid + SPRITE_SPACING * 2));

    // The plugin's plain-image path: one declaration, two channels, and a
    // material assembled from constants with no grayscale files at all.
    const loaderNexus = await Omosuen.newComponent('nexus', { name: 'Loader Nexus' }, scene);
    await Omosuen.newComponent('transform', {
        name: 'Loader Transform',
        // Off in its own depth lane, beside the probe, NOT above the showcase
        // row. door.png is 64x128, so at this scale the sprite is 256 world
        // units tall and — being centre-anchored — hangs 128 units below its
        // transform. Sitting it over the row at the same z put its lower half
        // in front of the red square and ate 440 of that square's texels: the
        // engine drawing a higher sprite in front of a lower one at equal z,
        // which is the correct axonometric convention and looks exactly like a
        // rendering bug when it is really a placement mistake.
        position: new Omosuen.Vector3D(mid + SPRITE_SPACING * 2, SPRITE_Y, mid - SPRITE_SPACING),
        scale: new Omosuen.Vector3D(SPRITE_SCALE, SPRITE_SCALE, SPRITE_SCALE),
    }, loaderNexus);
    await Omosuen.newComponent('image-loader', {
        name: 'Packed Loader',
        packageId: 'packed-loader',
        images: {
            // A plain URL, handed straight to the atlas without being decoded
            // here. 64x128 — deliberately not one of the hr_mats files, which
            // are 2048x2048 and cannot fit an atlas frame at all; a single
            // oversized frame fails the whole pack and nothing in the scene
            // renders, terrain included.
            albedo: './assets/door.png',
            // Constants only, so the packer has no source to size itself from.
            // The loader infers 64x128 from the albedo — a material has to
            // register with its albedo pixel for pixel, so that is the answer.
            // door_mask.png is a greyscale region map at the same 64x128 as
            // the albedo: transparent where there is no region, then one grey
            // per region. `maskLevels` MUST match the number of levels the file
            // actually uses (see MASK_BANDS) — quantising to fewer silently
            // merges regions into each other or into "no region" at all.
            material: {
                metallic: 1,
                roughness: 0.35,
                mask: './assets/door_mask.png',
                maskLevels: MASK_BANDS,
            },
        },
    }, loaderNexus);

    const ui = await Omosuen.newComponent('ui-overlay', {
        name: 'Channel Pack Test UI',
        htmlConstructorKey: 'channelPackTest',
        bindings: [
            { selector: '#btn-back', onActions: ['click'], methodKey: 'cpBack' },
            { selector: '#cp-run', onActions: ['click'], methodKey: 'cpRun' },
        ],
    }, scene);
    scene.addComponent(ui);

    // The atlas upload plus a few rendered frames must land before anything is
    // read back; the assertions read a framebuffer, not scene state.
    setTimeout(() => { void runAssertions(); }, 1200);

    console.log('[Channel Pack Test] Scene created');
    return scene;
}
