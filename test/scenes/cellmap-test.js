/**
 * Cell-Map Rendering Test Scene
 * Tests 3D isometric cell-map rendering featuring:
 * - 20x20x10 heightmap terrain (dome/pyramid shape)
 * - Grass texture with albedo + normal maps
 * - Isometric camera view
 * - Camera pan and zoom controls
 * - Render statistics display
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
            statusEl.innerHTML = `Position: (${Math.round(cameraTransform.position.x)}, ${Math.round(cameraTransform.position.y)})<br>Zoom: ${camera.zoom.toFixed(2)}x`;
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
 * Finds the highest solid cell (shapeIndex !== 0) at a given X,Z coordinate
 * @param {Array3D} shapeMap - The shape map from the cell-map
 * @param {number} x - X grid coordinate
 * @param {number} z - Z grid coordinate
 * @param {number} maxHeight - Maximum height to search
 * @returns {number} The Y coordinate of the highest solid cell, or -1 if none found
 */
function findHighestCellY(shapeMap, x, z, maxHeight) {
    // Search from top down
    for (let y = maxHeight - 1; y >= 0; y--) {
        const shapeIndex = shapeMap.get(new Omosuen.Vector3D(x, y, z));
        if (shapeIndex !== 0) {
            return y;
        }
    }
    return -1; // No solid cell found
}

/**
 * Generates a heightmap with concentric rings for depth testing
 * Rings radiate from center using Chebyshev distance (max of |dx|, |dz|)
 * Odd rings (1, 3, 5, ...) are at height 2 (dirt)
 * Even rings (0, 2, 4, ...) are at height 4 (grass)
 * Returns both materialMap (which material to use) and shapeMap (solid vs air)
 */
function generateHeightmap(width, depth, maxHeight) {
    // Material map: which material index to use (0 = grass, 1 = dirt)
    const materialMap = new Omosuen.Array3D(
        new Omosuen.Vector3D(width, maxHeight, depth),
        0 // Default to material 0 (grass) for all cells
    );

    // Shape map: which mesh to use (0 = air/empty, 1 = cube/solid)
    const shapeMap = new Omosuen.Array3D(
        new Omosuen.Vector3D(width, maxHeight, depth),
        0 // Default to 0 (air/empty) for all cells
    );

    // Calculate center of map
    const centerX = Math.floor(width / 2);
    const centerZ = Math.floor(depth / 2);

    for (let x = 0; x < width; x++) {
        for (let z = 0; z < depth; z++) {
            // Calculate ring index using Chebyshev distance (max of absolute differences)
            // This creates square-shaped concentric rings
            const dx = Math.abs(x - centerX);
            const dz = Math.abs(z - centerZ);
            const ring = Math.max(dx, dz);

            // Odd rings = height 2, Even rings = height 4
            const height = (ring % 2 === 1) ? 2 : 4;

            // Fill cells from ground up to calculated height
            for (let y = 0; y <= height; y++) {
                // Odd rings use dirt (material 1), even rings use grass (material 0)
                const material = (ring % 2 === 1) ? 1 : 0;
                materialMap.set(new Omosuen.Vector3D(x, y, z), material);
                shapeMap.set(new Omosuen.Vector3D(x, y, z), 1); // Shape 1 = cube (solid)
            }
            // Cells above height remain as 0 (air) in shapeMap
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
        position: new Omosuen.Vector2D(-800, -300), // Center on flat plane at ground level
        rotation: 0,
        scale: new Omosuen.Vector2D(1, 1),
    }, cameraNexus)
    // Camera component with zoom to fit plane in view
    const camera = await Omosuen.newComponent('camera', {
        name: 'Main Camera',
        viewportRef: 'CellMap Viewport',
        zoom: 0.5, // Zoom out to see full 20x20 plane
        axonometricAngle: 30, // 30-degree isometric projection
        pixelScale: 2.25,
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
        // Mouse wheel: add to zoom velocity (applied each frame)
        ['mouseWheel', (_event, deltaY) => {
            // deltaY > 0 = scroll down = zoom out (negative velocity)
            // deltaY < 0 = scroll up = zoom in (positive velocity)
            zoomVelocity += -deltaY * ZOOM_ACCELERATION;
            scrollActive = true;
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
                if (Math.abs(zoomVelocity) < 0.0001) zoomVelocity = 0;
            }
        }

        // Scroll flag is consumed each frame; wheel events set it again if still scrolling
        scrollActive = false;

        requestAnimationFrame(zoomUpdateLoop);
    }

    requestAnimationFrame(zoomUpdateLoop);

    console.log('[CellMap Test] InputController created with mouse pan and zoom');

    // 6. Create Cell-Map with dome-shaped heightmap
    const MAP_WIDTH = 20;   // 20 cells wide
    const MAP_DEPTH = 20;   // 20 cells deep
    const MAP_HEIGHT = 20;  // 20 layers tall (dome gets taller towards center)
    const CELL_WIDTH = 32;  // Standard cell width
    const CELL_DEPTH = 32;  // Standard cell depth
    const CELL_HEIGHT = 16; // Standard cell height

    // Generate concentric ring heightmap for depth testing
    const { materialMap, shapeMap } = generateHeightmap(MAP_WIDTH, MAP_DEPTH, MAP_HEIGHT);
    console.log('[CellMap Test] Concentric ring heightmap generated (20x20x20): odd rings height 2, even rings height 4');

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

    await Omosuen.newComponent('cell-map', {
        name: 'Terrain Heightmap',
        materials: [grassMaterial, dirtMaterial],
        materialMap: materialMap,
        shapeMap: shapeMap, // Explicitly provide shapeMap (0 = air, 1 = solid cube)
        cellSize: new Omosuen.Vector3D(CELL_WIDTH, CELL_HEIGHT, CELL_DEPTH),
        mapSize: new Omosuen.Vector3D(MAP_WIDTH, MAP_HEIGHT, MAP_DEPTH),
        smoothing: 10
        // emissionMap: default (no emission)
        // visibilityMap: default (all visible)
    }, scene);
    console.log('[CellMap Test] CellMap created with dimensions:', MAP_WIDTH, 'x', MAP_DEPTH, 'x', MAP_HEIGHT);

    // 7. Create 10 character sprites placed on the terrain
    const animationConfigs = [
        { name: 'walk-down', frames: [11, 12] },
        { name: 'walk-left', frames: [13, 14] },
        { name: 'walk-right', frames: [15, 16] },
        { name: 'walk-up', frames: [17, 18] },
    ];

    console.log('[CellMap Test] Creating 10 character sprites on terrain (random placement)...');

    for (let i = 0; i < 10; i++) {
        // Generate random X,Z position anywhere on the map
        const randomX = Math.floor(Math.random() * MAP_WIDTH);
        const randomZ = Math.floor(Math.random() * MAP_DEPTH);

        // Find the highest solid cell at this X,Z position
        const highestY = findHighestCellY(shapeMap, randomX, randomZ, MAP_HEIGHT);

        if (highestY === -1) {
            console.warn(`[CellMap Test] No solid cell found at (${randomX}, ${randomZ}), skipping sprite ${i}`);
            continue;
        }

        // Calculate 3D world position
        // Place sprite one cell height above the terrain for "standing on top" appearance
        const worldX = (randomX * CELL_WIDTH) + (CELL_WIDTH / 2);
        const worldY = (highestY + 1) * CELL_HEIGHT;
        const worldZ = (randomZ * CELL_DEPTH) + (CELL_DEPTH / 2);

        // Create sprite nexus
        const spriteNexus = await Omosuen.newComponent('nexus', {
            name: `Character ${i + 1}`,
        }, scene);

        // Create transform with 3D world position
        // position.x = worldX, position.y = worldZ, z = worldY (vertical)
        await Omosuen.newComponent('transform', {
            name: `Character ${i + 1} Transform`,
            position: new Omosuen.Vector2D(worldX, worldZ),
            z: worldY,
            rotation: 0,
            scale: new Omosuen.Vector2D(1, 1), // 2x scale for visibility (same as sprite-test)
        }, spriteNexus);

        // Create sprite
        const sprite = await Omosuen.newComponent('sprite', {
            name: `Character ${i + 1} Sprite`,
            textureMapKeys: {
                albedo: 'objects',
                normal: 'objects-normal',
                material: '',
                emission: '',
            },
            frame: {
                albedo: 11, // Start with walk-down frame 1
                normal: 11,
                emission: 0,
                material: 0,
            },
            anchor: new Omosuen.Vector2D(8, 16), // Center anchor (16x16 sprite)
            tint: new Omosuen.Vector4D(1, 1, 1, 1),
            opacity: 1.0,
        }, spriteNexus);

        // Pick a random starting animation
        const randomAnim = animationConfigs[Math.floor(Math.random() * animationConfigs.length)];

        // Create animation controller
        const animationController = await Omosuen.newComponent('animation-controller', {
            name: `Character ${i + 1} Animator`,
            spriteId: sprite.id,
            animations: [
                {
                    name: 'walk-down',
                    frames: [11, 12],
                    frameTime: 200, // 5 FPS
                    loop: true,
                },
                {
                    name: 'walk-left',
                    frames: [13, 14],
                    frameTime: 200,
                    loop: true,
                },
                {
                    name: 'walk-right',
                    frames: [15, 16],
                    frameTime: 200,
                    loop: true,
                },
                {
                    name: 'walk-up',
                    frames: [17, 18],
                    frameTime: 200,
                    loop: true,
                },
            ],
        }, spriteNexus);
        animationController.play(randomAnim.name)
        console.log(`[CellMap Test] Created sprite ${i + 1} at grid (${randomX}, ${highestY}, ${randomZ}) -> world (${worldX}, ${worldY}, ${worldZ})`);
    }

    console.log('[CellMap Test] All character sprites created');

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
