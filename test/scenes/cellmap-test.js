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
                    <strong>Zoom:</strong> Mouse wheel
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
            statusEl.innerHTML = `Position: (${Math.round(cameraTransform.position.x)}, ${Math.round(cameraTransform.position.z)})<br>Zoom: ${camera.zoom.toFixed(2)}x`;
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

/**
 * Generates a flat grass ground with a hollow dirt structure in the center.
 * Structure: 10x10 footprint (x=5..14, z=5..14), 10 cells tall with roof.
 * Doorway: 4-cell-wide, 4-cell-tall opening on the +X face (x=14, z=8..11, y=1..4).
 * Returns both materialMap (0=grass, 1=dirt) and shapeMap (0=air, 1=solid).
 */
function generateStructureMap(width, depth, maxHeight) {
    const materialMap = new Omosuen.Array3D(
        new Omosuen.Vector3D(width, maxHeight, depth),
        0 // Default to material 0 (grass)
    );

    const shapeMap = new Omosuen.Array3D(
        new Omosuen.Vector3D(width, maxHeight, depth),
        0 // Default to 0 (air/empty)
    );

    // Flat grass ground at y=0
    for (let x = 0; x < width; x++) {
        for (let z = 0; z < depth; z++) {
            shapeMap.set(new Omosuen.Vector3D(x, 0, z), 1);
            // materialMap defaults to 0 (grass)
        }
    }

    // Structure bounds
    const SX0 = 5, SX1 = 14; // x range (inclusive)
    const SZ0 = 5, SZ1 = 14; // z range (inclusive)
    const WALL_TOP = 9;      // walls from y=1 to y=9
    const ROOF_Y = 10;       // roof at y=10

    // Doorway on +X face (x=14): z=8..11, y=1..4
    const DOOR_Z0 = 8, DOOR_Z1 = 11;
    const DOOR_Y_TOP = 4;

    // Build walls (perimeter cells from y=1 to WALL_TOP)
    for (let y = 1; y <= WALL_TOP; y++) {
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

    // Build roof at ROOF_Y (all cells in footprint)
    for (let x = SX0; x <= SX1; x++) {
        for (let z = SZ0; z <= SZ1; z++) {
            shapeMap.set(new Omosuen.Vector3D(x, ROOF_Y, z), 1);
            materialMap.set(new Omosuen.Vector3D(x, ROOF_Y, z), 1); // dirt
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

    // 1. Create AtlasManager (global singleton with built-in image loading)
    const atlasManager = await Omosuen.newComponent('atlas-manager', {
        name: 'AtlasManager',
        config: {
            atlasSize: 2048,
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
    // 2. Create TextureMaps for grass textures and sprite textures
    // Auto-registers with atlas manager and auto-loads images
    // Grass Albedo - treat entire image as single tile (no frames)
    await Promise.all([
        Omosuen.newComponent('texture-map', {
            textureMapKey: 'grass-albedo',
            name: 'Grass Albedo Texture',
            filePath: './assets/seamless-textured-grass-natural-grass-pattern_172107-1308.jpg',
            imageType: undefined, // Undefined = entire image is single frame
            atlasManager, // Auto-registers with atlas manager
        }, scene),
        Omosuen.newComponent('texture-map', {
            textureMapKey: 'grass-normal',
            name: 'Grass Normal Texture',
            filePath: './assets/seamless-textured-grass-natural-grass-pattern_172107-1308_n.png',
            imageType: undefined, // Undefined = entire image is single frame
            atlasManager,
        }, scene),
        Omosuen.newComponent('texture-map', {
            textureMapKey: 'dirt-albedo',
            name: 'Dirt Albedo Texture',
            filePath: './assets/dirt.jpg',
            imageType: undefined,
            atlasManager,
        }, scene),
        Omosuen.newComponent('texture-map', {
            textureMapKey: 'dirt-normal',
            name: 'Dirt Normal Texture',
            filePath: './assets/dirt_n.png',
            imageType: undefined,
            atlasManager,
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

    // Create material definition for grass
    const grassMaterial = {
        albedoTextureKey: 'grass-albedo',
        normalTextureKey: 'grass-normal',
        emissionTextureKey: '', // No emission
        materialTextureKey: '', // No material/PBR texture
    };

    const dirtMaterial = {
        albedoTextureKey: 'dirt-albedo',
        normalTextureKey: 'dirt-normal',
        emissionTextureKey: '',
        materialTextureKey: '',
    }

    const cellMap = await Omosuen.newComponent('cell-map', {
        name: 'Terrain Structure',
        materials: [grassMaterial, dirtMaterial],
        materialMap: materialMap,
        shapeMap: shapeMap, // Explicitly provide shapeMap (0 = air, 1 = solid cube)
        cellSize: new Omosuen.Vector3D(CELL_WIDTH, CELL_HEIGHT, CELL_DEPTH),
        mapSize: new Omosuen.Vector3D(MAP_WIDTH, MAP_HEIGHT, MAP_DEPTH),
        smoothing: 0,
        normalSmoothing: 0.75
        // emissionMap: default (no emission)
        // visibilityMap: default (all visible)
    }, scene);
    console.log('[CellMap Test] CellMap created with dimensions:', MAP_WIDTH, 'x', MAP_DEPTH, 'x', MAP_HEIGHT);

    // 6b. Create lighting components

    // Ambient light (soft yellow, pulsing brightness via sine wave)
    const ambientNexus = await Omosuen.newComponent('nexus', {
        name: 'Ambient Light Nexus',
        updateOverride: 'ambientPulse',
    }, scene);
    const ambientLight = await Omosuen.newComponent('light', {
        name: 'Ambient Light',
        lightType: 'ambient',
        color: new Omosuen.Vector3D(1.0, 0.95, 0.8),
        brightness: 0.3,
    }, ambientNexus);

    let ambientTime = 0;
    Omosuen.registerMethod('nexus', 'ambientPulse', (_nexus, deltaTime) => {
        ambientTime += deltaTime / 100000;
        // Sine wave: oscillates brightness between 0.1 and 0.5 over 1 second period
        const t = (Math.sin(ambientTime * Math.PI * 2) + 1) / 2; // 0 to 1
        ambientLight.setBrightness(0.1 + t * 0.4);
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
            anchor: new Omosuen.Vector2D(0, 8),
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

    // Patrol path: rectangular loop around the structure
    // Structure is x=5..14, z=5..14 — path runs 2 cells outside at x=3,16 z=3,16
    const PATROL_WAYPOINTS = [
        new Omosuen.Vector3D(3 * CELL_WIDTH + CELL_WIDTH / 2, CELL_HEIGHT, 3 * CELL_DEPTH + CELL_DEPTH / 2),   // 0: north (112, 16, 112)
        new Omosuen.Vector3D(3 * CELL_WIDTH + CELL_WIDTH / 2, CELL_HEIGHT, 16 * CELL_DEPTH + CELL_DEPTH / 2),  // 1: west  (112, 16, 528)
        new Omosuen.Vector3D(16 * CELL_WIDTH + CELL_WIDTH / 2, CELL_HEIGHT, 16 * CELL_DEPTH + CELL_DEPTH / 2), // 2: south (528, 16, 528)
        new Omosuen.Vector3D(16 * CELL_WIDTH + CELL_WIDTH / 2, CELL_HEIGHT, 3 * CELL_DEPTH + CELL_DEPTH / 2),  // 3: east  (528, 16, 112)
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

        // Update walk animation based on direction
        const animName = getWalkAnimName(dx, dz);
        if (animName !== currentPlayerAnim) {
            animController.play(animName);
            currentPlayerAnim = animName;
        }

        // Update reveal target to follow character
        camera.setRevealTarget(
            transform.position.x,
            transform.position.y,
            transform.position.z + (1 * CELL_HEIGHT),
        );
    });

    // Sprite A: indoor, center of structure (player-controlled)
    const indoorChar = await createCharacter(
        'Indoor Character',
        new Omosuen.Vector3D(10 * CELL_WIDTH + CELL_WIDTH / 2, CELL_HEIGHT, 10 * CELL_DEPTH + CELL_DEPTH / 2),
        true,             // showSilhouette
        'playerControl',  // WASD movement
    );
    indoorChar.animator.play('walk-down');
    console.log('[CellMap Test] Created indoor sprite at structure center with silhouette always on');

    // Sprite B: outdoor walker, starts at north corner
    const walkerA = await createCharacter(
        'Walker A',
        PATROL_WAYPOINTS[0],
        true,      // showSilhouette
        'patrolA',
    );
    console.log('[CellMap Test] Created Walker A at north (112, 16, 112)');

    // Sprite C: outdoor walker, starts at south corner (opposite side)
    const walkerB = await createCharacter(
        'Walker B',
        PATROL_WAYPOINTS[2],
        true,      // showSilhouette
        'patrolB',
    );
    console.log('[CellMap Test] Created Walker B at south (528, 16, 528)');

    console.log('[CellMap Test] All character sprites created (1 indoor + 2 patrolling around structure)');

    // Enable Y-slice clipping to reveal the interior of the structure
    camera.setRevealTarget(
        10 * CELL_WIDTH + CELL_WIDTH / 2,   // center of structure x
        CELL_HEIGHT,                          // character Y position (floor level)
        10 * CELL_DEPTH + CELL_DEPTH / 2,   // center of structure z
    );
    console.log('[CellMap Test] WASD controls enabled — reveal target tracks player');

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
