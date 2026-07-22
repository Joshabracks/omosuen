/**
 * Depth Cues Test Scene
 *
 * Demonstrates the camera's developer-configurable depth-readability cues on a
 * terraced terrain (lots of same-grass plateaus at different heights that otherwise
 * merge on screen). Every parameter is a live slider that writes to
 * `camera.depthCues.*` each frame:
 *   - Outline   (post-process depth-edge contour lines)
 *   - AO        (solidity-grid ambient occlusion in recesses)
 *   - Shadow    (directional cast shadows via the solidity DDA)
 *   - HeightRamp(value/hue shift by elevation)
 * Set any weight to 0 to disable that effect (free).
 */

const Omosuen = window.Omosuen;

// 16x16_tiles.png frames (row 21): dirt, grass, grass-cap — same swatches as cellmap-test.
const DIRT_FRAME = 21 * 25 + 8; // 533
const GRASS_FRAME = 21 * 25 + 9; // 534
const CAP_FRAME = 21 * 25 + 10; // 535

const CELL_W = 32, CELL_H = 16, CELL_D = 32;
const MAP_W = 22, MAP_DEPTH = 22, MAP_HEIGHT = 16;

// Scatter styles (shared by AO + shadow), indexed by the Scatter Type slider.
const SCATTER_TYPES = ['dither', 'soft-grain', 'smooth-fade', 'retro-dither'];

// Directional light driven by azimuth/elevation sliders (so shadows can be swept
// independently of AO). Kept here so either light slider recomputes the direction.
let lightAzimuth = 45;   // degrees
let lightElevation = 18; // degrees above the horizon (low sun → long, clear shadows)

function getCamera() {
    const scene = Omosuen.getActiveScene();
    if (!scene) return null;
    return scene.getComponentByType('camera', true);
}

function updateCameraStatus() {
    const cam = getCamera();
    const el = document.getElementById('camera-status');
    if (cam && el) {
        el.textContent = `orbitYaw ${cam.orbitYaw.toFixed(0)}°, tilt ${cam.axonometricAngle.toFixed(0)}°`;
    }
}

// Apply a mutation to the live camera.depthCues object.
function setDC(fn) {
    const camera = getCamera();
    if (camera && camera.depthCues) fn(camera.depthCues);
}

// Light travel direction from azimuth/elevation (points down into the scene).
function dirFromAngles(azDeg, elDeg) {
    const az = (azDeg * Math.PI) / 180;
    const el = (elDeg * Math.PI) / 180;
    return new Omosuen.Vector3D(
        Math.cos(el) * Math.cos(az),
        -Math.sin(el),
        Math.cos(el) * Math.sin(az),
    );
}

function updateLight() {
    const scene = Omosuen.getActiveScene();
    if (!scene) return;
    const light = scene.getComponentByName('Directional Light', true);
    if (light) light.setDirection(dirFromAngles(lightAzimuth, lightElevation));
}

// ── Slider schema: drives both the HTML and the bindings ────────────────────────
// Each entry's `apply(value)` writes into the live config (camera.depthCues) or the
// directional light; `fmt` formats the value label.
const SLIDERS = [
    { id: 'outline-weight',    label: 'Outline Weight',    min: 0,  max: 1,    step: 0.05,  value: 0.85,  apply: (v) => setDC((d) => d.outline.weight = v),    fmt: (v) => v.toFixed(2) },
    { id: 'outline-threshold', label: 'Outline Threshold', min: 0,  max: 0.04, step: 0.001, value: 0.006, apply: (v) => setDC((d) => d.outline.threshold = v), fmt: (v) => v.toFixed(3) },
    { id: 'outline-width',     label: 'Outline Width',     min: 0,  max: 2,    step: 0.1,   value: 1,     apply: (v) => setDC((d) => d.outline.width = v),     fmt: (v) => v.toFixed(1) },
    { id: 'ao-weight',         label: 'AO Weight',         min: 0,  max: 1,    step: 0.05,  value: 0.5,   apply: (v) => setDC((d) => d.ao.weight = v),         fmt: (v) => v.toFixed(2) },
    { id: 'ao-radius',         label: 'AO Radius (rings)', min: 1,  max: 2,    step: 1,     value: 2,     apply: (v) => setDC((d) => d.ao.radius = v),         fmt: (v) => v.toFixed(0) },
    { id: 'ao-scatter',        label: 'AO Scatter',        min: 0,  max: 1,    step: 0.05,  value: 0,     apply: (v) => setDC((d) => d.ao.scatter = v),        fmt: (v) => v.toFixed(2) },
    { id: 'scatter-type',      label: 'Scatter Type',      min: 0,  max: 3,    step: 1,     value: 0,     apply: (v) => setDC((d) => d.scatterType = SCATTER_TYPES[v]), fmt: (v) => SCATTER_TYPES[v] },
    { id: 'shadow-weight',     label: 'Shadow Weight',     min: 0,  max: 1,    step: 0.05,  value: 0.45,  apply: (v) => setDC((d) => d.shadow.weight = v),     fmt: (v) => v.toFixed(2) },
    { id: 'shadow-distance',   label: 'Shadow Distance',   min: 1,  max: 48,   step: 1,     value: 24,    apply: (v) => setDC((d) => d.shadow.distance = v),   fmt: (v) => v.toFixed(0) },
    { id: 'shadow-scatter',    label: 'Shadow Scatter',    min: 0,  max: 1,    step: 0.05,  value: 0,     apply: (v) => setDC((d) => d.shadow.scatter = v),    fmt: (v) => v.toFixed(2) },
    { id: 'light-azimuth',     label: 'Light Azimuth',     min: 0,  max: 360,  step: 5,     value: 45,    apply: (v) => { lightAzimuth = v; updateLight(); },  fmt: (v) => v.toFixed(0) + '°' },
    { id: 'light-elevation',   label: 'Light Elevation',   min: 5,  max: 85,   step: 5,     value: 18,    apply: (v) => { lightElevation = v; updateLight(); }, fmt: (v) => v.toFixed(0) + '°' },
    { id: 'height-weight',     label: 'Height Ramp Weight',min: 0,  max: 1,    step: 0.02,  value: 0.18,  apply: (v) => setDC((d) => d.heightRamp.weight = v), fmt: (v) => v.toFixed(2) },
    { id: 'height-min',        label: 'Height Ramp Min Y', min: 0,  max: 256,  step: 4,     value: 0,     apply: (v) => setDC((d) => d.heightRamp.minY = v),   fmt: (v) => v.toFixed(0) },
    { id: 'height-max',        label: 'Height Ramp Max Y', min: 16, max: 256,  step: 4,     value: 160,   apply: (v) => setDC((d) => d.heightRamp.maxY = v),   fmt: (v) => v.toFixed(0) },
];

// Initial camera.depthCues, kept in sync with the slider defaults above.
const INITIAL_DEPTH_CUES = {
    outline: { weight: 0.85, threshold: 0.006, width: 1, color: { x: 0, y: 0, z: 0 } },
    ao: { weight: 0.5, radius: 2, scatter: 0 },
    shadow: { weight: 0.45, distance: 24, scatter: 0 },
    heightRamp: { weight: 0.18, minY: 0, maxY: 160, lowColor: { x: 0.55, y: 0.62, z: 0.85 }, highColor: { x: 1, y: 1, z: 1 } },
    scatterType: 'dither',
};

// ── UI ──────────────────────────────────────────────────────────────────────────
Omosuen.registerHtmlConstructor('depthCuesTest', () => {
    const rows = SLIDERS.map((s) => `
        <div class="slider-row">
            <span class="slider-row-label">${s.label}</span>
            <input type="range" id="${s.id}" class="slider-horizontal"
                min="${s.min}" max="${s.max}" step="${s.step}" value="${s.value}">
            <span id="${s.id}-value" class="slider-row-value">${s.fmt(s.value)}</span>
        </div>
    `).join('');

    return `
        <div class="sidebar">
            <button id="btn-back" class="sidebar-back-button">← Back</button>
            <h1 class="sidebar-title">Depth Cues</h1>
            <div class="sidebar-section">
                <div class="sidebar-status" style="font-size:12px;line-height:1.5;">
                    Terraced terrain of the same grass. Drag a weight to 0 to disable
                    that cue. Outline = post-process; AO / Shadow / Height = cell shader.<br>
                    Q/E = orbit yaw ±15°. W/S = tilt ±5°. Confirms the depth cues
                    (outline, AO, cast shadow, height ramp) stay coherent under orbit/tilt.
                </div>
                <div id="camera-status" class="sidebar-status" style="margin-top:6px;"></div>
            </div>
            <div class="sidebar-section">${rows}</div>
        </div>
    `;
});

Omosuen.registerBinding('depthCuesBack', async () => {
    await Omosuen.switchScene('main-menu');
});

// Register one 'input' handler per slider (reads value → writes camera.depthCues).
SLIDERS.forEach((s) => {
    Omosuen.registerBinding(`set_${s.id}`, (event) => {
        const v = parseFloat(event.currentTarget.value);
        s.apply(v);
        const label = document.getElementById(`${s.id}-value`);
        if (label) label.textContent = s.fmt(v);
    });
});

// ── Terrain ───────────────────────────────────────────────────────────────────────
// Flat 1-cell grass ground with a single tall pillar in the center — an unambiguous
// test bed for the cast-shadow direction (the pillar's shadow should land on the side
// away from the sun).
const PILLAR_TOP = 6; // pillar occupies y = 1..PILLAR_TOP
function generateTerrain(width, depth) {
    const materialMap = new Omosuen.Array3D(new Omosuen.Vector3D(width, MAP_HEIGHT, depth), 0);
    const shapeMap = new Omosuen.Array3D(new Omosuen.Vector3D(width, MAP_HEIGHT, depth), 0);

    // Flat grass ground (material 0 = grass-cap).
    for (let x = 0; x < width; x++) {
        for (let z = 0; z < depth; z++) {
            shapeMap.set(new Omosuen.Vector3D(x, 0, z), 1);
        }
    }

    // Central pillar: a 3x3 footprint block (dirt sides, grass-cap top) so its cast
    // shadow and base AO are clearly visible.
    const cx = Math.floor(width / 2), cz = Math.floor(depth / 2);
    for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
            for (let y = 1; y <= PILLAR_TOP; y++) {
                shapeMap.set(new Omosuen.Vector3D(cx + dx, y, cz + dz), 1);
                materialMap.set(new Omosuen.Vector3D(cx + dx, y, cz + dz), y === PILLAR_TOP ? 0 : 1);
            }
        }
    }

    return { materialMap, shapeMap };
}

// ── Scene ───────────────────────────────────────────────────────────────────────
export async function createScene() {
    const scene = await Omosuen.newComponent('nexus', { name: 'Depth Cues Test Scene' });

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
        Omosuen.newComponent('viewport', {
            name: 'DepthCues Viewport',
            width: 800,
            height: 600,
            offsetX: window.innerWidth / 2 - 400,
            offsetY: window.innerHeight / 2 - 300,
            backgroundColor: new Omosuen.Vector4D(0.05, 0.05, 0.1, 1.0),
        }, scene),
    ]);

    // Camera (with depth cues enabled at the slider defaults)
    // Focus the camera on the map's center so it sits centered in the viewport.
    const cameraNexus = await Omosuen.newComponent('nexus', { name: 'Camera Nexus' }, scene);
    await Omosuen.newComponent('transform', {
        name: 'Camera Transform',
        position: new Omosuen.Vector3D((MAP_W * CELL_W) / 2, 5 * CELL_H, (MAP_DEPTH * CELL_D) / 2),
    }, cameraNexus);
    await Omosuen.newComponent('camera', {
        name: 'Main Camera',
        viewportRef: 'DepthCues Viewport',
        zoom: 0.6,
        axonometricAngle: 30,
        pixelScale: 2,
        depthCues: INITIAL_DEPTH_CUES,
    }, cameraNexus);

    // Q/E = orbit yaw ±15°, W/S = tilt ±5°. Lets the depth cues (outline, AO,
    // cast shadow, height ramp) be checked for coherence at any orbit/tilt.
    window.addEventListener('keydown', (e) => {
        const cam = getCamera();
        if (!cam) return;
        if (e.key === 'q' || e.key === 'Q') cam.orbitBy(-15);
        else if (e.key === 'e' || e.key === 'E') cam.orbitBy(15);
        else if (e.key === 'w' || e.key === 'W') cam.axonometricAngle = Math.min(90, cam.axonometricAngle + 5);
        else if (e.key === 's' || e.key === 'S') cam.axonometricAngle = Math.max(0, cam.axonometricAngle - 5);
        else return;
        updateCameraStatus();
    });

    // Materials: grass-cap surface (cap sides / grass top) over dirt.
    const grassMaterial = {
        albedoTextureKey: 'tiles', normalTextureKey: '', emissionTextureKey: '', materialTextureKey: '',
        albedoFrame: CAP_FRAME, sides: { up: { albedoFrame: GRASS_FRAME } },
    };
    const dirtMaterial = {
        albedoTextureKey: 'tiles', normalTextureKey: '', emissionTextureKey: '', materialTextureKey: '',
        albedoFrame: DIRT_FRAME,
    };

    const { materialMap, shapeMap } = generateTerrain(MAP_W, MAP_DEPTH);
    await Omosuen.newComponent('cell-map', {
        name: 'Terrain',
        materials: [grassMaterial, dirtMaterial],
        materialMap,
        shapeMap, // 0 = air, 1 = default cube
        cellSize: new Omosuen.Vector3D(CELL_W, CELL_H, CELL_D),
        mapSize: new Omosuen.Vector3D(MAP_W, MAP_HEIGHT, MAP_DEPTH),
        smoothing: 0, // crisp terraces make the cues easy to read
        normalSmoothing: 0,
    }, scene);

    // Lighting: soft ambient + one directional (drives the cast-shadow cue).
    const ambientNexus = await Omosuen.newComponent('nexus', { name: 'Ambient Light Nexus' }, scene);
    await Omosuen.newComponent('light', {
        name: 'Ambient Light',
        lightType: 'ambient',
        color: new Omosuen.Vector3D(1.0, 0.97, 0.9),
        brightness: 0.55,
    }, ambientNexus);

    const dirLightNexus = await Omosuen.newComponent('nexus', { name: 'Directional Light Nexus' }, scene);
    await Omosuen.newComponent('light', {
        name: 'Directional Light',
        lightType: 'directional',
        color: new Omosuen.Vector3D(1.0, 0.95, 0.85),
        brightness: 0.7,
        // Lower, more horizontal sun (matches the Light Azimuth/Elevation slider defaults)
        // so cast shadows throw clearly instead of hugging cliff bases (where AO sits).
        direction: dirFromAngles(lightAzimuth, lightElevation),
    }, dirLightNexus);

    // UI overlay with the sliders
    const bindings = [
        { selector: '#btn-back', onActions: ['click'], methodKey: 'depthCuesBack' },
        ...SLIDERS.map((s) => ({ selector: `#${s.id}`, onActions: ['input'], methodKey: `set_${s.id}` })),
    ];
    const ui = await Omosuen.newComponent('ui-overlay', {
        name: 'Depth Cues Test UI',
        htmlConstructorKey: 'depthCuesTest',
        bindings,
    }, scene);
    scene.addComponent(ui);
    updateCameraStatus();

    console.log('[Depth Cues Test] Scene created');
    return scene;
}
