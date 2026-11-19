/**
 * Cell Region + Cell Material Test Scene
 *
 * Covers the two halves of the cell-map material work:
 *
 *  A. **Region indices on terrain**, reaching a post effect as `u_ids.b`, from
 *     two sources:
 *       - **per-TEXEL**, the B channel of a cell material texture, which varies
 *         *within* one cell face. This is the interesting one: it paints three
 *         different regions across a single tile, which nothing else in the
 *         engine can express.
 *       - **per-cell**, `cellMap.setRegionIndex(coords, n)`, a flat index for a
 *         whole cell. A fallback for materials with no texture — note that a
 *         solid per-cell *colour* was already expressible with
 *         `setEmissionColor`, so the per-texel path is what earns the channel.
 *     Per-texel wins where a material texture exists; they share one channel
 *     because they answer the same question.
 *  B. **Cell metallic/roughness** — `Material.materialTextureKey` finally does
 *     something. It was a declared, documented, serialized field that no
 *     renderer had ever read; cells were pure Lambert with no specular at all.
 *
 * ── Why the region index lives in the id attachment ─────────────────────────
 *
 * The sprite mask rides in `u_aux.b`, a float attachment that BLENDS — so its
 * values fray at antialiased sprite edges and have to be thresholded. The cell
 * region instead rides in `u_ids.b`, an INTEGER attachment, and integer targets
 * never blend in ES 3.0. It therefore reads back exactly as written, even under
 * a partially transparent sprite. Assertion 10 is the one that demonstrates this:
 * it checks that no value other than the ones actually authored ever appears.
 *
 * That separation also means a sprite over terrain carries BOTH masks at once —
 * its own in `u_aux.b`, the ground's in `u_ids.b`. Assertion 11 checks that the
 * sprite pass carries the terrain region through rather than clobbering it.
 *
 * ── The regression this scene guards ────────────────────────────────────────
 *
 * Feature B changes how ALL terrain shades. A material with no
 * `materialTextureKey` must be bit-identical to before the channel existed:
 * `cellMetallic` defaults to 0, `computeSpecular` returns zero on its first
 * line, and `cellColor` gains `+ vec3(0.0)`. Assertion 13 checks that a plain
 * material and a metallic one — differing only in that key — actually differ.
 *
 * Assertion 14 covers the subtler half. `computeSpecular` builds its half-vector
 * from `u_cameraWorldPos`, and until this work ONLY the sprite pass ever
 * uploaded it. A cell pass left to inherit that would read a stale value, or
 * (0,0,0) in a sprite-free scene, and still produce a plausible-looking
 * highlight — so a brightness comparison cannot prove the fix. The assertion
 * hides the scene's only sprite, leaving the sprite pass nothing to draw, and
 * reads the uniform back off the program: with no sprite pass running, a
 * correct value can only have come from the cell pass.
 */

const Omosuen = window.Omosuen;

// ── Fixture constants ────────────────────────────────────────────────────────

const CELL = 32;
const MAP_W = 12;
const MAP_H = 3;
const MAP_D = 12;

const VIEW_W = 640;
const VIEW_H = 480;

// Region indices painted onto the ground in three bands along x. Deliberately
// not starting at 0: 0 means "no region", so a band at 0 would be
// indistinguishable from untouched ground.
const REGIONS = [1, 2, 3];
const BAND_W = 4; // cells per band; MAP_W must be REGIONS.length * BAND_W

// Cell material indices. Index 0 is a filler so the real ones are non-zero —
// the id attachment writes 0 for "no cell here", so a material at index 0 is
// indistinguishable from empty space when reading that channel back.
const MAT_PLAIN = 1; // no materialTextureKey — must render exactly as before
const MAT_METAL = 2; // packed metallic/roughness — gains specular
const GROUND_FRAME = 21 * 25 + 9; // a solid grass tile from 16x16_tiles.png

// Camera must look DOWN on the terrain: the specular half-vector is built from
// u_cameraWorldPos, and a camera below the surface clamps dot() to 0, which
// would make assertions 13-14 pass by vacuum.
const CAMERA_Y = CELL * 6;

// ── The region recolour effect ───────────────────────────────────────────────

/**
 * Gives each region its own colour, and touches nothing else.
 *
 * The mask arrives as the raw byte the texture carried, so an authored value
 * quantised to N levels lands on the grid `packMaterial` produces — for
 * `maskLevels: 4` that is 0 / 85 / 170 / 255. Dividing by the step recovers a
 * small band index, which is what the palette is keyed on.
 *
 * Note `==` rather than a threshold: `u_ids.b` is an INTEGER channel and integer
 * attachments never blend, so the value is exact. The sprite equivalent
 * (`u_aux.b`) lives in a float attachment that does blend and has to be rounded
 * to the nearest band instead. That asymmetry is the reason the two masks live
 * in different attachments.
 *
 * Band 0 is "no region" — what every unmasked cell and every sprite texel
 * writes — so leaving it alone keeps this stage a no-op on the rest of the
 * scene by construction, with nothing to mask off by hand.
 */
const REGION_RECOLOR_SOURCE = `precision highp float;
precision highp int;
uniform sampler2D u_color;
uniform highp usampler2D u_ids;
uniform float u_time;
uniform float cycleSpeed;
// NOT u_-prefixed: that namespace is reserved for the engine contract, and a
// stage-private uniform claiming it is dropped with a warning rather than bound.
uniform float maskStep;
uniform float maskBands;
in vec2 v_uv;
out vec4 fragColor;

void main() {
    vec4 src = texture(u_color, v_uv);
    uint region = texture(u_ids, v_uv).b;

    if (region == 0u) {
        fragColor = src;
        return;
    }

    // Byte -> band index. maskStep is 255 / (maskLevels - 1).
    float band = floor(float(region) / maskStep + 0.5);

    float hue = band / maskBands + u_time * cycleSpeed;
    vec3 tint = 0.5 + 0.5 * cos(6.2831853 * (hue + vec3(0.0, 0.33, 0.67)));
    float lum = dot(src.rgb, vec3(0.299, 0.587, 0.114));
    fragColor = vec4(tint * clamp(lum * 1.5 + 0.2, 0.0, 1.0), src.a);
}`;

const CYCLE_SPEED = 0.3;

// tri_mask_cell.png carries three opaque tones plus transparency, so four
// levels including "no region". `maskLevels` MUST match, or quantising merges
// tones into each other or into nothing — silently.
const MASK_LEVELS = 4;
const MASK_STEP = 255 / (MASK_LEVELS - 1); // 85

// ── Assertion harness ────────────────────────────────────────────────────────

const results = [];

function record(n, label, pass, detail) {
    results.push({ n, label, pass, detail: detail ?? '' });
}

function renderResults() {
    const el = document.getElementById('cr-results');
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
async function settle(frames = 4) {
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

/**
 * Reads the RGBA16UI id attachment. `.r` cell material index, `.g` sprite id,
 * `.b` cell region index, `.a` reserved. Note the integer format and the stride
 * of 4 — asking for RG_INTEGER here (what this read before the attachment
 * widened) silently leaves the buffer unpopulated rather than erroring.
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

function readAttachment(gl, fbo, attachment, w, h) {
    const buf = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.readBuffer(attachment);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return buf;
}

// ── A: the region channel, CPU side ──────────────────────────────────────────

function checkRegionCpu(cm) {
    const V3 = Omosuen.Vector3D;

    // 1 — the fields are reachable through the component proxy at all. A
    // missing PROPERTY_ALLOWLIST entry type-checks clean and fails HERE, at
    // runtime, as "cell-map has no method named regionIndexVersion".
    try {
        const v = cm.regionIndexVersion;
        const d = cm.regionIndexDirtyRegions;
        record(1, 'region fields are reachable through the component proxy', true,
            `version=${v}, dirty log=${d.length}`);
    } catch (e) {
        record(1, 'region fields are reachable through the component proxy', false, String(e));
    }

    // 2 — set/get round-trips in-window
    const probe = new V3(1, 0, 1);
    cm.setRegionIndex(probe, 7);
    record(2, 'setRegionIndex / getRegionIndex round-trip',
        cm.getRegionIndex(probe) === 7, `wrote 7, read ${cm.getRegionIndex(probe)}`);

    // 3 — clamped to the byte the GPU carrier actually holds, rather than
    // wrapping silently into a different region
    cm.setRegionIndex(probe, 999);
    const hi = cm.getRegionIndex(probe);
    cm.setRegionIndex(probe, -5);
    const lo = cm.getRegionIndex(probe);
    record(3, 'values clamp to 0..255 instead of wrapping', hi === 255 && lo === 0,
        `999 -> ${hi}, -5 -> ${lo}`);
    cm.setRegionIndex(probe, 0);

    // 4 — untouched cells sit at the baseline, so an unused channel costs
    // nothing and reads as "no region". Probed at y=2, which is air: the paint
    // loop only ever writes the ground layer at y=0, so every ground cell IS
    // painted and would fail this for the wrong reason.
    const virgin = new V3(9, 2, 9);
    record(4, 'untouched cells read 0 ("no region")',
        cm.getRegionIndex(virgin) === 0, `read ${cm.getRegionIndex(virgin)} at an unpainted air cell`);

    // 5 — off-window writes persist through the channel's own cold storage,
    // the same as primary cell data
    const far = new V3(9000, 0, 9000);
    cm.setRegionIndex(far, 5);
    record(5, 'an off-window write persists via cold storage',
        cm.getRegionIndex(far) === 5, `wrote 5 far off-window, read ${cm.getRegionIndex(far)}`);

    // 6 — an in-window write advances the version and logs a dirty cell, which
    // is what lets a camera patch one texel instead of rebuilding the window
    const beforeV = cm.regionIndexVersion;
    const beforeN = cm.regionIndexDirtyRegions.length;
    cm.setRegionIndex(new V3(2, 0, 2), 1);
    record(6, 'an in-window write bumps the version and logs a dirty cell',
        cm.regionIndexVersion === beforeV + 1 &&
        cm.regionIndexDirtyRegions.length === beforeN + 1,
        `version ${beforeV}->${cm.regionIndexVersion}, dirty ${beforeN}->${cm.regionIndexDirtyRegions.length}`);
}

// ── A: the region channel, GPU side ──────────────────────────────────────────

function checkRegionGpu(gl, camera, cm) {
    const g = camera.glResources;
    const W = g.fullResolution.width;
    const H = g.fullResolution.height;
    const ids = readIds(gl, g.framebufferB, W, H);

    // The two halves of the map source their region differently, so they are
    // counted separately: the plain half has no material texture and falls back
    // to the per-CELL index, the metallic half carries a per-TEXEL mask.
    const perCellVals = {};   // over MAT_PLAIN
    const perTexelVals = {};  // over MAT_METAL
    const underSprite = {};
    let spriteOverGround = 0;
    let nonZeroUnderSprite = 0;
    // Horizontal transitions within the metallic half: how often the region
    // changes between adjacent texels. Sub-cell variation shows up here.
    let metalTransitions = 0;
    let metalTexels = 0;

    for (let p = 0; p < W * H; p++) {
        const cellId = ids[p * 4];
        const spriteId = ids[p * 4 + 1];
        const region = ids[p * 4 + 2];
        if (cellId === 0) continue; // no cell here
        if (cellId === MAT_PLAIN) perCellVals[region] = (perCellVals[region] || 0) + 1;
        if (cellId === MAT_METAL) {
            perTexelVals[region] = (perTexelVals[region] || 0) + 1;
            metalTexels++;
            const x = p % W;
            if (x + 1 < W && ids[(p + 1) * 4] === MAT_METAL &&
                ids[(p + 1) * 4 + 2] !== region) {
                metalTransitions++;
            }
        }
        if (spriteId !== 0) {
            spriteOverGround++;
            underSprite[region] = (underSprite[region] || 0) + 1;
            if (region !== 0) nonZeroUnderSprite++;
        }
    }

    const fmt = (o) => Object.entries(o).map(([k, v]) => `${k}:${v}`).join(', ');

    // 7 — the per-CELL fallback still works where no material texture exists
    const bandsPresent = REGIONS.filter((r) => (perCellVals[r] || 0) > 200);
    record(7, `the per-cell fallback delivers all ${REGIONS.length} bands`,
        bandsPresent.length === REGIONS.length, `over plain cells — ${fmt(perCellVals)}`);

    // 8 — THE per-texel assertion, and the reason this channel earns its place.
    // tri_mask_cell.png paints three tones plus transparency across ONE 16x16
    // tile, so the metallic half must show all four quantised levels. A flat
    // per-cell colour could never produce this, and neither could
    // setEmissionColor — which is the objection this test exists to answer.
    const wantLevels = [];
    for (let i = 0; i < MASK_LEVELS; i++) wantLevels.push(Math.round(i * MASK_STEP));
    const levelsPresent = wantLevels.filter((v) => (perTexelVals[v] || 0) > 100);
    record(8, `a per-texel mask paints all ${MASK_LEVELS} regions WITHIN each cell`,
        levelsPresent.length === MASK_LEVELS,
        `expected levels [${wantLevels.join(', ')}] — got ${fmt(perTexelVals)}`);

    // 9 — and the variation is genuinely sub-cell. A per-cell value can only
    // change at a cell boundary; the metallic half spans roughly MAP_D/2 * MAP_W
    // cells on screen, so a few hundred transitions could be cell edges. Tens of
    // thousands can only be the texture varying inside each face.
    const cellsOnScreen = (MAP_W * MAP_D) / 2;
    record(9, 'regions change within a cell face, not just at cell edges',
        metalTransitions > cellsOnScreen * 4,
        `${metalTransitions} horizontal region changes across ${metalTexels} metallic texels ` +
        `(only ~${cellsOnScreen} cells are on screen, so cell edges cannot account for these)`);

    // 10 — only values actually authored may appear. An integer attachment does
    // not blend, so there is no such thing as a halfway region. The sprite mask
    // in u_aux.b cannot make this claim, which is exactly why the two masks live
    // in different attachments.
    const seen = Object.keys(perCellVals).concat(Object.keys(perTexelVals))
        .map(Number).filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b);
    const allowed = [0].concat(REGIONS).concat(wantLevels);
    record(10, 'no blended intermediate values ever appear (integer channel)',
        seen.every((v) => allowed.includes(v)),
        `values seen: [${seen.join(', ')}]; authored: [${allowed.filter((v, i, a) => a.indexOf(v) === i).sort((x, y) => x - y).join(', ')}]`);

    // 11 — a sprite drawn over terrain carries the ground's region through in
    // .b while .g holds its own id. Both masks coexist rather than one
    // clobbering the other.
    record(11, 'a sprite preserves the terrain region beneath it',
        spriteOverGround > 100 && nonZeroUnderSprite === spriteOverGround,
        `${spriteOverGround} sprite-over-ground texels, ${nonZeroUnderSprite} carrying a region ` +
        `(${fmt(underSprite)})`);

    // 10 — the post effect acts on regions and nothing else. Time-independent:
    // the stage returns src verbatim where region == 0, so comparing the chain
    // output against the composite isolates exactly what it touched.
    const chain = g.postChainFramebuffers && g.postChainFramebuffers[0];
    if (!chain) {
        record(12, 'the post effect recolours regions and nothing else', false,
            'no post-chain framebuffer — did the effect fail to compile?');
        return;
    }
    const composite = readAttachment(gl, g.framebufferB, gl.COLOR_ATTACHMENT0, W, H);
    const staged = readAttachment(gl, chain, gl.COLOR_ATTACHMENT0, W, H);
    let changedInRegion = 0;
    let changedOutside = 0;
    for (let p = 0; p < W * H; p++) {
        const i = p * 4;
        const diff = Math.abs(composite[i] - staged[i]) +
                     Math.abs(composite[i + 1] - staged[i + 1]) +
                     Math.abs(composite[i + 2] - staged[i + 2]);
        if (diff <= 2) continue; // tolerate rounding through the blit
        if (ids[p * 4 + 2] !== 0) changedInRegion++;
        else changedOutside++;
    }
    record(12, 'the post effect recolours regions and nothing else',
        changedInRegion > 200 && changedOutside === 0,
        `${changedInRegion} region texels recoloured, ${changedOutside} outside any region`);
}

// ── B: cell metallic/roughness ───────────────────────────────────────────────

/** Mean brightness of the cells of one material, read from the composite. */
function materialBrightness(color, ids, materialIndex, w, h) {
    let sum = 0;
    let n = 0;
    for (let p = 0; p < w * h; p++) {
        if (ids[p * 4] !== materialIndex) continue;
        if (ids[p * 4 + 1] !== 0) continue; // ignore anything a sprite covers
        const i = p * 4;
        sum += (color[i] + color[i + 1] + color[i + 2]) / 3;
        n++;
    }
    return n === 0 ? null : { mean: sum / n, n };
}

async function checkCellMaterial(gl, camera) {
    const g = camera.glResources;
    const W = g.fullResolution.width;
    const H = g.fullResolution.height;

    const ids = readIds(gl, g.framebufferB, W, H);
    const color = readAttachment(gl, g.framebufferB, gl.COLOR_ATTACHMENT0, W, H);
    const plain = materialBrightness(color, ids, MAT_PLAIN, W, H);
    const metal = materialBrightness(color, ids, MAT_METAL, W, H);

    if (!plain || !metal) {
        record(13, 'a material texture gives cells specular', false,
            `plain=${plain ? plain.n : 0} texels, metal=${metal ? metal.n : 0} texels`);
        return;
    }

    // 11 — the packed material reaches the cell shader at all. These two
    // materials share an albedo frame and differ only in materialTextureKey.
    record(13, 'a material texture gives cells specular',
        Math.abs(metal.mean - plain.mean) > 2,
        `plain=${plain.mean.toFixed(1)} (${plain.n} texels), metal=${metal.mean.toFixed(1)} (${metal.n} texels)`);

    // 12 — u_cameraWorldPos is uploaded BY THE CELL PASS.
    //
    // This is the gotcha the whole feature turns on: computeSpecular builds its
    // half-vector from that uniform, and until this work only render-sprites.ts
    // ever set it. A cell pass left to inherit it would read a stale sprite-pass
    // value — or (0,0,0) in a sprite-free scene — and still produce a
    // plausible-looking highlight, which is why a brightness comparison is NOT
    // sufficient evidence here.
    //
    // Isolating it: hide the only sprite, so the sprite pass has nothing to
    // draw and cannot be the one writing the uniform, then read the value back
    // off the program and compare it with the camera's actual world position.
    const scene = Omosuen.getActiveScene();
    const sprite = scene.getComponentByTypeAndName('sprite', 'Overlay Sprite', true);
    const camNexus = Omosuen.castTo(camera.parent);
    const camT = camNexus && camNexus.getComponentByType('transform', true);
    const wasVisible = sprite ? sprite.visible : null;
    if (sprite) sprite.visible = false;
    await settle(4);

    const prog = g.unifiedProgram;
    gl.useProgram(prog);
    const uploaded = Array.from(
        gl.getUniform(prog, gl.getUniformLocation(prog, 'u_cameraWorldPos')),
    );
    const actual = camT ? [camT.position.x, camT.position.y, camT.position.z] : null;
    if (sprite) sprite.visible = wasVisible;
    await settle(2);

    const matches = actual !== null &&
        uploaded.every((v, i) => Math.abs(v - actual[i]) < 0.001);
    record(14, 'the cell pass uploads u_cameraWorldPos (no sprite pass involved)',
        matches && !uploaded.every((v) => v === 0),
        `with the sprite hidden, uniform = [${uploaded.join(', ')}], camera = [${actual ? actual.join(', ') : '?'}]`);
}

// ── Runner ───────────────────────────────────────────────────────────────────

async function runAssertions() {
    results.length = 0;
    const scene = Omosuen.getActiveScene();
    const cm = scene && scene.getComponentByType('cell-map', true);
    const camera = getCamera();
    const gl = camera ? getGl(camera) : null;

    if (!cm || !camera || !gl) {
        record(0, 'scene has a cell-map, camera and GL context', false);
        renderResults();
        return;
    }

    checkRegionCpu(cm);
    await settle(5);
    checkRegionGpu(gl, camera, cm);
    await checkCellMaterial(gl, camera);
    renderResults();
}

// ── UI ───────────────────────────────────────────────────────────────────────

Omosuen.registerHtmlConstructor('cellRegionTest', () => `
    <div class="sidebar" style="width:440px;">
        <button id="btn-back" class="sidebar-back-button">← Back</button>
        <h1 class="sidebar-title">Cell Regions</h1>
        <div class="sidebar-section">
            <div class="sidebar-status" style="font-size:12px;line-height:1.5;">
                Per-cell region indices reaching a post effect as
                <code>u_ids.b</code>, plus cell metallic/roughness from
                <code>materialTextureKey</code>.
            </div>
        </div>
        <div class="sidebar-section">
            <button id="cr-run" class="menu-button">Re-run assertions</button>
        </div>
        <div class="sidebar-section">
            <div id="cr-results" class="sidebar-status"
                 style="font-size:11px;line-height:1.4;">running…</div>
        </div>
    </div>
`);

Omosuen.registerBinding('crBack', async () => {
    await Omosuen.switchScene('main-menu');
});

Omosuen.registerBinding('crRun', async () => {
    const el = document.getElementById('cr-results');
    if (el) el.textContent = 'running…';
    await runAssertions();
});

// ── Scene ────────────────────────────────────────────────────────────────────

function buildTerrain() {
    const size = new Omosuen.Vector3D(MAP_W, MAP_H, MAP_D);
    const materialMap = new Omosuen.Array3D(size, 0);
    const shapeMap = new Omosuen.Array3D(size, 0);
    // One solid layer, split along z into a plain half and a metallic half so
    // assertion 11 has both on screen at once under identical lighting.
    for (let x = 0; x < MAP_W; x++) {
        for (let z = 0; z < MAP_D; z++) {
            shapeMap.set(new Omosuen.Vector3D(x, 0, z), 1);
            materialMap.set(
                new Omosuen.Vector3D(x, 0, z),
                z < MAP_D / 2 ? MAT_PLAIN : MAT_METAL,
            );
        }
    }
    return { materialMap, shapeMap };
}

export async function createScene() {
    const scene = await Omosuen.newComponent('nexus', { name: 'Cell Region Test Scene' });

    const atlasManager = await Omosuen.newComponent('atlas-manager', {
        name: 'AtlasManager',
        config: { atlasSize: 2048, maxAtlases: 4, padding: 1 },
    }, scene);

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

    // The metallic half's material, with the tri-tone region map packed into B.
    // One 16x16 file paints three different regions ACROSS a single tile — the
    // per-texel case, and the reason this channel is worth having at all.
    // The mask source gives the size, so no explicit one is needed here.
    const metalMaterial = await Omosuen.packMaterial({
        metallic: 1,
        roughness: 0.25,
        mask: { source: './assets/tri_mask_cell.png', quantize: MASK_LEVELS },
    });
    await Omosuen.newComponent('texture-map', {
        textureMapKey: 'ground-material',
        name: 'Ground Material',
        // Synthetic path: the atlas uses it only as a dedup key.
        filePath: 'cellregion://ground/material',
        sourceImage: metalMaterial,
        atlasManager,
    }, scene);

    await Omosuen.newComponent('viewport', {
        name: 'CellRegion Viewport',
        width: VIEW_W,
        height: VIEW_H,
        offsetX: window.innerWidth / 2 - VIEW_W / 2,
        offsetY: window.innerHeight / 2 - VIEW_H / 2,
        backgroundColor: new Omosuen.Vector4D(0.05, 0.05, 0.1, 1.0),
        autoResize: false,
    }, scene);

    const cameraNexus = await Omosuen.newComponent('nexus', { name: 'Camera Nexus' }, scene);
    await Omosuen.newComponent('transform', {
        name: 'Camera Transform',
        position: new Omosuen.Vector3D((MAP_W * CELL) / 2, CAMERA_Y, (MAP_D * CELL) / 2),
    }, cameraNexus);
    await Omosuen.newComponent('camera', {
        name: 'Main Camera',
        viewportRef: 'CellRegion Viewport',
        zoom: 0.8,
        pixelScale: 2,
        axonometricAngle: 30,
        postEffects: [{
            name: 'region-recolor',
            fragment: REGION_RECOLOR_SOURCE,
            // NOT u_cycleSpeed: the u_ prefix is reserved for the engine
            // contract, and a stage-private uniform claiming it is dropped with
            // a warning rather than bound — it would silently read 0.0.
            uniforms: {
                cycleSpeed: CYCLE_SPEED,
                maskStep: MASK_STEP,
                maskBands: MASK_LEVELS,
            },
        }],
    }, cameraNexus);

    const { materialMap, shapeMap } = buildTerrain();
    await Omosuen.newComponent('cell-map', {
        name: 'Terrain',
        materials: [
            // Index 0 is a filler so the real materials are non-zero — see
            // MAT_PLAIN's comment.
            { name: 'unused', albedoTextureKey: 'tiles', albedoFrame: GROUND_FRAME },
            // No materialTextureKey: this one must render exactly as terrain
            // did before the material channel existed.
            { name: 'plain', albedoTextureKey: 'tiles', albedoFrame: GROUND_FRAME },
            // Same albedo, plus a packed metallic/roughness map.
            {
                name: 'metal',
                albedoTextureKey: 'tiles',
                albedoFrame: GROUND_FRAME,
                materialTextureKey: 'ground-material',
                materialFrame: 0,
            },
        ],
        materialMap,
        shapeMap,
        cellSize: new Omosuen.Vector3D(CELL, CELL, CELL),
        mapSize: new Omosuen.Vector3D(MAP_W, MAP_H, MAP_D),
        renderDistance: { x: 4, y: 4, z: 4 },
        smoothing: 0,
    }, scene);

    const lights = await Omosuen.newComponent('nexus', { name: 'Lights' }, scene);
    await Omosuen.newComponent('light', {
        name: 'Ambient',
        lightType: 'ambient',
        color: new Omosuen.Vector3D(1, 1, 1),
        brightness: 0.35,
    }, lights);
    await Omosuen.newComponent('light', {
        name: 'Key',
        lightType: 'directional',
        direction: new Omosuen.Vector3D(-0.6, -0.7, -0.4),
        color: new Omosuen.Vector3D(1, 1, 1),
        brightness: 1.0,
    }, lights);

    // A sprite over the ground, so assertion 9 has a case where both masks are
    // live on the same texel: the sprite's id in .g, the terrain's region in .b.
    await Omosuen.newComponent('texture-map', {
        textureMapKey: 'door',
        name: 'Door',
        filePath: './assets/door.png',
        atlasManager,
    }, scene);
    const spriteNexus = await Omosuen.newComponent('nexus', { name: 'Sprite Nexus' }, scene);
    await Omosuen.newComponent('transform', {
        name: 'Sprite Transform',
        position: new Omosuen.Vector3D((MAP_W * CELL) / 2, CELL * 2, (MAP_D * CELL) / 2),
        scale: new Omosuen.Vector3D(2, 2, 2),
    }, spriteNexus);
    await Omosuen.newComponent('sprite', {
        name: 'Overlay Sprite',
        textureMapKeys: { albedo: 'door' },
        frame: { albedo: 0 },
        shaderId: 42,
        trackedByFog: false,
    }, spriteNexus);

    const ui = await Omosuen.newComponent('ui-overlay', {
        name: 'Cell Region Test UI',
        htmlConstructorKey: 'cellRegionTest',
        bindings: [
            { selector: '#btn-back', onActions: ['click'], methodKey: 'crBack' },
            { selector: '#cr-run', onActions: ['click'], methodKey: 'crRun' },
        ],
    }, scene);
    scene.addComponent(ui);

    // Paint the region bands once the map is resident. Done here rather than in
    // the assertions so the scene is visually correct on load too.
    setTimeout(() => {
        const cm = Omosuen.getActiveScene().getComponentByType('cell-map', true);
        if (!cm) return;
        for (let x = 0; x < MAP_W; x++) {
            const region = REGIONS[Math.floor(x / BAND_W)] ?? 0;
            for (let z = 0; z < MAP_D; z++) {
                cm.setRegionIndex(new Omosuen.Vector3D(x, 0, z), region);
            }
        }
        setTimeout(() => { void runAssertions(); }, 900);
    }, 900);

    console.log('[Cell Region Test] Scene created');
    return scene;
}
