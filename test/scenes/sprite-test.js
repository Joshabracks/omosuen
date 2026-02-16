/**
 * Sprite Rendering Test Scene
 * Tests sprite rendering with camera component featuring:
 * - Animated character sprite with walk cycles
 * - Animation controller for 5 FPS looping animations
 * - Camera with viewport rendering
 * - Interactive direction controls
 */

const Omosuen = window.Omosuen;

/**
 * Register HTML constructor for sprite test UI
 */
Omosuen.registerHtmlConstructor('spriteTest', (overlay) => {
    return `
        <div class="sidebar">
            <button id="btn-back" class="sidebar-back-button">← Back</button>

            <h1 class="sidebar-title">Sprite Test</h1>

            <div class="sidebar-section">
                <div id="init-status" class="sidebar-status"></div>
            </div>

            <div id="atlas-display" class="sidebar-section" style="display: none;">
                <h3 style="color: #ff6600; margin: 10px 0;">Compiled Atlas</h3>
                <div id="atlas-image-container"></div>
            </div>

            <div id="controls" class="sidebar-section" style="display: none;">
                <div style="text-align: center; color: #ff6600; font-size: 14px; margin-bottom: 10px; text-transform: uppercase;">
                    Animation
                </div>

                <div class="sidebar-controls">
                    <div class="sidebar-controls-wide">
                        <button id="btn-walk-up" class="sidebar-button">↑ Up</button>
                    </div>
                    <button id="btn-walk-left" class="sidebar-button">← Left</button>
                    <button id="btn-walk-down" class="sidebar-button">↓ Down</button>
                    <button id="btn-walk-right" class="sidebar-button">→ Right</button>
                </div>

                <button id="btn-toggle-animation" class="sidebar-button primary" style="margin-top: 10px;">
                    Start
                </button>

                <div id="anim-status" class="sidebar-status" style="margin-top: 10px;">
                    Animation: walk-down<br>
                    Status: Stopped
                </div>
            </div>
        </div>
    `;
});

/**
 * Register UI binding for back button
 */
Omosuen.registerBinding('backToMenuFromSprite', async (event) => {
    console.log('Returning to main menu...');
    await Omosuen.switchScene('main-menu');
});

/**
 * Register UI bindings for animation controls
 */
Omosuen.registerBinding('setWalkUp', () => {
    console.log('[Sprite Test] Walk Up button clicked');
    logDebugInfo('Before Walk Up');

    const scene = Omosuen.getActiveScene();
    if (!scene) {
        console.log('[Sprite Test] No active scene found');
        return;
    }

    const animController = scene.getComponentByType('animation-controller', true);
    if (animController) {
        animController.play('walk-up');
        updateAnimStatus('walk-up', animController.isPlaying ? 'Playing' : 'Stopped');
        logDebugInfo('After Walk Up');
    } else {
        console.log('[Sprite Test] Animation controller not found');
    }
});

Omosuen.registerBinding('setWalkDown', () => {
    console.log('[Sprite Test] Walk Down button clicked');
    logDebugInfo('Before Walk Down');

    const scene = Omosuen.getActiveScene();
    if (!scene) {
        console.log('[Sprite Test] No active scene found');
        return;
    }

    const animController = scene.getComponentByType('animation-controller', true);
    if (animController) {
        animController.play('walk-down');
        updateAnimStatus('walk-down', animController.isPlaying ? 'Playing' : 'Stopped');
        logDebugInfo('After Walk Down');
    } else {
        console.log('[Sprite Test] Animation controller not found');
    }
});

Omosuen.registerBinding('setWalkLeft', () => {
    console.log('[Sprite Test] Walk Left button clicked');
    logDebugInfo('Before Walk Left');

    const scene = Omosuen.getActiveScene();
    if (!scene) {
        console.log('[Sprite Test] No active scene found');
        return;
    }

    const animController = scene.getComponentByType('animation-controller', true);
    if (animController) {
        animController.play('walk-left');
        updateAnimStatus('walk-left', animController.isPlaying ? 'Playing' : 'Stopped');
        logDebugInfo('After Walk Left');
    } else {
        console.log('[Sprite Test] Animation controller not found');
    }
});

Omosuen.registerBinding('setWalkRight', () => {
    console.log('[Sprite Test] Walk Right button clicked');
    logDebugInfo('Before Walk Right');

    const scene = Omosuen.getActiveScene();
    if (!scene) {
        console.log('[Sprite Test] No active scene found');
        return;
    }

    const animController = scene.getComponentByType('animation-controller', true);
    if (animController) {
        animController.play('walk-right');
        updateAnimStatus('walk-right', animController.isPlaying ? 'Playing' : 'Stopped');
        logDebugInfo('After Walk Right');
    } else {
        console.log('[Sprite Test] Animation controller not found');
    }
});

Omosuen.registerBinding('toggleAnimation', () => {
    console.log('[Sprite Test] Toggle Animation button clicked');
    logDebugInfo('Before Toggle');

    const scene = Omosuen.getActiveScene();
    if (!scene) {
        console.log('[Sprite Test] No active scene found');
        return;
    }

    const animController = scene.getComponentByType('animation-controller', true);
    if (!animController) {
        console.log('[Sprite Test] Animation controller not found');
        return;
    }

    const btn = document.getElementById('btn-toggle-animation');

    console.log(`[Sprite Test] Animation state before toggle: ${animController.state}`);

    if (animController.isPlaying) {
        animController.stop();
        if (btn) btn.textContent = 'Start';
        updateAnimStatus(animController.currentAnimation || 'walk-down', 'Stopped');
        console.log('[Sprite Test] Animation stopped');
    } else {
        animController.resume();
        if (btn) btn.textContent = 'Stop';
        updateAnimStatus(animController.currentAnimation || 'walk-down', 'Playing');
        console.log('[Sprite Test] Animation resumed');
    }

    logDebugInfo('After Toggle');
});

/**
 * Updates animation status display
 */
function updateAnimStatus(animName, status) {
    const statusEl = document.getElementById('anim-status');
    if (statusEl) {
        statusEl.innerHTML = `Animation: ${animName}<br>Status: ${status}`;
    }
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
    img.style.border = '2px solid #ff6600';
    img.style.imageRendering = 'pixelated';
    img.style.maxWidth = '220px';
    img.style.height = 'auto';

    return img;
}

/**
 * Displays the compiled atlas image
 */
function displayCompiledAtlas() {
    console.log('[Sprite Test] Displaying compiled atlas...');

    const scene = Omosuen.getActiveScene();
    if (!scene) {
        console.warn('[Sprite Test] No active scene for atlas display');
        return;
    }

    const atlasManager = scene.getComponentByType('atlas-manager', true);
    if (!atlasManager) {
        console.warn('[Sprite Test] No atlas manager found');
        return;
    }

    const atlasCount = atlasManager.getAtlasCount();
    console.log(`[Sprite Test] Found ${atlasCount} compiled atlases`);

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

            console.log(`[Sprite Test] Displayed atlas ${i}: ${atlas.width}x${atlas.height}`);
        }
    }

    // Show the atlas display section
    const atlasDisplay = document.getElementById('atlas-display');
    if (atlasDisplay) atlasDisplay.style.display = 'block';
}

/**
 * Logs TextureMap packed frames for verification
 */
function logTextureMapFrames() {
    console.log('\n===== [Sprite Test] TextureMap Frame Data =====');

    const scene = Omosuen.getActiveScene();
    if (!scene) {
        console.warn('[Sprite Test] No active scene');
        return;
    }

    // Look up by textureMapKey, not name
    const textureMaps = scene.getComponentsByType('texture-map', true);
    const textureMap = textureMaps.find(tm => tm.textureMapKey === 'objects');
    if (!textureMap) {
        console.warn('[Sprite Test] TextureMap with textureMapKey "objects" not found');
        return;
    }

    console.log(`TextureMap: ${textureMap.name} (key: ${textureMap.textureMapKey})`);
    console.log(`Total frames: ${textureMap.packedFrames.length}`);

    // Log frames 11-18 (walk animations) for visual verification
    const walkFrames = [11, 12, 13, 14, 15, 16, 17, 18];
    console.log('\nWalk animation frames (11-18):');

    for (const frameIndex of walkFrames) {
        const packed = textureMap.packedFrames.find(f => f.frameIndex === frameIndex);
        if (packed) {
            console.log(`  Frame ${frameIndex}: atlas=${packed.atlasIndex}, pos=(${packed.atlasPosition.x}, ${packed.atlasPosition.y}), size=(${packed.size.x}x${packed.size.y})`);
        } else {
            console.warn(`  Frame ${frameIndex}: NOT FOUND in packedFrames`);
        }
    }

    console.log('==============================================\n');
}

/**
 * Logs comprehensive debug information about scene state
 */
function logDebugInfo(label) {
    console.log(`\n===== [Sprite Test Debug] ${label} =====`);

    const scene = Omosuen.getActiveScene();
    if (!scene) {
        console.log('[Debug] No active scene');
        return;
    }

    // Find camera nexus and transform
    const cameraNexus = scene.getComponentByName('Camera Nexus', true);
    if (cameraNexus) {
        const cameraTransform = cameraNexus.getComponentByType('transform', false);
        if (cameraTransform) {
            console.log(`[Debug] Camera Transform: pos=(${cameraTransform.position.x}, ${cameraTransform.position.y}), rot=${cameraTransform.rotation}, scale=(${cameraTransform.scale.x}, ${cameraTransform.scale.y})`);
        }
        const camera = cameraNexus.getComponentByType('camera', false);
        if (camera) {
            console.log(`[Debug] Camera: zoom=${camera.zoom}, initialized=${camera._initialized}`);
        }
    }

    // Find sprite nexus and transform
    const spriteNexus = scene.getComponentByName('Character Sprite', true);
    if (spriteNexus) {
        const spriteTransform = spriteNexus.getComponentByType('transform', false);
        if (spriteTransform) {
            console.log(`[Debug] Sprite Transform: pos=(${spriteTransform.position.x}, ${spriteTransform.position.y}), rot=${spriteTransform.rotation}, scale=(${spriteTransform.scale.x}, ${spriteTransform.scale.y})`);
        }
        const sprite = spriteNexus.getComponentByType('sprite', false);
        if (sprite) {
            console.log(`[Debug] Sprite: frame=${sprite.frame.albedo}, opacity=${sprite.opacity}, tint=(${sprite.tint.x}, ${sprite.tint.y}, ${sprite.tint.z}, ${sprite.tint.w})`);
        }
    }

    // Find viewport
    const viewport = scene.getComponentByName('Sprite Viewport', true);
    if (viewport) {
        console.log(`[Debug] Viewport: ${viewport.width}x${viewport.height} at offset (${viewport.offsetX}, ${viewport.offsetY})`);
    }

    // Find animation controller
    const animController = scene.getComponentByType('animation-controller', true);
    if (animController) {
        console.log(`[Debug] AnimController: current='${animController.currentAnimation}', state='${animController.state}', frameIndex=${animController.currentFrameIndex}, speed=${animController.speed}`);
    }

    console.log('========================================\n');
}

/**
 * Updates the initialization status display
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

            // Log texture map frames for verification
            logTextureMapFrames();

            // Show controls
            const controlsEl = document.getElementById('controls');
            if (controlsEl) controlsEl.style.display = 'block';

            console.log('[Sprite Test] Initialization complete');

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
 * Create and export the sprite test scene
 */
export async function createScene() {
    console.log('[Sprite Test] Creating scene...');

    // Create root nexus
    const scene = await Omosuen.newComponent('nexus', {
        name: 'Sprite Test Scene',
    });

    // 1. Create AtlasManager (global singleton with built-in image loading)
    const atlasManager = await Omosuen.newComponent('atlas-manager', {
        name: 'AtlasManager',
        config: {
            atlasSize: 1024,
            maxAtlases: 4,
            padding: 1,
        },
    });
    scene.addComponent(atlasManager);
    console.log('[Sprite Test] AtlasManager created');

    // 2. Create TextureMap for objects.png
    // Frame map from atlas-test.js (frames 11-18 are the walk animations)
    // Auto-registers with atlas manager
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

    const objectsTexture = await Omosuen.newComponent('texture-map', {
        textureMapKey: 'objects',
        name: 'Objects Tileset',
        filePath: './assets/objects.png',
        imageType: objectsFrameMap,
        atlasManager, // Auto-registers with atlas manager
    });
    scene.addComponent(objectsTexture);
    console.log('[Sprite Test] TextureMap created and auto-registered with atlas manager');

    // 3. Create Viewport (400x400, centered on screen)
    const viewport = await Omosuen.newComponent('viewport', {
        name: 'Sprite Viewport',
        width: 400,
        height: 400,
        offsetX: window.innerWidth / 2 - 200,
        offsetY: window.innerHeight / 2 - 200,
        backgroundColor: new Omosuen.Vector4D(0.1, 0.1, 0.15, 1.0),
    });
    scene.addComponent(viewport);
    console.log('[Sprite Test] Viewport created');

    // 4. Create Camera Nexus with Transform and Camera
    const cameraNexus = await Omosuen.newComponent('nexus', {
        name: 'Camera Nexus',
    });
    scene.addComponent(cameraNexus);

    // Camera transform (centered)
    const cameraTransform = await Omosuen.newComponent('transform', {
        name: 'Camera Transform',
        position: new Omosuen.Vector2D(0, 0),
        rotation: 0,
        scale: new Omosuen.Vector2D(1, 1),
    });
    cameraNexus.addComponent(cameraTransform);

    // Camera component
    const camera = await Omosuen.newComponent('camera', {
        name: 'Main Camera',
        viewportRef: 'Sprite Viewport',
        zoom: 1.0,
        axonometricAngle: 30,
    });
    cameraNexus.addComponent(camera);
    console.log('[Sprite Test] Camera created');

    // 5. Create Sprite Nexus with Transform, Sprite, and AnimationController
    const spriteNexus = await Omosuen.newComponent('nexus', {
        name: 'Character Sprite',
    });
    scene.addComponent(spriteNexus);

    // Sprite transform (centered in viewport)
    const spriteTransform = await Omosuen.newComponent('transform', {
        name: 'Character Transform',
        position: new Omosuen.Vector2D(200, 200),
        rotation: 0,
        scale: new Omosuen.Vector2D(2, 2), // 2x scale for visibility
    });
    spriteNexus.addComponent(spriteTransform);

    // Sprite component
    const sprite = await Omosuen.newComponent('sprite', {
        name: 'Character Sprite',
        textureMapKeys: {
            albedo: 'objects',
            normal: '',
            material: '',
            emission: '',
        },
        frame: {
            albedo: 11, // Start with walk-down frame 1
            normal: 0,
            emission: 0,
            material: 0,
        },
        anchor: new Omosuen.Vector2D(8, 8), // Center anchor
        tint: new Omosuen.Vector4D(1, 1, 1, 1),
        opacity: 1.0,
    });
    spriteNexus.addComponent(sprite);

    // Animation controller with walk cycle animations (5 FPS = 200ms per frame)
    const animController = await Omosuen.newComponent('animation-controller', {
        name: 'Character Animator',
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
        initialAnimation: 'walk-down',
        autoPlay: false,
    });
    spriteNexus.addComponent(animController);
    console.log('[Sprite Test] Sprite with AnimationController created');

    // 6. Create UI overlay
    const ui = await Omosuen.newComponent('ui-overlay', {
        name: 'Sprite Test UI',
        htmlConstructorKey: 'spriteTest',
        bindings: [
            {
                selector: '#btn-back',
                onActions: ['click'],
                methodKey: 'backToMenuFromSprite',
            },
            {
                selector: '#btn-walk-up',
                onActions: ['click'],
                methodKey: 'setWalkUp',
            },
            {
                selector: '#btn-walk-down',
                onActions: ['click'],
                methodKey: 'setWalkDown',
            },
            {
                selector: '#btn-walk-left',
                onActions: ['click'],
                methodKey: 'setWalkLeft',
            },
            {
                selector: '#btn-walk-right',
                onActions: ['click'],
                methodKey: 'setWalkRight',
            },
            {
                selector: '#btn-toggle-animation',
                onActions: ['click'],
                methodKey: 'toggleAnimation',
            },
        ],
    });
    scene.addComponent(ui);
    console.log('[Sprite Test] UI overlay created');

    console.log('[Sprite Test] Scene created successfully');
    return scene;
}
