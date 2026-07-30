/**
 * Cell-Map Rendering Test Scene — Silhouette Demo
 * Tests 3D isometric cell-map rendering featuring:
 * - 20x20 flat grass terrain with a hollow 10x10 dirt structure (10 cells tall, roofed)
 * - Doorway opening on the +X face
 * - 1 indoor sprite (always occluded by roof, silhouette always visible)
 * - 2 outdoor sprites patrolling around the structure (silhouette when behind walls)
 * - Grass + dirt textures with albedo + normal maps
 * - Isometric camera with pan and zoom controls
 */

const Omosuen = window.Omosuen;

/**
 * Register HTML constructor for cell-map test UI
 */
Omosuen.registerHtmlConstructor('cellmapTest', (overlay) => {
    return `
        <div class="sidebar">
            <button id="btn-back" class="sidebar-back-button">← Back</button>

            <h1 class="sidebar-title">Cell-Map Test</h1>

            <div class="sidebar-section">
                <div id="init-status" class="sidebar-status"></div>
            </div>

            <div id="atlas-display" class="sidebar-section" style="display: none;">
                <h3 style="color: #ff6600; margin: 10px 0;">Compiled Atlas</h3>
                <div id="atlas-image-container"></div>
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
                    <strong>Move:</strong> WASD keys<br>
                    <strong>Pan:</strong> Middle-click + drag<br>
                    <strong>Zoom:</strong> Mouse wheel<br>
                    <strong>Orbit:</strong> ←/→ arrows<br>
                    <strong>Tilt:</strong> ↑/↓ arrows
                </div>

                <div id="camera-status" class="sidebar-status" style="margin-top: 10px;"></div>
            </div>

            <div id="render-stats" class="sidebar-section" style="display: none;">
                <h3 style="color: #ff6600; margin: 10px 0;">Render Stats</h3>
                <div id="stats-display" class="sidebar-status"></div>
            </div>
        </div>
    `;
});

/**
 * Register UI binding for back button
 */
Omosuen.registerBinding('backToMenuFromCellmap', async (event) => {
    console.log('[CellMap Test] Returning to main menu...');
    await Omosuen.switchScene('main-menu');
});

/**
 * Camera control constants
 */
const PAN_SENSITIVITY = 1.0;   // Pixels of camera movement per pixel of mouse movement
const ZOOM_ACCELERATION = 0.003; // How much each scroll tick adds to zoom velocity
const ZOOM_ENTROPY = 10.75;       // Rate at which zoom velocity decays toward zero per frame
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 3.0;

/**
 * Converts ImageData to a displayable Image element
 */
function imageDataToImage(imageData) {
    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;

    const ctx = canvas.getContext('2d');
    ctx.putImageData(imageData, 0, 0);

    const img = document.createElement('img');
    img.src = canvas.toDataURL('image/png');
    img.style.border = '2px solid #ff6600';
    img.style.imageRendering = 'pixelated';
    img.style.maxWidth = '220px';
    img.style.height = 'auto';

    return img;
}

/**
 * Displays the compiled atlas images
 */
function displayCompiledAtlas() {
    console.log('[CellMap Test] Displaying compiled atlas...');

    const scene = Omosuen.getActiveScene();
    if (!scene) {
        console.warn('[CellMap Test] No active scene for atlas display');
        return;
    }

    const atlasManager = scene.getComponentByType('atlas-manager', true);
    if (!atlasManager) {
        console.warn('[CellMap Test] No atlas manager found');
        return;
    }

    const atlasCount = atlasManager.getAtlasCount();
    console.log(`[CellMap Test] Found ${atlasCount} compiled atlases`);

    const container = document.getElementById('atlas-image-container');
    if (!container) return;

    container.innerHTML = '';

    for (let i = 0; i < atlasCount; i++) {
        const atlas = atlasManager.getAtlas(i);
        if (atlas) {
            const wrapper = document.createElement('div');
            wrapper.style.marginBottom = '10px';

            const label = document.createElement('div');
            label.textContent = `Atlas ${i} (${atlas.width}x${atlas.height})`;
            label.style.color = '#ff6600';
            label.style.marginBottom = '5px';
            label.style.fontSize = '12px';

            const img = imageDataToImage(atlas);

            wrapper.appendChild(label);
            wrapper.appendChild(img);
            container.appendChild(wrapper);

            console.log(`[CellMap Test] Displayed atlas ${i}: ${atlas.width}x${atlas.height}`);
        }
    }

    // Show the atlas display section
    const atlasDisplay = document.getElementById('atlas-display');
    if (atlasDisplay) atlasDisplay.style.display = 'block';
}

/**
 * Updates camera status display
 */
function updateCameraStatus() {
    const scene = Omosuen.getActiveScene();
    if (!scene) return;

    const cameraNexus = scene.getComponentByName('Camera Nexus', true);
    if (!cameraNexus) return;

    const cameraTransform = cameraNexus.getComponentByType('transform', false);
    const camera = cameraNexus.getComponentByType('camera', false);

    if (cameraTransform && camera) {
        const statusEl = document.getElementById('camera-status');
        if (statusEl) {
            statusEl.innerHTML = `Position: (${Math.round(cameraTransform.position.x)}, ${Math.round(cameraTransform.position.z)})<br>Zoom: ${camera.zoom.toFixed(2)}x<br>Orbit: ${camera.orbitYaw.toFixed(0)}°, Tilt: ${camera.axonometricAngle.toFixed(0)}°`;
        }
    }
}

/**
 * Updates map statistics display
 */
function updateMapStats() {
    const scene = Omosuen.getActiveScene();
    if (!scene) return;

    const cellMap = scene.getComponentByType('cell-map', true);
    if (!cellMap) return;

    const statsEl = document.getElementById('map-stats');
    if (statsEl) {
        const mapSize = cellMap.mapSize;
        const cellSize = cellMap.cellSize;
        const totalCells = mapSize.x * mapSize.y * mapSize.z;

        // Count visible cells
        let visibleCells = 0;
        cellMap.packedData.forEach((packedValue) => {
            const cellData = Omosuen.unpackCell(packedValue);
            if (cellData.visible && cellData.shapeIndex !== 0) {
                visibleCells++;
            }
        });

        statsEl.innerHTML = `
            Map Size: ${mapSize.x}×${mapSize.z}×${mapSize.y}<br>
            Cell Size: ${cellSize.x}×${cellSize.z}×${cellSize.y}px<br>
            Total Cells: ${totalCells}<br>
            Visible Cells: ${visibleCells}<br>
            Materials: ${cellMap.materials.length}
        `;
    }
}

/**
 * Updates initialization status display
 */
function updateInitStatus(message) {
    const statusEl = document.getElementById('init-status');
    if (statusEl) {
        statusEl.textContent = message;
    }
}

/**
 * Polls initialization progress and updates UI
 */
let pollIntervalId = null;

function pollInitializationProgress() {
    const queueLength = Omosuen.getInitQueueLength();
    const queueSize = Omosuen.getInitQueueSize();

    // If queueLength is -1, initialization hasn't started or is complete
    if (queueLength === -1) {
        // Check if scene is active and initialization is done
        const scene = Omosuen.getActiveScene();
        if (scene) {
            // Initialization is complete
            updateInitStatus('✓ Initialization complete!');

            // Display compiled atlas for visual verification
            displayCompiledAtlas();

            updateMapStats();
            updateCameraStatus();

            // Show info panels
            const mapInfo = document.getElementById('map-info');
            const controls = document.getElementById('controls');
            const renderStats = document.getElementById('render-stats');
            if (mapInfo) mapInfo.style.display = 'block';
            if (controls) controls.style.display = 'block';
            if (renderStats) renderStats.style.display = 'block';

            console.log('[CellMap Test] Initialization complete');

            // Stop polling
            if (pollIntervalId) {
                clearInterval(pollIntervalId);
                pollIntervalId = null;
            }
            return;
        } else {
            updateInitStatus('Waiting for scene...');
        }
    } else {
        // Initialization in progress
        const completed = queueLength - queueSize;
        updateInitStatus(`Initializing ${completed} / ${queueLength} components...`);
    }
}

/**
 * Start polling automatically after scene loads
 */
setTimeout(() => {
    // Start polling if not already running
    if (!pollIntervalId) {
        pollIntervalId = setInterval(pollInitializationProgress, 100);
        // Call immediately to show initial status
        pollInitializationProgress();
    }
}, 500); // Wait 500ms for UI to be ready

const LAVA_MATERIAL_INDEX = 4;

/**
 * Generates a 2-cell-deep ground (pure dirt at y=0, grass-cap surface at y=1) with
 * a hollow dirt structure in the center sitting on the surface.
 * Ground: 2 cells deep (pure dirt material 1 at y=0, grass-cap material 0 at y=1).
 *   Split by x for an A/B of the same cap material: x < width/2 uses the UV cube
 *   (shape 5, crisp per-face) and x >= width/2 uses the default cube (shape 1,
 *   triplanar + smoothing, as Colony Forever does — the "smear" path). The map edge
 *   exposes the cap side faces (grass band on top, dirt below) over a pure-dirt
 *   bottom row, with a checkable dirt→dirt seam between the two layers.
 * Structure: 10x10 footprint (x=5..14, z=5..14), walls y=2..10, topped with a
 * stepped gable roof (ridge along X) built from custom ramp meshes. Everything is
 * raised one cell vs. the old 1-deep ground.
 * Doorway: 4-cell-wide, 4-cell-tall opening on the +X face (x=14, z=8..11, y=2..5).
 * Returns both materialMap and shapeMap. Shape indices: 0=air, 1=cube,
 *   2=rampSW, 3=rampNE, 4=halfCube (NE side non-covering), 5=UV cube. Material
 *   indices: 0=grass-cap (UV), 1=dirt, 2=grass-cap crisp cube (per-side demo),
 *   3=hard dirt (door frame), 4=lava (full 4-channel test, interior floor near
 *   the back wall). Materials 2, 3, and 4 use a smoothness override of 0.
 */
function generateStructureMap(width, depth, maxHeight) {
    const materialMap = new Omosuen.Array3D(
        new Omosuen.Vector3D(width, maxHeight, depth),
        0 // Default to material 0 (grass-cap)
    );

    const shapeMap = new Omosuen.Array3D(
        new Omosuen.Vector3D(width, maxHeight, depth),
        0 // Default to 0 (air/empty)
    );

    // 2-deep ground: pure dirt at y=0, grass-cap surface at y=1. The ground is split
    // so the map edge compares the two texturing paths for the SAME cap material:
    //   x <  width/2 → UV cube (shape 5): crisp per-face frames (the fix).
    //   x >= width/2 → default cube (shape 1): triplanar + smoothing — exactly how
    //                  Colony Forever builds terrain, and where the cap "smears".
    const half = Math.floor(width / 2);
    for (let x = 0; x < width; x++) {
        const groundShape = x < half ? 5 : 1;
        for (let z = 0; z < depth; z++) {
            shapeMap.set(new Omosuen.Vector3D(x, 0, z), groundShape);
            materialMap.set(new Omosuen.Vector3D(x, 0, z), 1); // pure dirt (bottom row)
            shapeMap.set(new Omosuen.Vector3D(x, 1, z), groundShape);
            // materialMap defaults to 0 (grass-cap surface)
        }
    }

    // Structure bounds (raised 1 cell so it sits on the y=1 grass-cap surface)
    const SX0 = 5, SX1 = 14; // x range (inclusive)
    const SZ0 = 5, SZ1 = 14; // z range (inclusive)
    const WALL_TOP = 10;     // walls from y=2 to y=10
    const ROOF_Y = 11;       // roof at y=11

    // Doorway on +X face (x=14): z=8..11, y=2..5
    const DOOR_Z0 = 8, DOOR_Z1 = 11;
    const DOOR_Y_TOP = 5;

    // Build walls (perimeter cells from y=2 to WALL_TOP)
    for (let y = 2; y <= WALL_TOP; y++) {
        for (let x = SX0; x <= SX1; x++) {
            for (let z = SZ0; z <= SZ1; z++) {
                // Only perimeter cells are walls
                const isPerimeter = (x === SX0 || x === SX1 || z === SZ0 || z === SZ1);
                if (!isPerimeter) continue;

                // Check doorway opening: +X face, within doorway z-range and y-range
                if (x === SX1 && z >= DOOR_Z0 && z <= DOOR_Z1 && y <= DOOR_Y_TOP) {
                    continue; // Leave as air (doorway)
                }

                shapeMap.set(new Omosuen.Vector3D(x, y, z), 1);
                materialMap.set(new Omosuen.Vector3D(x, y, z), 1); // dirt
            }
        }
    }

    // Stepped gable roof: the ridge runs along X, centered between z=9 and z=10.
    // Each Z-row steps up one level toward the ridge and is capped by a custom
    // ramp cell (shapeIndex 2 = rampSW on the +Z/south-west half, 3 = rampNE on
    // the -Z/north-east half). Solid dirt cubes fill beneath each ramp so the
    // gable reads as a solid mass and the two slopes meet at the ridge.
    const RIDGE_Y = 15;
    for (let x = SX0; x <= SX1; x++) {
        for (let z = SZ0; z <= SZ1; z++) {
            const distFromRidge = z >= 10 ? z - 10 : 9 - z; // 0 at ridge, 4 at eaves
            const baseY = RIDGE_Y - distFromRidge;
            const rampShape = z >= 10 ? 2 : 3; // 2 = rampSW (+Z), 3 = rampNE (-Z)

            // Supporting cubes from the roof base up to just below the ramp.
            for (let y = ROOF_Y; y < baseY; y++) {
                shapeMap.set(new Omosuen.Vector3D(x, y, z), 1);
                materialMap.set(new Omosuen.Vector3D(x, y, z), 1); // dirt
            }
            // Ramp cell on top (custom shape, dirt material).
            shapeMap.set(new Omosuen.Vector3D(x, baseY, z), rampShape);
            materialMap.set(new Omosuen.Vector3D(x, baseY, z), 1); // dirt
        }
    }

    // Special demo cell: inside the building, one level above the ground surface,
    // just behind the doorway so it is visible through the opening. Material 2 =
    // grass-cap sides + grass top, with a smoothness override of 0 (renders as a
    // crisp cube even though the map smooths everything else).
    const special = new Omosuen.Vector3D(13, 2, 9);
    shapeMap.set(special, 1);
    materialMap.set(special, 2);

    // Door frame: the wall cells ringing the +X doorway opening get material 3
    // (hard dirt, smoothness override 0). The opening stays crisp and the smooth
    // walls around it snap to these harder cells' square corners (no seams).
    for (let y = 2; y <= DOOR_Y_TOP + 1; y++) {
        for (let z = DOOR_Z0 - 1; z <= DOOR_Z1 + 1; z++) {
            const isHole = z >= DOOR_Z0 && z <= DOOR_Z1 && y <= DOOR_Y_TOP;
            if (isHole) continue;
            const cell = new Omosuen.Vector3D(SX1, y, z);
            if (shapeMap.get(cell) === 1) {
                materialMap.set(cell, 3); // hard dirt around the opening
            }
        }
    }

    // A line of half-height grass cells (shapeIndex 4) on the ground directly to
    // the south-west (+Z) of the SW building wall (z = SZ1). Their north-east (-Z)
    // face is non-covering, so the wall directly behind them stays fully visible
    // (not culled by these half cells).
    const HALF_Z = SZ1 + 1; // z = 15, just outside the SW wall
    for (let x = SX0; x <= SX1; x++) {
        shapeMap.set(new Omosuen.Vector3D(x, 2, HALF_Z), 4); // half-height cube (on the surface)
        materialMap.set(new Omosuen.Vector3D(x, 2, HALF_Z), 0); // grass-cap
    }

    // Lava floor patch: interior floor cells (y=1, the same surface the building
    // sits on) along the back wall (-X face, opposite the +X doorway). A 2-cell-deep
    // band just inside x=SX0, spanning the full interior z range. Shape is left as
    // whatever the ground loop above already set (UV cube for x < half) — only the
    // material re-skins it to lava.
    const LAVA_X0 = SX0 + 1;
    const LAVA_X1 = SX0 + 2;
    const INTERIOR_Z0 = SZ0 + 1;
    const INTERIOR_Z1 = SZ1 - 1;
    for (let x = LAVA_X0; x <= LAVA_X1; x++) {
        for (let z = INTERIOR_Z0; z <= INTERIOR_Z1; z++) {
            materialMap.set(new Omosuen.Vector3D(x, 1, z), LAVA_MATERIAL_INDEX);
        }
    }

    return { materialMap, shapeMap };
}

/**
 * Create and export the cell-map test scene
 */
export async function createScene() {
    console.log('[CellMap Test] Creating scene...');

    // Create root nexus
    const scene = await Omosuen.newComponent('nexus', {
        name: 'CellMap Test Scene',
    });

    // Perf profiler HUD (backtick to toggle) — stress-test verification for the
    // perf-monitor plugin against this scene's many sprites/timers/lights.
    await Omosuen.newComponent('perf-monitor', { name: 'PerfMonitor' }, scene);

    // 1. Create AtlasManager (global singleton with built-in image loading)
    // atlasSize bumped to 4096: the lava material's 4 channel textures are each
    // a full 2048x2048 image, which (plus padding) can't fit in a 2048 atlas page.
    const atlasManager = await Omosuen.newComponent('atlas-manager', {
        name: 'AtlasManager',
        config: {
            atlasSize: 4096,
            maxAtlases: 4,
            padding: 1,
        },
    }, scene);
    console.log('[CellMap Test] AtlasManager created');
    // Sprite TextureMaps - same frame map as sprite-test.js
    const objectsFrameMap = [
        new Omosuen.Vector4D(0, 0, 16, 32),    // Frame 0: Tree (16x32)
        new Omosuen.Vector4D(16, 0, 16, 16),   // Frame 1
        new Omosuen.Vector4D(32, 0, 16, 16),   // Frame 2
        new Omosuen.Vector4D(48, 0, 16, 16),   // Frame 3
        new Omosuen.Vector4D(64, 0, 16, 16),   // Frame 4
        new Omosuen.Vector4D(80, 0, 16, 16),   // Frame 5
        new Omosuen.Vector4D(16, 16, 16, 16),  // Frame 6
        new Omosuen.Vector4D(32, 16, 16, 16),  // Frame 7
        new Omosuen.Vector4D(48, 16, 16, 16),  // Frame 8
        new Omosuen.Vector4D(64, 16, 16, 16),  // Frame 9
        new Omosuen.Vector4D(80, 16, 16, 16),  // Frame 10
        new Omosuen.Vector4D(0, 32, 16, 16),   // Frame 11: Walk Down 1
        new Omosuen.Vector4D(16, 32, 16, 16),  // Frame 12: Walk Down 2
        new Omosuen.Vector4D(32, 32, 16, 16),  // Frame 13: Walk Left 1
        new Omosuen.Vector4D(48, 32, 16, 16),  // Frame 14: Walk Left 2
        new Omosuen.Vector4D(64, 32, 16, 16),  // Frame 15: Walk Right 1
        new Omosuen.Vector4D(80, 32, 16, 16),  // Frame 16: Walk Right 2
        new Omosuen.Vector4D(0, 48, 16, 16),   // Frame 17: Walk Up 1
        new Omosuen.Vector4D(16, 48, 16, 16),  // Frame 18: Walk Up 2
        new Omosuen.Vector4D(32, 48, 16, 16),  // Frame 19
        new Omosuen.Vector4D(48, 48, 16, 16),  // Frame 20
        new Omosuen.Vector4D(64, 48, 16, 16),  // Frame 21
    ];
    // 2. Create TextureMaps for terrain tiles and sprite textures
    // Auto-registers with atlas manager and auto-loads images
    // 16x16 tile sheet (25x25 grid, 625 frames) — same file Colony Forever uses.
    // Terrain swatches (row 21, matching Colony Forever): DIRT=533, GRASS=534, CAP=535.
    await Promise.all([
        Omosuen.newComponent('texture-map', {
            textureMapKey: 'tiles',
            name: '16x16 Tiles',
            filePath: './assets/16x16_tiles.png',
            imageType: {
                cellSize: new Omosuen.Vector2D(16, 16),
                gridSize: new Omosuen.Vector2D(25, 25),
            },
            atlasManager, // Auto-registers with atlas manager
        }, scene),
        Omosuen.newComponent('texture-map', {
            textureMapKey: 'objects',
            name: 'Objects Tileset',
            filePath: './assets/objects.png',
            imageType: objectsFrameMap,
            atlasManager,
        }, scene),
        Omosuen.newComponent('texture-map', {
            textureMapKey: 'objects-normal',
            name: 'Objects Normal Map',
            filePath: './assets/objects_n.png',
            imageType: objectsFrameMap,
            atlasManager,
        }, scene),
        // Lava material — full 4-channel test (albedo/normal/emission/material),
        // each a single 2048x2048 image (no grid).
        Omosuen.newComponent('texture-map', {
            textureMapKey: 'lava-albedo',
            name: 'Lava Albedo',
            filePath: './assets/hr_mats/lava_albedo.png',
            imageType: {
                cellSize: new Omosuen.Vector2D(2048, 2048),
                gridSize: new Omosuen.Vector2D(1, 1),
                cellCount: 1,
            },
            atlasManager,
        }, scene),
        Omosuen.newComponent('texture-map', {
            textureMapKey: 'lava-normal',
            name: 'Lava Normal',
            filePath: './assets/hr_mats/lava_normal.png',
            imageType: {
                cellSize: new Omosuen.Vector2D(2048, 2048),
                gridSize: new Omosuen.Vector2D(1, 1),
                cellCount: 1,
            },
            atlasManager,
        }, scene),
        Omosuen.newComponent('texture-map', {
            textureMapKey: 'lava-emission',
            name: 'Lava Emission',
            filePath: './assets/hr_mats/lava_emission.png',
            imageType: {
                cellSize: new Omosuen.Vector2D(2048, 2048),
                gridSize: new Omosuen.Vector2D(1, 1),
                cellCount: 1,
            },
            atlasManager,
        }, scene),
        Omosuen.newComponent('texture-map', {
            textureMapKey: 'lava-material',
            name: 'Lava Material',
            filePath: './assets/hr_mats/lava_material.png',
            imageType: {
                cellSize: new Omosuen.Vector2D(2048, 2048),
                gridSize: new Omosuen.Vector2D(1, 1),
                cellCount: 1,
            },
            atlasManager,
        }, scene),
        // Fire sprite sheet — single row of 8 frames, 32x48 each. Same texture
        // key is used for both the albedo and emission channels (self-lit flame).
        Omosuen.newComponent('texture-map', {
            textureMapKey: 'fire',
            name: 'Fire Sprite Sheet',
            filePath: './assets/fire.png',
            imageType: {
                cellSize: new Omosuen.Vector2D(32, 48),
                gridSize: new Omosuen.Vector2D(8, 1),
                cellCount: 8,
            },
            atlasManager,
        }, scene),
        // 3. Create Viewport (800x600, centered on screen for better 3D view)
        Omosuen.newComponent('viewport', {
            name: 'CellMap Viewport',
            width: 800,
            height: 600,
            offsetX: window.innerWidth / 2 - 400,
            offsetY: window.innerHeight / 2 - 300,
            backgroundColor: new Omosuen.Vector4D(0.05, 0.05, 0.1, 1.0), // Dark blue background
        }, scene),
    ])

    // 4. Create Camera Nexus with Transform and Camera
    const cameraNexus = await Omosuen.newComponent('nexus', {
        name: 'Camera Nexus',
    }, scene);

    // Camera transform (positioned to view flat plane)
    // 20x20x1 cells at 32x16x32px - single layer for spacing verification
    // Standard isometric projection (top-down, 30-degree angles)
    await Omosuen.newComponent('transform', {
        name: 'Camera Transform',
        position: new Omosuen.Vector3D(-800, 0, -300), // iso offset (x=horizontal, y=0, z=vertical)
        rotation: new Omosuen.Vector3D(0, 0, 0),
        scale: new Omosuen.Vector3D(1, 1, 1),
    }, cameraNexus)
    // Camera component with zoom to fit plane in view
    const camera = await Omosuen.newComponent('camera', {
        name: 'Main Camera',
        viewportRef: 'CellMap Viewport',
        zoom: 0.5, // Zoom out to see full 20x20 plane
        axonometricAngle: 30, // 30-degree isometric projection
        pixelScale: 2,
    }, cameraNexus)

    console.log('[CellMap Test] Camera created');

    // Arrow keys = orbit yaw / tilt. WASD already drives the indoor player-character
    // (below), so camera orbit/tilt use a separate key group here rather than W/S.
    window.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft') camera.orbitBy(-15);
        else if (e.key === 'ArrowRight') camera.orbitBy(15);
        else if (e.key === 'ArrowUp') camera.axonometricAngle = Math.min(90, camera.axonometricAngle + 5);
        else if (e.key === 'ArrowDown') camera.axonometricAngle = Math.max(0, camera.axonometricAngle - 5);
        else return;
        e.preventDefault(); // arrow keys default-scroll the page otherwise
        updateCameraStatus();
    });

    // 5. Create InputController for camera controls
    const inputController = await Omosuen.newComponent('input-controller', {
        name: 'Camera Input Controller',
        preventDefault: false, // Don't prevent default for scroll (page might need it)
    }, scene);

    // Track mouse state for middle-click panning
    let isPanning = false;
    let lastMouseX = 0;
    let lastMouseY = 0;

    // Zoom velocity state
    let zoomVelocity = 0;   // Current zoom velocity (decays to zero via entropy)
    let scrollActive = false; // True during frames where scroll events fired

    // Mouse pan: middle button + drag
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

            // Calculate mouse delta
            const deltaX = event.clientX - lastMouseX;
            const deltaY = event.clientY - lastMouseY;

            // Update last position
            lastMouseX = event.clientX;
            lastMouseY = event.clientY;

            const zoom = Omosuen.getActiveScene().getComponentByType('camera', true).zoom

            // Pan camera (no inversion - camera moves opposite to create drag-to-pan effect)
            camera.pan(deltaX * -PAN_SENSITIVITY / zoom, deltaY * -PAN_SENSITIVITY / zoom);
            updateCameraStatus();
        }],
        // Mouse wheel: add to zoom velocity and set zoom target to cursor position
        ['mouseWheel', (event, deltaY) => {
            // deltaY > 0 = scroll down = zoom out (negative velocity)
            // deltaY < 0 = scroll up = zoom in (positive velocity)
            zoomVelocity += -deltaY * ZOOM_ACCELERATION;
            scrollActive = true;

            // Set zoom target to mouse position (viewport-local coordinates)
            const viewport = Omosuen.getActiveScene().getComponentByName('CellMap Viewport', true);
            if (viewport) {
                camera.setZoomTarget(
                    event.clientX - viewport.offsetX,
                    event.clientY - viewport.offsetY,
                );
            }
        }]
    ];
    onActions.forEach((a) => inputController.onAction(...a))

    // Bind input actions
    const bindActions = [
        {
            eventType: 'mousedown',
            button: 1, // Middle mouse button
            action: 'middleMouseDown',
        },

        {
            eventType: 'mouseup',
            button: 1, // Middle mouse button
            action: 'middleMouseUp',
        },

        {
            eventType: 'mousemove',
            action: 'mouseMove',
        },

        {
            eventType: 'wheel',
            action: 'mouseWheel',
        },

        // WASD movement bindings
        { eventType: 'keydown', key: 'w', action: 'moveUp' },
        { eventType: 'keydown', key: 'a', action: 'moveLeft' },
        { eventType: 'keydown', key: 's', action: 'moveDown' },
        { eventType: 'keydown', key: 'd', action: 'moveRight' },
    ];
    bindActions.forEach(inputController.bindAction);

    // Per-frame zoom velocity update loop
    // Applies zoom velocity each frame and decays it toward zero (entropy)
    let lastFrameTime = performance.now();

    function zoomUpdateLoop() {
        const now = performance.now();
        const dt = Math.min((now - lastFrameTime) / 1000, 0.1); // seconds, capped at 100ms
        lastFrameTime = now;

        if (zoomVelocity !== 0) {
            // Apply velocity to camera zoom
            const scene = Omosuen.getActiveScene();
            if (scene) {
                const cam = scene.getComponentByType('camera', true);
                if (cam) {
                    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, cam.zoom + zoomVelocity * dt));
                    cam.setZoom(newZoom);
                    updateCameraStatus();
                }
            }

            // Entropy: decay velocity toward zero, but only when scroll is not active
            if (!scrollActive) {
                const decay = Math.sign(zoomVelocity) * ZOOM_ENTROPY * Math.abs(zoomVelocity) * dt;
                zoomVelocity -= decay;
                // Snap to zero to prevent infinite drift
                if (Math.abs(zoomVelocity) < 0.0001) {
                    zoomVelocity = 0;
                    camera.resetZoomTarget();
                }
            }
        }

        // Scroll flag is consumed each frame; wheel events set it again if still scrolling
        scrollActive = false;

        requestAnimationFrame(zoomUpdateLoop);
    }

    requestAnimationFrame(zoomUpdateLoop);

    console.log('[CellMap Test] InputController created with mouse pan and zoom');

    // 6. Create Cell-Map with hollow structure
    const MAP_WIDTH = 20;   // 20 cells wide
    const MAP_DEPTH = 20;   // 20 cells deep
    const MAP_HEIGHT = 20;  // 20 layers tall
    const CELL_WIDTH = 32;  // Standard cell width
    const CELL_DEPTH = 32;  // Standard cell depth
    const CELL_HEIGHT = 16; // Standard cell height

    // Generate flat ground with hollow dirt structure in center
    const { materialMap, shapeMap } = generateStructureMap(MAP_WIDTH, MAP_DEPTH, MAP_HEIGHT);
    console.log('[CellMap Test] Structure map generated: flat grass ground + 10x10 hollow dirt structure');

    // Tile frames into the 25x25 grid (frame = row*25 + col) — the SAME swatches
    // Colony Forever uses (src/sim/terrain/materials.ts), row 21: col 8 = dirt,
    // col 9 = grass, col 10 = grass-cap (dirt with a grass cap, for cliff sides).
    const DIRT_FRAME = 21 * 25 + 8;  // 533
    const GRASS_FRAME = 21 * 25 + 9; // 534
    const CAP_FRAME = 21 * 25 + 10;  // 535

    // Ground surface material (grass-cap): the asymmetric cap tile (grass on top,
    // dirt below) on the side faces, pure grass on the top face — exactly Colony
    // Forever's `grassTopDirt`: base = CAP on the sides, `sides.up` = GRASS on top.
    const groundTopMaterial = {
        albedoTextureKey: 'tiles',
        normalTextureKey: '',
        emissionTextureKey: '', // No emission
        materialTextureKey: '', // No material/PBR texture
        albedoFrame: CAP_FRAME,                       // grass-cap → side faces
        sides: { up: { albedoFrame: GRASS_FRAME } },  // pure grass → top face
    };

    // Pure dirt material (CF's DIRT). Used on the ground sub-layer and the building
    // walls; the dirt→dirt seam between the cap surface and this sub-layer is continuous.
    const dirtMaterial = {
        albedoTextureKey: 'tiles',
        normalTextureKey: '',
        emissionTextureKey: '',
        materialTextureKey: '',
        albedoFrame: DIRT_FRAME,
    }

    // Per-side demo material on a crisp default cube (smoothness 0): grass-cap sides,
    // grass top — the triplanar per-side path, alongside the UV-cube ground for
    // comparison. Same frames as groundTop, different shape/texturing path.
    const stoneGrassMaterial = {
        albedoTextureKey: 'tiles',
        normalTextureKey: '',
        emissionTextureKey: '',
        materialTextureKey: '',
        albedoFrame: CAP_FRAME,                       // grass-cap → south-east/south-west faces
        sides: { up: { albedoFrame: GRASS_FRAME } },  // grass → top face
        smoothness: 0,                                // crisp cube, ignores the map smoothing
    }

    // Dirt that does not smooth (smoothness override 0), used for the door frame.
    const dirtHardMaterial = {
        albedoTextureKey: 'tiles',
        normalTextureKey: '',
        emissionTextureKey: '',
        materialTextureKey: '',
        albedoFrame: DIRT_FRAME,
        smoothness: 0,
    }

    // Lava floor material — full 4-channel test (albedo/normal/emission/material).
    // Each texture is a single full-image frame (frame 0), so no per-side overrides
    // are needed. Smoothness 0 keeps the lava patch crisp against the surrounding
    // smoothed grass-cap floor (no blended/smeared seam).
    const lavaMaterial = {
        albedoTextureKey: 'lava-albedo',
        normalTextureKey: 'lava-normal',
        emissionTextureKey: 'lava-emission',
        materialTextureKey: 'lava-material',
        albedoFrame: 0,
        normalFrame: 0,
        emissionFrame: 0,
        materialFrame: 0,
        smoothness: 0,
    }

    // Custom roof meshes (triangular-prism wedges in -0.5..0.5 local space, scaled
    // by cellSize and offset to fill the cell footprint at render time). UVs are
    // unused (cells are triplanar-textured); winding is CCW so the outward face
    // normals survive back-face culling.
    //
    // rampSW: high ridge edge at z=-0.5, sloping down toward +Z (south-west).
    const rampSW = {
        vertices: new Float32Array([
            -0.5, -0.5, -0.5,  // 0 A bottom
             0.5, -0.5, -0.5,  // 1 B
             0.5, -0.5,  0.5,  // 2 C
            -0.5, -0.5,  0.5,  // 3 D
            -0.5,  0.5, -0.5,  // 4 E ridge edge (z=-0.5)
             0.5,  0.5, -0.5,  // 5 F
        ]),
        uvs: new Float32Array(0),
        indices: new Uint16Array([
            0, 1, 2, 0, 2, 3,   // bottom (-Y)
            0, 4, 5, 0, 5, 1,   // back (-Z, tall face)
            4, 3, 2, 4, 2, 5,   // slope (faces +Y/+Z)
            1, 5, 2,            // right (+X)
            0, 3, 4,            // left (-X)
        ]),
    };
    // rampNE: high ridge edge at z=+0.5, sloping down toward -Z (north-east).
    const rampNE = {
        vertices: new Float32Array([
            -0.5, -0.5, -0.5,  // 0 A bottom
             0.5, -0.5, -0.5,  // 1 B
             0.5, -0.5,  0.5,  // 2 C
            -0.5, -0.5,  0.5,  // 3 D
            -0.5,  0.5,  0.5,  // 4 G ridge edge (z=+0.5)
             0.5,  0.5,  0.5,  // 5 H
        ]),
        uvs: new Float32Array(0),
        indices: new Uint16Array([
            0, 1, 2, 0, 2, 3,   // bottom (-Y)
            3, 2, 5, 3, 5, 4,   // front (+Z, tall face)
            4, 5, 1, 4, 1, 0,   // slope (faces +Y/-Z)
            1, 5, 2,            // right (+X)
            0, 3, 4,            // left (-X)
        ]),
    };

    // halfCube: a box filling the lower half of the cell (y = -0.5 .. 0.0). Its
    // north-east (-Z) face is marked non-covering via faceCover.negZ = false, so a
    // wall cell directly to its NE still renders its full face (the half cell does
    // not occlude it). Triplanar-textured (grass), so no UVs.
    const halfCube = {
        vertices: new Float32Array([
            -0.5, -0.5, -0.5,  // 0 A bottom
             0.5, -0.5, -0.5,  // 1 B
             0.5, -0.5,  0.5,  // 2 C
            -0.5, -0.5,  0.5,  // 3 D
            -0.5,  0.0, -0.5,  // 4 E top (mid-height)
             0.5,  0.0, -0.5,  // 5 F
             0.5,  0.0,  0.5,  // 6 G
            -0.5,  0.0,  0.5,  // 7 H
        ]),
        uvs: new Float32Array(0),
        indices: new Uint16Array([
            4, 7, 6, 4, 6, 5,   // top (+Y)
            0, 1, 2, 0, 2, 3,   // bottom (-Y)
            3, 2, 6, 3, 6, 7,   // +Z (south-west)
            1, 0, 4, 1, 4, 5,   // -Z (north-east)
            1, 5, 6, 1, 6, 2,   // +X (south-east)
            0, 3, 7, 0, 7, 4,   // -X (north-west)
        ]),
        faceCover: { negZ: false }, // NE side does not occlude the neighbor wall
    };

    const cellMap = await Omosuen.newComponent('cell-map', {
        name: 'Terrain Structure',
        materials: [groundTopMaterial, dirtMaterial, stoneGrassMaterial, dirtHardMaterial, lavaMaterial],
        materialMap: materialMap,
        shapeMap: shapeMap, // 0 = air, 1 = cube, 2 = rampSW, 3 = rampNE, 4 = halfCube, 5 = UV cube
        // Index 0 (air) and 1 (default cube) are null so the builder auto-fills them.
        // Index 5 = uvCube(): a cube with per-face 0-1 UVs for crisp per-face frames.
        meshes: [null, null, rampSW, rampNE, halfCube, Omosuen.uvCube()],
        cellSize: new Omosuen.Vector3D(CELL_WIDTH, CELL_HEIGHT, CELL_DEPTH),
        mapSize: new Omosuen.Vector3D(MAP_WIDTH, MAP_HEIGHT, MAP_DEPTH),
        smoothing: 4,
        normalSmoothing: 0.75
        // emissionMap: default (no emission)
        // visibilityMap: default (all visible)
    }, scene);
    console.log('[CellMap Test] CellMap created with dimensions:', MAP_WIDTH, 'x', MAP_DEPTH, 'x', MAP_HEIGHT);

    // 6b. Create lighting components

    // Ambient light (soft yellow). Brightness is manually dialed via the number
    // keys (1-0) below rather than animated.
    const ambientNexus = await Omosuen.newComponent('nexus', {
        name: 'Ambient Light Nexus',
    }, scene);
    const ambientLight = await Omosuen.newComponent('light', {
        name: 'Ambient Light',
        lightType: 'ambient',
        color: new Omosuen.Vector3D(1.0, 0.95, 0.8),
        brightness: 0.3,
    }, ambientNexus);

    // Number-key ambient brightness control: 1 = 0.1 ... 9 = 0.9, 0 = 1.0
    // (evenly spaced in 0.1 increments across the full 1-0 row).
    const AMBIENT_BRIGHTNESS_BY_KEY = {
        '1': 0.1, '2': 0.2, '3': 0.3, '4': 0.4, '5': 0.5,
        '6': 0.6, '7': 0.7, '8': 0.8, '9': 0.9, '0': 1.0,
    };
    window.addEventListener('keydown', (e) => {
        const brightness = AMBIENT_BRIGHTNESS_BY_KEY[e.key];
        if (brightness === undefined) return;
        ambientLight.setBrightness(brightness);
        e.preventDefault();
    });

    // Point light (soft blue, center of map)
    const pointLightNexus = await Omosuen.newComponent('nexus', {
        name: 'Point Light Nexus',
    }, scene);
    await Omosuen.newComponent('transform', {
        name: 'Point Light Transform',
        position: new Omosuen.Vector3D(320, 80, 320),
    }, pointLightNexus);
    await Omosuen.newComponent('light', {
        name: 'Point Light',
        lightType: 'point',
        color: new Omosuen.Vector3D(0.4, 0.6, 1.0),
        brightness: 0.8,
        radius: 300,
        hardness: 0.3,
    }, pointLightNexus);

    // Directional light (daylight blue, slow rotating via timer)
    const dirLightNexus = await Omosuen.newComponent('nexus', {
        name: 'Directional Light Nexus',
    }, scene);
    const dirLight = await Omosuen.newComponent('light', {
        name: 'Directional Light',
        lightType: 'directional',
        color: new Omosuen.Vector3D(0.7, 0.85, 1.0),
        brightness: 0.6,
        direction: new Omosuen.Vector3D(0.5, -0.7, 0.0),
    }, dirLightNexus);

    Omosuen.registerMethod('timer', 'rotateDirectionalLight', () => {
        const dir = dirLight.direction;
        const angle = 5 * Math.PI / 180;
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        dirLight.setDirection(new Omosuen.Vector3D(
            dir.x * cosA - dir.z * sinA,
            dir.y,
            dir.x * sinA + dir.z * cosA,
        ));
    });

    const dirTimer = await Omosuen.newComponent('timer', {
        name: 'Direction Rotate Timer',
        duration: 1000,
        repeat: true,
        events: ['rotateDirectionalLight'],
    }, dirLightNexus);
    dirTimer.start();

    // Spot light (bright red, bottom-right corner)
    const spotLightNexus = await Omosuen.newComponent('nexus', {
        name: 'Spot Light Nexus',
    }, scene);
    await Omosuen.newComponent('transform', {
        name: 'Spot Light Transform',
        position: new Omosuen.Vector3D(608, 60, 608),
    }, spotLightNexus);
    await Omosuen.newComponent('light', {
        name: 'Spot Light',
        lightType: 'spot',
        color: new Omosuen.Vector3D(1.0, 0.2, 0.1),
        brightness: 1.0,
        radius: 200,
        hardness: 0.5,
    }, spotLightNexus);

    console.log('[CellMap Test] Lighting components created');

    // 7. Create 3 character sprites for silhouette demo
    //    - 1 indoor (center of structure, always occluded by roof)
    //    - 2 outdoor walkers (patrol around the structure)

    const walkAnimations = [
        { name: 'walk-down', frames: [11, 12], frameTime: 200, loop: true },
        { name: 'walk-left', frames: [13, 14], frameTime: 200, loop: true },
        { name: 'walk-right', frames: [15, 16], frameTime: 200, loop: true },
        { name: 'walk-up', frames: [17, 18], frameTime: 200, loop: true },
    ];

    // Helper: create a sprite nexus with transform, sprite, and animation controller
    async function createCharacter(name, worldPos, showSilhouette, updateOverride) {
        const nexus = await Omosuen.newComponent('nexus', {
            name,
            updateOverride: updateOverride || undefined,
        }, scene);

        await Omosuen.newComponent('transform', {
            name: `${name} Transform`,
            position: new Omosuen.Vector3D(worldPos.x, worldPos.y, worldPos.z),
        }, nexus);

        const sprite = await Omosuen.newComponent('sprite', {
            name: `${name} Sprite`,
            textureMapKeys: {
                albedo: 'objects',
                normal: 'objects-normal',
                material: '',
                emission: '',
            },
            frame: { albedo: 11, normal: 11, emission: 0, material: 0 },
            // Bottom-center anchor (16x16 frame): the feet land on the transform
            // position, so seating the transform on a cell's top face = standing on it.
            anchor: new Omosuen.Vector2D(8, 16),
            tint: new Omosuen.Vector4D(1, 1, 1, 1),
            opacity: 1.0,
            showSilhouette,
        }, nexus);

        const animator = await Omosuen.newComponent('animation-controller', {
            name: `${name} Animator`,
            spriteId: sprite.id,
            animations: walkAnimations,
        }, nexus);

        return { nexus, sprite, animator };
    }

    // Patrol path: rectangular loop around the structure (2 cells outside it, at
    // x=3,16 / z=3,16) on the grass-cap surface (cell y=1). cellToWorldCoordinates
    // returns each cell's top-face center; with the bottom-center anchor the walkers'
    // feet sit on the surface — no manual cellSize math.
    const SURFACE_Y = 1;
    const PATROL_WAYPOINTS = [
        cellMap.cellToWorldCoordinates(new Omosuen.Vector3D(3, SURFACE_Y, 3)),   // 0: north
        cellMap.cellToWorldCoordinates(new Omosuen.Vector3D(3, SURFACE_Y, 16)),  // 1: west
        cellMap.cellToWorldCoordinates(new Omosuen.Vector3D(16, SURFACE_Y, 16)), // 2: south
        cellMap.cellToWorldCoordinates(new Omosuen.Vector3D(16, SURFACE_Y, 3)),  // 3: east
    ];
    const PATROL_SPEED = 48; // units per second
    const ARRIVAL_THRESHOLD = 2; // snap to waypoint within this distance

    // Direction-to-animation mapping for isometric view:
    //   +X → walk-right, -X → walk-left, +Z → walk-down, -Z → walk-up
    function getWalkAnimName(dx, dz) {
        if (Math.abs(dx) > Math.abs(dz)) {
            return dx > 0 ? 'walk-right' : 'walk-left';
        }
        return dz > 0 ? 'walk-down' : 'walk-up';
    }

    // Register clockwise patrol around the structure
    function registerPatrol(methodName, startIndex) {
        let waypointIndex = startIndex;
        let currentAnim = '';

        Omosuen.registerMethod('nexus', methodName, (nexus, deltaTime) => {
            const transform = nexus.getComponentByType('transform', false);
            const animController = nexus.getComponentByType('animation-controller', false);
            if (!transform || !animController) return;

            const target = PATROL_WAYPOINTS[waypointIndex];
            const dx = target.x - transform.position.x;
            const dz = target.z - transform.position.z;
            const dist = Math.sqrt(dx * dx + dz * dz);

            // Switch animation based on movement direction
            const animName = getWalkAnimName(dx, dz);
            if (animName !== currentAnim) {
                animController.play(animName);
                currentAnim = animName;
            }

            const step = PATROL_SPEED * (deltaTime / 1000);
            if (dist > ARRIVAL_THRESHOLD) {
                transform.translate((dx / dist) * step, 0, (dz / dist) * step);
            } else {
                // Snap to waypoint and advance to next
                transform.setPosition(target.x, target.y, target.z);
                waypointIndex = (waypointIndex + 1) % PATROL_WAYPOINTS.length;
            }
        });
    }

    // Walker A starts north, patrols north → west → south → east
    registerPatrol('patrolA', 1);
    // Walker B starts south, patrols south → east → north → west
    registerPatrol('patrolB', 3);

    // WASD player control — moves character and updates reveal target each frame
    const PLAYER_SPEED = 64; // units per second
    let currentPlayerAnim = '';

    Omosuen.registerMethod('nexus', 'playerControl', (nexus, deltaTime) => {
        const transform = nexus.getComponentByType('transform', false);
        const animController = nexus.getComponentByType('animation-controller', false);
        if (!transform || !animController) return;

        let dx = 0, dz = 0;
        if (inputController.isActionPressed('moveUp'))    dz -= 1;
        if (inputController.isActionPressed('moveDown'))   dz += 1;
        if (inputController.isActionPressed('moveLeft'))   dx -= 1;
        if (inputController.isActionPressed('moveRight'))  dx += 1;

        if (dx === 0 && dz === 0) return;

        // Normalize diagonal movement
        const len = Math.sqrt(dx * dx + dz * dz);
        dx /= len;
        dz /= len;

        const step = PLAYER_SPEED * (deltaTime / 1000);
        transform.translate(dx * step, 0, dz * step);

        // Surface-follow: seat the (bottom-center-anchored) player on the REAL surface
        // — smoothing + custom/ramp meshes accounted for. Cast a short ray straight
        // DOWN from just above the player's current feet and snap to the hit.
        //   • Uses the player's exact (x,z) → smooth on slopes (not cell-quantized).
        //   • Starting just above the current feet keeps it correct indoors (the ray
        //     starts below the roof, so it finds the floor, not the roof above).
        //   • The hit comes from real geometry (not the follow-Y), and is always at or
        //     below the origin, so there's no feedback / launch. Keep Y on a miss.
        // (getSurfacePoint(cell) is the one-shot placement helper for a KNOWN cell;
        //  a self-referential follow loop must not derive its query cell from its own Y.)
        const cs = cellMap.cellSize;
        const origin = new Omosuen.Vector3D(
            transform.position.x,
            transform.position.y + cs.y,
            transform.position.z,
        );
        const hit = cellMap.raycast(origin, new Omosuen.Vector3D(0, -1, 0), {
            maxDistance: 3 * cs.y,
        });
        if (hit) {
            transform.setPosition(transform.position.x, hit.point.y, transform.position.z);
        }

        // Update walk animation based on direction
        const animName = getWalkAnimName(dx, dz);
        if (animName !== currentPlayerAnim) {
            animController.play(animName);
            currentPlayerAnim = animName;
        }
    });

    // Sprite A: indoor, center of structure (player-controlled), standing on the floor cell.
    const indoorChar = await createCharacter(
        'Indoor Character',
        cellMap.cellToWorldCoordinates(new Omosuen.Vector3D(10, SURFACE_Y, 10)),
        true,             // showSilhouette
        'playerControl',  // WASD movement
    );
    indoorChar.animator.play('walk-down');
    const playerCollider = await Omosuen.newComponent('collider', {
        name: 'Player Collider',
        shape: 'box',
        size: new Omosuen.Vector3D(8, 8, 8),
    }, indoorChar.nexus);
    console.log('[CellMap Test] Created indoor sprite at structure center with silhouette always on');

    // Sprite B: outdoor walker, starts at north corner
    const walkerA = await createCharacter(
        'Walker A',
        PATROL_WAYPOINTS[0],
        true,      // showSilhouette
        'patrolA',
    );
    console.log('[CellMap Test] Created Walker A at north (112, 32, 112)');

    // Sprite C: outdoor walker, starts at south corner (opposite side)
    const walkerB = await createCharacter(
        'Walker B',
        PATROL_WAYPOINTS[2],
        true,      // showSilhouette
        'patrolB',
    );
    console.log('[CellMap Test] Created Walker B at south (528, 32, 528)');

    console.log('[CellMap Test] All character sprites created (1 indoor + 2 patrolling around structure)');

    // 7a. Fire sprite — center floor tile in the room. Albedo/emission only (no
    // normal/material); both channels are driven by the same 8-frame sheet, so
    // the flame self-illuminates using its own animated colors.
    const fireNexus = await Omosuen.newComponent('nexus', {
        name: 'Fire Nexus',
    }, scene);
    await Omosuen.newComponent('transform', {
        name: 'Fire Transform',
        position: cellMap.cellToWorldCoordinates(new Omosuen.Vector3D(9, SURFACE_Y, 9)),
    }, fireNexus);
    const fireSprite = await Omosuen.newComponent('sprite', {
        name: 'Fire Sprite',
        textureMapKeys: { albedo: 'fire', normal: '', material: '', emission: 'fire' },
        frame: { albedo: 0, normal: 0, material: 0, emission: 0 },
        // Bottom-center anchor (32x48 frame): flame base sits on the floor.
        anchor: new Omosuen.Vector2D(16, 48),
    }, fireNexus);
    fireSprite.setEmissionIntensity(1.0);
    const fireAnimator = await Omosuen.newComponent('animation-controller', {
        name: 'Fire Animator',
        spriteId: fireSprite.id,
        channels: ['albedo', 'emission'],
        animations: [
            { name: 'burn', frames: [0, 1, 2, 3, 4, 5, 6, 7], frameTime: 80, loop: true },
        ],
    }, fireNexus);
    fireAnimator.play('burn');
    console.log('[CellMap Test] Fire sprite created at room center (9, 9)');

    // 7b. Create EventCollider trigger zone covering the structure interior
    const triggerNexus = await Omosuen.newComponent('nexus', {
        name: 'Interior Trigger Nexus',
    }, scene);
    await Omosuen.newComponent('transform', {
        name: 'Interior Trigger Transform',
        position: new Omosuen.Vector3D(320, 88 + CELL_HEIGHT, 320), // raised 1 cell with the structure
    }, triggerNexus);
    const interiorTrigger = await Omosuen.newComponent('event-collider', {
        name: 'Interior Trigger',
        shape: 'box',
        size: new Omosuen.Vector3D(160, 72, 160),
    }, triggerNexus);

    interiorTrigger.addTrigger(playerCollider);
    interiorTrigger.setOnEnter((collider) => {
        const t = collider.parent.getComponentByType('transform', false);
        if (t) camera.setRevealTarget(t.position.x, t.position.y, t.position.z + CELL_HEIGHT);
    });
    interiorTrigger.setOnExit(() => {
        camera.clearRevealTarget();
    });
    interiorTrigger.setWhile((collider) => {
        const t = collider.parent.getComponentByType('transform', false);
        if (t) camera.setRevealTarget(t.position.x, t.position.y, t.position.z + CELL_HEIGHT);
    });
    console.log('[CellMap Test] Interior EventCollider trigger zone created — reveal target tracks player on enter/exit');

    // 8. Create UI overlay
    const ui = await Omosuen.newComponent('ui-overlay', {
        name: 'CellMap Test UI',
        htmlConstructorKey: 'cellmapTest',
        bindings: [
            {
                selector: '#btn-back',
                onActions: ['click'],
                methodKey: 'backToMenuFromCellmap',
            },
        ],
    }, scene);
    console.log('[CellMap Test] UI overlay created');

    console.log('[CellMap Test] Scene created successfully');
    return scene;
}
