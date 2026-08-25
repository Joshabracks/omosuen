/**
 * Sprite Culling Test Scene
 * Repro scene for the Colony Forever bug report: sprites getting culled near
 * the screen margins when the camera is zoomed out.
 *
 * - 500x500 flat grass cell-map (single ground layer).
 * - Tree sprites planted on every 10th cell along X and every 10th cell along
 *   Z (a 50x50 = 2500-tree grid spanning the whole map).
 * - Zoom (mouse wheel) and pan (WASD + middle-click drag) camera controls so
 *   the map can be explored freely, including fully zoomed out where any
 *   sprites vanishing near the viewport edges should be visible.
 * - Frustum/render-distance debug sliders (same knobs as cellmap-test.js) so
 *   a vanishing-sprite report can be told apart from the terrain-window
 *   simply not having streamed in yet -- sprites are NOT gated by the
 *   cell-map's chunk window (see render-sprites.ts), so if trees disappear
 *   near the edges regardless of these settings, that isolates the bug to
 *   the sprite draw-list's own off-screen reject.
 */

const Omosuen = window.Omosuen;

// ── HTML / UI ────────────────────────────────────────────────────────────────

Omosuen.registerHtmlConstructor('spriteCullingTest', (overlay) => {
    const frustumRows = FRUSTUM_SLIDERS.map((s) => `
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

            <h1 class="sidebar-title">Sprite Culling Test</h1>

            <div class="sidebar-section">
                <div id="init-status" class="sidebar-status"></div>
            </div>

            <div id="map-info" class="sidebar-section" style="display: none;">
                <h3 style="color: #ff6600; margin: 10px 0;">Map Info</h3>
                <div id="map-stats" class="sidebar-status"></div>
            </div>

            <div id="controls" class="sidebar-section" style="display: none;">
                <div style="text-align: center; color: #ff6600; font-size: 14px; margin-bottom: 10px; text-transform: uppercase;">
                    Camera Controls
                </div>

                <div class="sidebar-status" style="font-size: 12px; line-height: 1.6;">
                    <strong>Pan:</strong> WASD keys<br>
                    <strong>Pan (alt):</strong> Middle-click + drag<br>
                    <strong>Zoom:</strong> Mouse wheel (toward cursor)
                </div>

                <div id="camera-status" class="sidebar-status" style="margin-top: 10px;"></div>
            </div>

            <div class="sidebar-section">
                <div style="text-align: center; color: #ff6600; font-size: 14px; margin-bottom: 10px; text-transform: uppercase;">
                    Terrain Streaming (Debug)
                </div>
                <div class="sidebar-status" style="font-size: 11px; line-height: 1.4; margin-bottom: 8px;">
                    Sprites are NOT gated by these -- they have their own
                    off-screen reject in render-sprites.ts. Use these only to
                    rule out "terrain hasn't streamed in yet" as an explanation
                    for anything that looks like culling.
                </div>
                ${frustumRows}
            </div>
        </div>
    `;
});

Omosuen.registerBinding('backToMenuFromSpriteCulling', async () => {
    console.log('[Sprite Culling Test] Returning to main menu...');
    await Omosuen.switchScene('main-menu');
});

// ── Camera control constants ────────────────────────────────────────────────
const PAN_SENSITIVITY = 1.0;     // Pixels of camera movement per pixel of mouse movement
const ZOOM_ACCELERATION = 0.003; // How much each scroll tick adds to zoom velocity
const ZOOM_ENTROPY = 10.75;      // Rate at which zoom velocity decays toward zero per frame
const MIN_ZOOM = 0.1;            // Matches cellmap-test.js -- lower risks exceeding the
                                  // WebGL max texture size on the zoom-scaled FBO (see
                                  // camera/set/index.ts's updateFramebufferForZoom).
const MAX_ZOOM = 3.0;
const KEY_PAN_SPEED = 900; // World units/sec (before the /zoom screen-normalization below)

// ── Frustum/render-distance debug controls (see cellmap-test.js precedent) ─
function getCellMap() {
    const scene = Omosuen.getActiveScene();
    if (!scene) return null;
    return scene.getComponentByType('cell-map', true);
}
function setFrustumDebug(fn) {
    const cellMap = getCellMap();
    if (cellMap) fn(cellMap);
}

const FRUSTUM_SLIDERS = [
    { id: 'render-distance-x', label: 'Render Distance X', min: 0, max: 20, step: 1, value: 8,
      apply: (v) => setFrustumDebug((cm) => { cm.renderDistance = { ...cm.renderDistance, x: v }; }), fmt: (v) => v.toFixed(0) },
    { id: 'render-distance-y', label: 'Render Distance Y', min: 0, max: 20, step: 1, value: 2,
      apply: (v) => setFrustumDebug((cm) => { cm.renderDistance = { ...cm.renderDistance, y: v }; }), fmt: (v) => v.toFixed(0) },
    { id: 'render-distance-z', label: 'Render Distance Z', min: 0, max: 20, step: 1, value: 8,
      apply: (v) => setFrustumDebug((cm) => { cm.renderDistance = { ...cm.renderDistance, z: v }; }), fmt: (v) => v.toFixed(0) },
    { id: 'max-terrain-load-dimensions-x', label: 'Max Terrain Load Dimensions X', min: 0, max: 20000, step: 200, value: 12800,
      apply: (v) => setFrustumDebug((cm) => { cm.maxTerrainLoadDimensions = { ...cm.maxTerrainLoadDimensions, x: v }; }), fmt: (v) => v.toFixed(0) },
    { id: 'max-terrain-load-dimensions-y', label: 'Max Terrain Load Dimensions Y', min: 0, max: 20000, step: 200, value: 2000,
      apply: (v) => setFrustumDebug((cm) => { cm.maxTerrainLoadDimensions = { ...cm.maxTerrainLoadDimensions, y: v }; }), fmt: (v) => v.toFixed(0) },
    { id: 'max-terrain-load-dimensions-z', label: 'Max Terrain Load Dimensions Z', min: 0, max: 20000, step: 200, value: 12800,
      apply: (v) => setFrustumDebug((cm) => { cm.maxTerrainLoadDimensions = { ...cm.maxTerrainLoadDimensions, z: v }; }), fmt: (v) => v.toFixed(0) },
    { id: 'frustum-padding-x', label: 'Frustum Padding X', min: 0, max: 3000, step: 50, value: 0,
      apply: (v) => setFrustumDebug((cm) => { cm.frustumPadding = { ...cm.frustumPadding, x: v }; }), fmt: (v) => v.toFixed(0) },
    { id: 'frustum-padding-y', label: 'Frustum Padding Y', min: 0, max: 3000, step: 50, value: 0,
      apply: (v) => setFrustumDebug((cm) => { cm.frustumPadding = { ...cm.frustumPadding, y: v }; }), fmt: (v) => v.toFixed(0) },
    { id: 'frustum-padding-z', label: 'Frustum Padding Z', min: 0, max: 3000, step: 50, value: 0,
      apply: (v) => setFrustumDebug((cm) => { cm.frustumPadding = { ...cm.frustumPadding, z: v }; }), fmt: (v) => v.toFixed(0) },
];

FRUSTUM_SLIDERS.forEach((s) => {
    Omosuen.registerBinding(`set_${s.id}`, (event) => {
        const v = parseFloat(event.currentTarget.value);
        s.apply(v);
        const label = document.getElementById(`${s.id}-value`);
        if (label) label.textContent = s.fmt(v);
    });
});

function updateCameraStatus() {
    const scene = Omosuen.getActiveScene();
    if (!scene) return;

    const cameraNexus = scene.getComponentByName('Culling Test Camera Nexus', true);
    if (!cameraNexus) return;

    const cameraTransform = cameraNexus.getComponentByType('transform', false);
    const camera = cameraNexus.getComponentByType('camera', false);

    if (cameraTransform && camera) {
        const statusEl = document.getElementById('camera-status');
        if (statusEl) {
            statusEl.innerHTML = `Position: (${Math.round(cameraTransform.position.x)}, ${Math.round(cameraTransform.position.z)})<br>Zoom: ${camera.zoom.toFixed(3)}x`;
        }
    }
}

function updateMapStats(treeCount) {
    const scene = Omosuen.getActiveScene();
    if (!scene) return;

    const cellMap = scene.getComponentByType('cell-map', true);
    if (!cellMap) return;

    const statsEl = document.getElementById('map-stats');
    if (statsEl) {
        statsEl.innerHTML = `
            Map Size: 500×500 cells<br>
            Cell Size: ${cellMap.cellSize.x}×${cellMap.cellSize.z}×${cellMap.cellSize.y}px<br>
            World Size: ${500 * cellMap.cellSize.x}×${500 * cellMap.cellSize.z}px<br>
            Trees: ${treeCount} (every 10th cell)
        `;
    }
}

function updateInitStatus(message) {
    const statusEl = document.getElementById('init-status');
    if (statusEl) statusEl.textContent = message;
}

let pollIntervalId = null;
let pendingTreeCount = 0;

function pollInitializationProgress() {
    const queueLength = Omosuen.getInitQueueLength();
    const queueSize = Omosuen.getInitQueueSize();

    if (queueLength === -1) {
        const scene = Omosuen.getActiveScene();
        if (scene) {
            updateInitStatus('✓ Initialization complete!');
            updateMapStats(pendingTreeCount);
            updateCameraStatus();

            const mapInfo = document.getElementById('map-info');
            const controls = document.getElementById('controls');
            if (mapInfo) mapInfo.style.display = 'block';
            if (controls) controls.style.display = 'block';

            console.log('[Sprite Culling Test] Initialization complete');

            if (pollIntervalId) {
                clearInterval(pollIntervalId);
                pollIntervalId = null;
            }
            return;
        }
        updateInitStatus('Waiting for scene...');
    } else {
        const completed = queueLength - queueSize;
        updateInitStatus(`Initializing ${completed} / ${queueLength} components...`);
    }
}

setTimeout(() => {
    if (!pollIntervalId) {
        pollIntervalId = setInterval(pollInitializationProgress, 100);
        pollInitializationProgress();
    }
}, 500);

/**
 * Create and export the sprite-culling test scene
 */
export async function createScene() {
    console.log('[Sprite Culling Test] Creating scene...');

    const scene = await Omosuen.newComponent('nexus', {
        name: 'Sprite Culling Test Scene',
    });

    await Omosuen.newComponent('perf-monitor', { name: 'PerfMonitor' }, scene);

    // 1. AtlasManager
    const atlasManager = await Omosuen.newComponent('atlas-manager', {
        name: 'AtlasManager',
        config: { atlasSize: 2048, maxAtlases: 4, padding: 1 },
    }, scene);

    // 2. Texture maps: terrain tile sheet + a single tree frame from the
    // objects sheet (same source image/frame as cellmap-test.js's Frame 0).
    const TREE_FRAME_INDEX = 0;
    const treeFrameMap = [
        new Omosuen.Vector4D(0, 0, 16, 32), // Frame 0: Tree (16x32)
    ];

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
            name: 'Objects Tileset (Tree only)',
            filePath: './assets/objects.png',
            imageType: treeFrameMap,
            atlasManager,
        }, scene),
    ]);

    // 3. Viewport, filling the window and resizing with it.
    const viewport = await Omosuen.newComponent('viewport', {
        name: 'Culling Test Viewport',
        width: window.innerWidth,
        height: window.innerHeight,
        offsetX: 0,
        offsetY: 0,
        backgroundColor: new Omosuen.Vector4D(0.05, 0.05, 0.1, 1.0),
    }, scene);
    viewport.container.style.left = '0';
    viewport.container.style.top = '0';
    viewport.container.style.width = '100%';
    viewport.container.style.height = '100%';
    viewport.canvas.style.width = '100%';
    viewport.canvas.style.height = '100%';

    // 4. Camera, centered on the map.
    const MAP_WIDTH = 500;
    const MAP_DEPTH = 500;
    const CELL_WIDTH = 32;
    const CELL_DEPTH = 32;
    const CELL_HEIGHT = 16;
    const CHUNK_WIDTH = 50;
    const CHUNK_HEIGHT = 4;
    const CHUNK_DEPTH = 50;

    const mapCenterX = (MAP_WIDTH * CELL_WIDTH) / 2;
    const mapCenterZ = (MAP_DEPTH * CELL_DEPTH) / 2;

    const cameraNexus = await Omosuen.newComponent('nexus', {
        name: 'Culling Test Camera Nexus',
    }, scene);
    await Omosuen.newComponent('transform', {
        name: 'Camera Transform',
        position: new Omosuen.Vector3D(mapCenterX, 80, mapCenterZ),
        rotation: new Omosuen.Vector3D(0, 0, 0),
        scale: new Omosuen.Vector3D(1, 1, 1),
    }, cameraNexus);
    const camera = await Omosuen.newComponent('camera', {
        name: 'Main Camera',
        viewportRef: 'Culling Test Viewport',
        zoom: 0.5,
        axonometricAngle: 30,
        pixelScale: 2,
    }, cameraNexus);

    window.addEventListener('resize', () => {
        viewport.resize(viewport.canvas.clientWidth, viewport.canvas.clientHeight);
        camera.resize();
    });

    // 5. InputController: WASD pan, middle-click drag pan, wheel zoom.
    const inputController = await Omosuen.newComponent('input-controller', {
        name: 'Camera Input Controller',
        preventDefault: false,
    }, scene);

    let isPanning = false;
    let lastMouseX = 0;
    let lastMouseY = 0;
    let zoomVelocity = 0;
    let scrollActive = false;

    const onActions = [
        ['middleMouseDown', (event) => {
            isPanning = true;
            lastMouseX = event.clientX;
            lastMouseY = event.clientY;
        }],
        ['middleMouseUp', () => {
            isPanning = false;
        }],
        ['mouseMove', (event) => {
            if (!isPanning) return;
            const deltaX = event.clientX - lastMouseX;
            const deltaY = event.clientY - lastMouseY;
            lastMouseX = event.clientX;
            lastMouseY = event.clientY;
            camera.pan(deltaX * -PAN_SENSITIVITY / camera.zoom, deltaY * -PAN_SENSITIVITY / camera.zoom);
            updateCameraStatus();
        }],
        ['mouseWheel', (event, deltaY) => {
            zoomVelocity += -deltaY * ZOOM_ACCELERATION;
            scrollActive = true;
            camera.setZoomTarget(
                event.clientX - viewport.offsetX,
                event.clientY - viewport.offsetY,
            );
        }],
    ];
    onActions.forEach((a) => inputController.onAction(...a));

    const bindActions = [
        { eventType: 'mousedown', button: 1, action: 'middleMouseDown' },
        { eventType: 'mouseup', button: 1, action: 'middleMouseUp' },
        { eventType: 'mousemove', action: 'mouseMove' },
        { eventType: 'wheel', action: 'mouseWheel' },
        { eventType: 'keydown', key: 'w', action: 'panUp' },
        { eventType: 'keydown', key: 'a', action: 'panLeft' },
        { eventType: 'keydown', key: 's', action: 'panDown' },
        { eventType: 'keydown', key: 'd', action: 'panRight' },
    ];
    bindActions.forEach(inputController.bindAction);

    // Per-frame loop: WASD camera pan + zoom velocity/entropy (same decay
    // model as cellmap-test.js's wheel zoom).
    let lastFrameTime = performance.now();

    function frameLoop() {
        const now = performance.now();
        const dt = Math.min((now - lastFrameTime) / 1000, 0.1);
        lastFrameTime = now;

        let dx = 0, dy = 0;
        if (inputController.isActionPressed('panUp')) dy -= 1;
        if (inputController.isActionPressed('panDown')) dy += 1;
        if (inputController.isActionPressed('panLeft')) dx -= 1;
        if (inputController.isActionPressed('panRight')) dx += 1;
        if (dx !== 0 || dy !== 0) {
            const len = Math.sqrt(dx * dx + dy * dy);
            const step = (KEY_PAN_SPEED * dt) / camera.zoom;
            camera.pan((dx / len) * step, (dy / len) * step);
            updateCameraStatus();
        }

        if (zoomVelocity !== 0) {
            const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, camera.zoom + zoomVelocity * dt));
            camera.setZoom(newZoom);
            updateCameraStatus();

            if (!scrollActive) {
                const decay = Math.sign(zoomVelocity) * ZOOM_ENTROPY * Math.abs(zoomVelocity) * dt;
                zoomVelocity -= decay;
                if (Math.abs(zoomVelocity) < 0.0001) {
                    zoomVelocity = 0;
                    camera.resetZoomTarget();
                }
            }
        }
        scrollActive = false;

        requestAnimationFrame(frameLoop);
    }
    requestAnimationFrame(frameLoop);

    // 6. Cell-map: flat 500x500 grass ground, generated on demand (windowed/
    // chunked, same generative path as cellmap-test.js). Anything outside the
    // 500x500 footprint is left as air so the map edge is visible when
    // panned to a corner.
    const DIRT_FRAME = 21 * 25 + 8;  // 533
    const GRASS_FRAME = 21 * 25 + 9; // 534
    const CAP_FRAME = 21 * 25 + 10;  // 535

    const groundMaterial = {
        albedoTextureKey: 'tiles',
        normalTextureKey: '',
        emissionTextureKey: '',
        materialTextureKey: '',
        albedoFrame: CAP_FRAME,
        sides: { up: { albedoFrame: DIRT_FRAME } },
    };

    const computeCellData = (x, y, z) => {
        if (x >= 0 && x < MAP_WIDTH && z >= 0 && z < MAP_DEPTH && y === 0) {
            return { materialIndex: 0, shapeIndex: 1, emissionIntensity: 0, visible: true };
        }
        return undefined; // air everywhere else
    };
    const AIR_CELL = { materialIndex: 0, shapeIndex: 0, emissionIntensity: 0, visible: false };

    const cellMap = await Omosuen.newComponent('cell-map', {
        name: 'Flat Ground',
        materials: [groundMaterial],
        meshes: [null, null], // index 0 (air) / 1 (default cube) auto-filled
        cellSize: new Omosuen.Vector3D(CELL_WIDTH, CELL_HEIGHT, CELL_DEPTH),
        chunkSize: new Omosuen.Vector3D(CHUNK_WIDTH, CHUNK_HEIGHT, CHUNK_DEPTH),
        // Wide window/render-distance so the whole 500x500 map (10x10 chunks
        // at this chunkSize) can stay resident regardless of camera position --
        // isolates this scene to the sprite-cull question rather than also
        // exercising terrain-window streaming. Live-tunable via the sidebar
        // sliders if you want to test the two independently.
        windowRadius: new Omosuen.Vector3D(8, 2, 8),
        maxTerrainLoadDimensions: { x: 12800, y: 2000, z: 12800 },
        renderDistance: { x: 8, y: 2, z: 8 },
        generateCell: (x, y, z) => computeCellData(x, y, z),
        generateChunk: (cx, cy, cz) => {
            const cells = new Array(CHUNK_WIDTH * CHUNK_HEIGHT * CHUNK_DEPTH);
            let idx = 0;
            for (let lz = 0; lz < CHUNK_DEPTH; lz++) {
                const wz = cz * CHUNK_DEPTH + lz;
                for (let ly = 0; ly < CHUNK_HEIGHT; ly++) {
                    const wy = cy * CHUNK_HEIGHT + ly;
                    for (let lx = 0; lx < CHUNK_WIDTH; lx++) {
                        const wx = cx * CHUNK_WIDTH + lx;
                        cells[idx++] = computeCellData(wx, wy, wz) ?? AIR_CELL;
                    }
                }
            }
            return cells;
        },
        smoothing: 0,
        normalSmoothing: 0,
    }, scene);
    console.log('[Sprite Culling Test] Flat 500x500 cell-map created');

    // 7. Lighting: simple ambient + directional, enough to read the ground/trees.
    const ambientNexus = await Omosuen.newComponent('nexus', { name: 'Ambient Light Nexus' }, scene);
    await Omosuen.newComponent('light', {
        name: 'Ambient Light',
        lightType: 'ambient',
        color: new Omosuen.Vector3D(1.0, 0.97, 0.9),
        brightness: 0.6,
    }, ambientNexus);

    const dirLightNexus = await Omosuen.newComponent('nexus', { name: 'Directional Light Nexus' }, scene);
    await Omosuen.newComponent('light', {
        name: 'Directional Light',
        lightType: 'directional',
        color: new Omosuen.Vector3D(1.0, 0.95, 0.85),
        brightness: 0.6,
        direction: new Omosuen.Vector3D(0.5, -0.7, 0.2),
    }, dirLightNexus);

    // 8. Trees: one static sprite every 10th cell along X and every 10th
    // cell along Z (50x50 = 2500 trees across the full map).
    const TREE_SPACING = 10;
    let treeCount = 0;
    for (let tx = 0; tx < MAP_WIDTH; tx += TREE_SPACING) {
        for (let tz = 0; tz < MAP_DEPTH; tz += TREE_SPACING) {
            const worldPos = cellMap.cellToWorldCoordinates(new Omosuen.Vector3D(tx, 0, tz));
            const treeNexus = await Omosuen.newComponent('nexus', {
                name: `Tree ${tx}_${tz}`,
            }, scene);
            await Omosuen.newComponent('transform', {
                name: `Tree ${tx}_${tz} Transform`,
                position: worldPos,
            }, treeNexus);
            await Omosuen.newComponent('sprite', {
                name: `Tree ${tx}_${tz} Sprite`,
                textureMapKeys: { albedo: 'objects', normal: '', material: '', emission: '' },
                frame: { albedo: TREE_FRAME_INDEX, normal: 0, material: 0, emission: 0 },
                anchor: new Omosuen.Vector2D(8, 32), // bottom-center of the 16x32 frame
                tint: new Omosuen.Vector4D(1, 1, 1, 1),
                opacity: 1.0,
            }, treeNexus);
            treeCount++;
        }
    }
    pendingTreeCount = treeCount;
    console.log(`[Sprite Culling Test] Planted ${treeCount} tree sprites (every ${TREE_SPACING} cells)`);

    // 9. UI overlay
    const ui = await Omosuen.newComponent('ui-overlay', {
        name: 'Sprite Culling Test UI',
        htmlConstructorKey: 'spriteCullingTest',
        bindings: [
            { selector: '#btn-back', onActions: ['click'], methodKey: 'backToMenuFromSpriteCulling' },
            ...FRUSTUM_SLIDERS.map((s) => ({
                selector: `#${s.id}`,
                onActions: ['input'],
                methodKey: `set_${s.id}`,
            })),
        ],
    }, scene);
    console.log('[Sprite Culling Test] UI overlay created');

    console.log('[Sprite Culling Test] Scene created successfully');
    return scene;
}
