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

                <div class="sidebar-controls">
                    <div class="sidebar-controls-wide">
                        <button id="btn-pan-up" class="sidebar-button">↑ Pan Up</button>
                    </div>
                    <button id="btn-pan-left" class="sidebar-button">← Pan Left</button>
                    <button id="btn-pan-down" class="sidebar-button">↓ Pan Down</button>
                    <button id="btn-pan-right" class="sidebar-button">→ Pan Right</button>
                </div>

                <div style="display: flex; gap: 5px; margin-top: 10px;">
                    <button id="btn-zoom-in" class="sidebar-button primary" style="flex: 1;">+ Zoom In</button>
                    <button id="btn-zoom-out" class="sidebar-button primary" style="flex: 1;">− Zoom Out</button>
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
 * Register UI bindings for camera controls
 */
const PAN_AMOUNT = 50;
const ZOOM_STEP = 0.1;

Omosuen.registerBinding('panCameraUp', () => {
    const scene = Omosuen.getActiveScene();
    if (!scene) return;

    const camera = scene.getComponentByType('camera', true);
    if (camera) {
        camera.pan(0, -PAN_AMOUNT);
        updateCameraStatus();
    }
});

Omosuen.registerBinding('panCameraDown', () => {
    const scene = Omosuen.getActiveScene();
    if (!scene) return;

    const camera = scene.getComponentByType('camera', true);
    if (camera) {
        camera.pan(0, PAN_AMOUNT);
        updateCameraStatus();
    }
});

Omosuen.registerBinding('panCameraLeft', () => {
    const scene = Omosuen.getActiveScene();
    if (!scene) return;

    const camera = scene.getComponentByType('camera', true);
    if (camera) {
        camera.pan(-PAN_AMOUNT, 0);
        updateCameraStatus();
    }
});

Omosuen.registerBinding('panCameraRight', () => {
    const scene = Omosuen.getActiveScene();
    if (!scene) return;

    const camera = scene.getComponentByType('camera', true);
    if (camera) {
        camera.pan(PAN_AMOUNT, 0);
        updateCameraStatus();
    }
});

Omosuen.registerBinding('zoomCameraIn', () => {
    const scene = Omosuen.getActiveScene();
    if (!scene) return;

    const camera = scene.getComponentByType('camera', true);
    if (camera) {
        const newZoom = Math.min(camera.zoom + ZOOM_STEP, 3.0);
        camera.setZoom(newZoom);
        updateCameraStatus();
    }
});

Omosuen.registerBinding('zoomCameraOut', () => {
    const scene = Omosuen.getActiveScene();
    if (!scene) return;

    const camera = scene.getComponentByType('camera', true);
    if (camera) {
        const newZoom = Math.max(camera.zoom - ZOOM_STEP, 0.1);
        camera.setZoom(newZoom);
        updateCameraStatus();
    }
});

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
 * Generates a heightmap that creates a dome/pyramid shape
 * Height increases towards the center of the map
 */
function generateHeightmap(width, depth, maxHeight) {
    const materialMap = new Omosuen.Array3D(
        new Omosuen.Vector3D(width, maxHeight, depth),
        -1 // -1 = air/empty by default
    );

    const centerX = width / 2;
    const centerZ = depth / 2;
    const maxDistance = Math.sqrt(centerX * centerX + centerZ * centerZ);

    for (let x = 0; x < width; x++) {
        for (let z = 0; z < depth; z++) {
            // Calculate distance from center
            const dx = x - centerX;
            const dz = z - centerZ;
            const distance = Math.sqrt(dx * dx + dz * dz);

            // Height decreases with distance (dome/pyramid shape)
            const heightRatio = 1 - (distance / maxDistance);
            const height = Math.floor(heightRatio * maxHeight);

            // Fill cells from ground up to calculated height
            for (let y = 0; y <= height; y++) {
                materialMap.set(new Omosuen.Vector3D(x, y, z), 0); // Material 0 = grass
            }
        }
    }

    return materialMap;
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

    // 1. Create ImageRegistry (global singleton)
    const imageRegistry = await Omosuen.newComponent('image-registry', {
        name: 'ImageRegistry',
    });
    scene.addComponent(imageRegistry);
    console.log('[CellMap Test] ImageRegistry created');

    // 2. Create AtlasManager (global singleton)
    const atlasManager = await Omosuen.newComponent('atlas-manager', {
        name: 'AtlasManager',
        config: {
            atlasSize: 2048,
            maxAtlases: 4,
            padding: 1,
        },
    });
    scene.addComponent(atlasManager);
    console.log('[CellMap Test] AtlasManager created');

    // 3. Create TextureMaps for grass textures
    // Grass Albedo - treat entire image as single tile (no frames)
    const grassAlbedoTexture = await Omosuen.newComponent('texture-map', {
        textureMapKey: 'grass-albedo',
        name: 'Grass Albedo Texture',
        filePath: './assets/seamless-textured-grass-natural-grass-pattern_172107-1308.jpg',
        imageType: undefined, // Undefined = entire image is single frame
    });
    scene.addComponent(grassAlbedoTexture);

    // Grass Normal - treat entire image as single tile (no frames)
    const grassNormalTexture = await Omosuen.newComponent('texture-map', {
        textureMapKey: 'grass-normal',
        name: 'Grass Normal Texture',
        filePath: './assets/seamless-textured-grass-natural-grass-pattern_172107-1308_n.png',
        imageType: undefined, // Undefined = entire image is single frame
    });
    scene.addComponent(grassNormalTexture);
    console.log('[CellMap Test] TextureMaps created');

    // Load images and add to atlas manager
    await imageRegistry.loadImage('./assets/seamless-textured-grass-natural-grass-pattern_172107-1308.jpg');
    await imageRegistry.loadImage('./assets/seamless-textured-grass-natural-grass-pattern_172107-1308_n.png');
    atlasManager.addTextureMap(grassAlbedoTexture);
    atlasManager.addTextureMap(grassNormalTexture);
    console.log('[CellMap Test] Images loaded and added to atlas manager');

    // 4. Create Viewport (800x600, centered on screen for better 3D view)
    const viewport = await Omosuen.newComponent('viewport', {
        name: 'CellMap Viewport',
        width: 800,
        height: 600,
        offsetX: window.innerWidth / 2 - 400,
        offsetY: window.innerHeight / 2 - 300,
        backgroundColor: new Omosuen.Vector4D(0.05, 0.05, 0.1, 1.0), // Dark blue background
    });
    scene.addComponent(viewport);
    console.log('[CellMap Test] Viewport created');

    // 5. Create Camera Nexus with Transform and Camera
    const cameraNexus = await Omosuen.newComponent('nexus', {
        name: 'Camera Nexus',
    });
    scene.addComponent(cameraNexus);

    // Camera transform (positioned to view single cube at origin)
    // Single 64x64x64px cube at (0,0,0)
    // Standard isometric projection (top-down, 30-degree angles)
    // Cube center projects to (0, 32) in screen space (half its height up)
    const cameraTransform = await Omosuen.newComponent('transform', {
        name: 'Camera Transform',
        position: new Omosuen.Vector2D(0, -32), // Adjusted to center cube vertically
        rotation: 0,
        scale: new Omosuen.Vector2D(1, 1),
    });
    cameraNexus.addComponent(cameraTransform);

    // Camera component with normal zoom for single cube examination
    const camera = await Omosuen.newComponent('camera', {
        name: 'Main Camera',
        viewportRef: 'CellMap Viewport',
        zoom: 1.0, // Normal zoom for single cube
        axonometricAngle: 30, // 30-degree isometric projection
    });
    cameraNexus.addComponent(camera);
    console.log('[CellMap Test] Camera created');

    // 6. Create Cell-Map with single cube for testing
    const MAP_WIDTH = 1;   // Single cell wide
    const MAP_DEPTH = 1;   // Single cell deep
    const MAP_HEIGHT = 1;  // Single cell tall
    const CELL_WIDTH = 64; // Larger cube for better visibility
    const CELL_DEPTH = 64;
    const CELL_HEIGHT = 64;

    // Create simple single-cube material map
    const materialMap = new Omosuen.Array3D(
        new Omosuen.Vector3D(MAP_WIDTH, MAP_HEIGHT, MAP_DEPTH),
        -1 // -1 = air/empty
    );
    // Set single cell at (0, 0, 0) to use grass material
    materialMap.set(new Omosuen.Vector3D(0, 0, 0), 0);
    console.log('[CellMap Test] Single cube created');

    // Create material definition for grass
    const grassMaterial = {
        albedoTextureKey: 'grass-albedo',
        normalTextureKey: 'grass-normal',
        emissionTextureKey: '', // No emission
        materialTextureKey: '', // No material/PBR texture
    };

    const cellMap = await Omosuen.newComponent('cell-map', {
        name: 'Terrain Heightmap',
        materials: [grassMaterial],
        materialMap: materialMap,
        cellSize: new Omosuen.Vector3D(CELL_WIDTH, CELL_HEIGHT, CELL_DEPTH),
        mapSize: new Omosuen.Vector3D(MAP_WIDTH, MAP_HEIGHT, MAP_DEPTH),
        // shapeMap: default (all cubes)
        // emissionMap: default (no emission)
        // visibilityMap: default (all visible)
    });
    scene.addComponent(cellMap);
    console.log('[CellMap Test] CellMap created with dimensions:', MAP_WIDTH, 'x', MAP_DEPTH, 'x', MAP_HEIGHT);

    // 7. Create UI overlay
    const ui = await Omosuen.newComponent('ui-overlay', {
        name: 'CellMap Test UI',
        htmlConstructorKey: 'cellmapTest',
        bindings: [
            {
                selector: '#btn-back',
                onActions: ['click'],
                methodKey: 'backToMenuFromCellmap',
            },
            {
                selector: '#btn-pan-up',
                onActions: ['click'],
                methodKey: 'panCameraUp',
            },
            {
                selector: '#btn-pan-down',
                onActions: ['click'],
                methodKey: 'panCameraDown',
            },
            {
                selector: '#btn-pan-left',
                onActions: ['click'],
                methodKey: 'panCameraLeft',
            },
            {
                selector: '#btn-pan-right',
                onActions: ['click'],
                methodKey: 'panCameraRight',
            },
            {
                selector: '#btn-zoom-in',
                onActions: ['click'],
                methodKey: 'zoomCameraIn',
            },
            {
                selector: '#btn-zoom-out',
                onActions: ['click'],
                methodKey: 'zoomCameraOut',
            },
        ],
    });
    scene.addComponent(ui);
    console.log('[CellMap Test] UI overlay created');

    console.log('[CellMap Test] Scene created successfully');
    return scene;
}
