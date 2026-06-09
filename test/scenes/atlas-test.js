/**
 * Atlas Manager Test Scene
 * Tests the AtlasManager component system with three different image types:
 * - FrameMap: objects.png (mixed frame sizes: 1 tall + 21 regular)
 * - GridConfig: iso_tiles.png (3x3 grid, 8 frames)
 * - Undefined: door.png (single image)
 */

const Omosuen = window.Omosuen;

/**
 * Register HTML constructor for atlas test UI
 */
Omosuen.registerHtmlConstructor('atlasTest', (overlay) => {
    return `
        <div class="container screen scan-lines">
            <button id="btn-back" class="back-button">← Back to Menu</button>

            <h1 class="title">Atlas Manager Test</h1>

            <div class="text center">
                <button id="btn-compile" style="margin: 20px auto; padding: 15px 30px; font-size: 1.2em; background-color: #00ff00; color: #000; border: none; cursor: pointer; font-family: monospace; font-weight: bold;">
                    Compile Atlases
                </button>
                <div id="status" style="margin: 20px 0; color: #00ff00; font-size: 1.2em; display: none;">
                </div>
            </div>

            <h2 style="color: #00ff00; text-align: center;">Compiled Atlases</h2>
            <div id="atlas-container" style="display: flex; flex-wrap: wrap; justify-content: center; gap: 20px; margin: 20px 0;">
                <!-- Dynamically populated with atlas images -->
            </div>

            <h2 style="color: #00ff00; text-align: center;">Frame Information</h2>
            <div id="frame-info" style="margin: 20px; overflow-x: auto;">
                <!-- Dynamically populated with frame table -->
            </div>
        </div>
    `;
});

/**
 * Register UI binding for back button
 */
Omosuen.registerBinding('backToMenuFromAtlas', async (event) => {
    console.log('Returning to main menu...');
    await Omosuen.switchScene('main-menu');
});

/**
 * Register UI binding for compile button
 */
Omosuen.registerBinding('compileAtlases', async () => {
    console.log('[Atlas Test] Compile button clicked');

    // Get the active scene
    const scene = Omosuen.getActiveScene();
    if (!scene) {
        console.error('[Atlas Test] No active scene found');
        return;
    }

    // Run the compilation logic
    await runAtlasCompilation(scene);
});

/**
 * Runs the atlas compilation process
 * Called when the user clicks the "Compile Atlases" button
 */
async function runAtlasCompilation(scene) {
    console.log('[Atlas Test] Starting atlas compilation...');

    // Hide the compile button and show status
    const compileBtn = document.getElementById('btn-compile');
    const statusEl = document.getElementById('status');
    if (compileBtn) compileBtn.style.display = 'none';
    if (statusEl) statusEl.style.display = 'block';

    // Get components from scene
    const atlasManager = scene.getComponentByType('atlas-manager');
    const textureMaps = scene.getComponentsByType('texture-map');

    if (!atlasManager) {
        updateStatus('✗ Error: AtlasManager not found');
        console.error('[Atlas Test] Missing atlas manager component');
        return;
    }

    if (!textureMaps || textureMaps.length === 0) {
        updateStatus('✗ Error: No texture maps found');
        console.error('[Atlas Test] No texture maps found in scene');
        return;
    }

    console.log(`[Atlas Test] Found ${textureMaps.length} texture maps`);

    // Count total frames
    updateStatus(`Compiling ${textureMaps.length} texture maps...`);
    let totalFrames = 0;
    for (const tm of textureMaps) {
        totalFrames += tm.getFrameCount();
    }
    console.log(`[Atlas Test] Processing ${textureMaps.length} texture maps (${totalFrames} total frames)`);

    // Process texture maps (compile atlases)
    updateStatus('Compiling atlases... (this may take a moment)');
    let compileMs = 0;
    try {
        const compileStart = performance.now();
        await atlasManager.processTextureMaps();
        compileMs = performance.now() - compileStart;
        updateStatus('✓ Atlas compilation complete!');
        console.log(
            `[Atlas Test] Atlas compilation (load+extract+pack+build) took ` +
                `${compileMs.toFixed(1)} ms for ${totalFrames} frames → ` +
                `${atlasManager.getAtlasCount()} atlases`,
        );
    } catch (error) {
        updateStatus(`✗ Atlas compilation failed: ${error.message}`);
        console.error('[Atlas Test] Compilation failed:', error);
        return;
    }

    // Display compiled atlases
    updateStatus('Displaying compiled atlases...');
    const displayStart = performance.now();
    displayCompiledAtlases(atlasManager);
    const displayMs = performance.now() - displayStart;
    console.log(`[Atlas Test] Rendered atlas images in ${displayMs.toFixed(1)} ms`);

    // Display frame information
    updateStatus('Generating frame information table...');
    const tableStart = performance.now();
    displayFrameInfo(textureMaps);
    const tableMs = performance.now() - tableStart;
    console.log(
        `[Atlas Test] Built frame table (${totalFrames} rows) in ${tableMs.toFixed(1)} ms`,
    );

    updateStatus(
        `✓ Packed ${totalFrames} frames into ${atlasManager.getAtlasCount()} atlases ` +
            `in ${compileMs.toFixed(0)} ms (display ${(displayMs + tableMs).toFixed(0)} ms)`,
    );
    console.log('[Atlas Test] Compilation complete');
}

/**
 * Updates the status message
 */
function updateStatus(message) {
    const statusEl = document.getElementById('status');
    if (statusEl) {
        statusEl.textContent = message;
    }
    console.log('[Atlas Test]', message);
}

/**
 * Shows a full-screen "please wait" overlay during the (slow) scene asset
 * creation so testers don't mistake the long build for a hang. The returned
 * element is passed to removeLoadingOverlay() once the scene is ready.
 */
function showLoadingOverlay(message) {
    const overlay = document.createElement('div');
    overlay.id = 'atlas-loading-overlay';
    overlay.style.cssText =
        'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;' +
        'justify-content:center;background:#000;color:#00ff00;font-family:monospace;' +
        'font-size:1.5em;text-align:center;padding:40px;';
    overlay.textContent = message;
    document.body.appendChild(overlay);
    return overlay;
}

function removeLoadingOverlay(overlay) {
    if (overlay && overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
    }
}

/**
 * Keeps the loading overlay up through the real wait — component init, which
 * drains across game-loop frames AFTER createScene() returns (the loader only
 * marks the scene active once createScene resolves, then inits over frames). We
 * poll the init queue (same API sprite-test uses) and remove the overlay once
 * initialization is complete, showing progress in the meantime.
 */
function watchInitThenRemoveOverlay(overlay) {
    let started = false;
    const startTime = performance.now();
    console.log(`init start time: ${startTime}`)
    const intervalId = setInterval(() => {
        const queueLength = Omosuen.getInitQueueLength();
        const queueSize = Omosuen.getInitQueueSize();
        
        if (queueLength > 0) {
            // Init is running — show progress + the current component, keep waiting.
            started = true;
            const done = queueLength - queueSize;
            const current = Omosuen.getInitializingComponent?.();
            const label = current && current.name ? ` — ${current.name}` : '';
            overlay.textContent = `Creating test assets, please wait... (${done} / ${queueLength})${label}`;
            return;
        }
        console.log(`scene init total time: ${performance.now() - startTime}ms`)
        // queueLength === -1 means idle/complete. Remove once we've actually seen
        // init run, or after a 1s grace (covers a trivially-fast init).
        if (started || performance.now() - startTime > 1000) {
            removeLoadingOverlay(overlay);
            clearInterval(intervalId);
        }
    }, 80);
}

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
    img.style.border = '2px solid #00ff00';
    img.style.imageRendering = 'pixelated';
    img.style.maxWidth = '100%';

    return img;
}

/**
 * Displays all compiled atlases
 */
function displayCompiledAtlases(atlasManager) {
    const container = document.getElementById('atlas-container');
    if (!container) return;

    container.innerHTML = '';

    const atlasCount = atlasManager.getAtlasCount();
    console.log(`[Atlas Test] Displaying ${atlasCount} compiled atlases`);

    for (let i = 0; i < atlasCount; i++) {
        const atlas = atlasManager.getAtlas(i);
        if (atlas) {
            const wrapper = document.createElement('div');
            wrapper.style.textAlign = 'center';

            const label = document.createElement('div');
            label.textContent = `Atlas ${i} (${atlas.width}x${atlas.height})`;
            label.style.color = '#00ff00';
            label.style.marginBottom = '10px';
            label.style.fontFamily = 'monospace';

            const img = imageDataToImage(atlas);

            wrapper.appendChild(label);
            wrapper.appendChild(img);
            container.appendChild(wrapper);
        }
    }
}

/**
 * Displays frame information table
 */
function displayFrameInfo(textureMaps) {
    const container = document.getElementById('frame-info');
    if (!container) return;

    let html = `
        <table style="width: 100%; border-collapse: collapse; color: #00ff00; font-family: monospace; font-size: 0.9em;">
            <thead>
                <tr style="border-bottom: 2px solid #00ff00;">
                    <th style="padding: 10px; text-align: left;">Texture Map</th>
                    <th style="padding: 10px; text-align: center;">Frame Index</th>
                    <th style="padding: 10px; text-align: center;">Atlas Index</th>
                    <th style="padding: 10px; text-align: center;">Atlas Position</th>
                    <th style="padding: 10px; text-align: center;">Size</th>
                </tr>
            </thead>
            <tbody>
    `;

    for (const tm of textureMaps) {
        const frameCount = tm.getFrameCount();

        for (let i = 0; i < frameCount; i++) {
            const packedFrame = tm.getPackedFrame(i);
            if (packedFrame) {
                html += `
                    <tr style="border-bottom: 1px solid #00ff0044;">
                        <td style="padding: 8px;">${tm.textureMapKey}</td>
                        <td style="padding: 8px; text-align: center;">${packedFrame.frameIndex}</td>
                        <td style="padding: 8px; text-align: center;">${packedFrame.atlasIndex}</td>
                        <td style="padding: 8px; text-align: center;">(${packedFrame.atlasPosition.x}, ${packedFrame.atlasPosition.y})</td>
                        <td style="padding: 8px; text-align: center;">${packedFrame.size.x}×${packedFrame.size.y}</td>
                    </tr>
                `;
            }
        }
    }

    html += `
            </tbody>
        </table>
    `;

    container.innerHTML = html;
}

/**
 * Create and export the atlas test scene
 */
export async function createScene() {
    console.log('[Atlas Test] Creating scene...');

    // The scene builds ~750 texture-map components (~7,750 frames), which takes a
    // while — show a "please wait" message so the slow build isn't mistaken for a
    // hang. Yield one macrotask so it paints before the heavy loops below.
    const sceneStart = performance.now();
    const loadingOverlay = showLoadingOverlay('Creating test assets, please wait...');
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Create root nexus
    const scene = await Omosuen.newComponent('nexus', {
        name: 'Atlas Test Scene',
    });

    // 1. Create AtlasManager (global singleton with built-in image loading)
    const atlasManager = await Omosuen.newComponent('atlas-manager', {
        name: 'AtlasManager',
        config: {
            atlasSize: 2048,  // 2048x2048 should be plenty for these small test images
            maxAtlases: 16,
            padding: 1,       // 1px padding to prevent texture bleeding
        },
    });
    scene.addComponent(atlasManager);
    console.log('[Atlas Test] AtlasManager created');

    // 2. Create 250 copies of TextureMap for objects.png (FrameMap)
    // Auto-registers with atlas manager
    // objects.png frame map (22 frames total)
    // Layout:
    // tooooo  (row 0: y=0)  - tree + frames 1-5
    // tooooo  (row 1: y=16) - tree + frames 6-10
    // oooooo  (row 2: y=32) - frames 11-16
    // ooooox  (row 3: y=48) - frames 17-21, last cell empty
    const objectsFrameMap = [
        new Omosuen.Vector4D(0, 0, 16, 32),    // Frame 0: Tree (16x32, spans 2 rows)
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
        new Omosuen.Vector4D(0, 32, 16, 16),   // Frame 11
        new Omosuen.Vector4D(16, 32, 16, 16),  // Frame 12
        new Omosuen.Vector4D(32, 32, 16, 16),  // Frame 13
        new Omosuen.Vector4D(48, 32, 16, 16),  // Frame 14
        new Omosuen.Vector4D(64, 32, 16, 16),  // Frame 15
        new Omosuen.Vector4D(80, 32, 16, 16),  // Frame 16
        new Omosuen.Vector4D(0, 48, 16, 16),   // Frame 17
        new Omosuen.Vector4D(16, 48, 16, 16),  // Frame 18
        new Omosuen.Vector4D(32, 48, 16, 16),  // Frame 19
        new Omosuen.Vector4D(48, 48, 16, 16),  // Frame 20
        new Omosuen.Vector4D(64, 48, 16, 16),  // Frame 21
        // Skip (80, 48) - empty cell
    ];

    for (let i = 0; i < 250; i++) {
        const objectsTexture = await Omosuen.newComponent('texture-map', {
            textureMapKey: `objects_${i}`,
            name: `Objects Tileset ${i}`,
            filePath: './assets/objects.png',
            imageType: objectsFrameMap,
            atlasManager, // Auto-registers with atlas manager
        });
        scene.addComponent(objectsTexture);
    }
    console.log('[Atlas Test] Created 250 copies of objects.png TextureMap (5,500 total frames)');

    // 3. Create 250 copies of TextureMap for iso_tiles.png (GridConfig)
    for (let i = 0; i < 250; i++) {
        const tilesTexture = await Omosuen.newComponent('texture-map', {
            textureMapKey: `iso-tiles_${i}`,
            name: `Isometric Tiles ${i}`,
            filePath: './assets/iso_tiles.png',
            imageType: {
                cellSize: new Omosuen.Vector2D(32, 24),
                gridSize: new Omosuen.Vector2D(3, 3),
                cellCount: 8,  // Only first 8 cells are valid (last one is empty)
            },
            atlasManager, // Auto-registers with atlas manager
        });
        scene.addComponent(tilesTexture);
    }
    console.log('[Atlas Test] Created 250 copies of iso_tiles.png TextureMap (2,000 total frames)');

    // 4. Create 250 copies of TextureMap for door.png (undefined - single image)
    for (let i = 0; i < 250; i++) {
        const doorTexture = await Omosuen.newComponent('texture-map', {
            textureMapKey: `door_${i}`,
            name: `Door Sprite ${i}`,
            filePath: './assets/door.png',
            // No imageType - entire image is one frame
            atlasManager, // Auto-registers with atlas manager
        });
        scene.addComponent(doorTexture);
    }
    console.log('[Atlas Test] Created 250 copies of door.png TextureMap (250 total frames)');

    // 5. Create UI overlay
    const ui = await Omosuen.newComponent('ui-overlay', {
        name: 'Atlas Test UI',
        htmlConstructorKey: 'atlasTest',
        bindings: [
            {
                selector: '#btn-back',
                onActions: ['click'],
                methodKey: 'backToMenuFromAtlas',
            },
            {
                selector: '#btn-compile',
                onActions: ['click'],
                methodKey: 'compileAtlases',
            },
        ],
    });
    scene.addComponent(ui);
    console.log('[Atlas Test] UI overlay created');

    const sceneMs = performance.now() - sceneStart;
    console.log(
        `[Atlas Test] Scene assets created in ${sceneMs.toFixed(0)} ms ` +
            `(750 texture maps, ~7,750 frames)`,
    );

    // Keep the overlay up through component init (the real wait, after this
    // returns) — the watcher removes it once initialization completes.
    watchInitThenRemoveOverlay(loadingOverlay);

    console.log('[Atlas Test] Scene created successfully');
    return scene;
}
