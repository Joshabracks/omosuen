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
    const scene = Omosuen.getActiveScene();
    if (!scene) return;

    const animController = scene.getComponentByType('animation-controller', true);
    if (animController) {
        animController.play('walk-up');
        updateAnimStatus('walk-up', animController.isPlaying ? 'Playing' : 'Stopped');
    }
});

Omosuen.registerBinding('setWalkDown', () => {
    const scene = Omosuen.getActiveScene();
    if (!scene) return;

    const animController = scene.getComponentByType('animation-controller', true);
    if (animController) {
        animController.play('walk-down');
        updateAnimStatus('walk-down', animController.isPlaying ? 'Playing' : 'Stopped');
    }
});

Omosuen.registerBinding('setWalkLeft', () => {
    const scene = Omosuen.getActiveScene();
    if (!scene) return;

    const animController = scene.getComponentByType('animation-controller', true);
    if (animController) {
        animController.play('walk-left');
        updateAnimStatus('walk-left', animController.isPlaying ? 'Playing' : 'Stopped');
    }
});

Omosuen.registerBinding('setWalkRight', () => {
    const scene = Omosuen.getActiveScene();
    if (!scene) return;

    const animController = scene.getComponentByType('animation-controller', true);
    if (animController) {
        animController.play('walk-right');
        updateAnimStatus('walk-right', animController.isPlaying ? 'Playing' : 'Stopped');
    }
});

Omosuen.registerBinding('toggleAnimation', () => {
    const scene = Omosuen.getActiveScene();
    if (!scene) return;

    const animController = scene.getComponentByType('animation-controller', true);
    if (!animController) return;

    const btn = document.getElementById('btn-toggle-animation');

    if (animController.isPlaying) {
        animController.stop();
        if (btn) btn.textContent = 'Start';
        updateAnimStatus(animController.currentAnimation || 'walk-down', 'Stopped');
    } else {
        animController.resume();
        if (btn) btn.textContent = 'Stop';
        updateAnimStatus(animController.currentAnimation || 'walk-down', 'Playing');
    }
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

    // 1. Create ImageRegistry (global singleton)
    const imageRegistry = await Omosuen.newComponent('image-registry', {
        name: 'ImageRegistry',
    });
    scene.addComponent(imageRegistry);
    console.log('[Sprite Test] ImageRegistry created');

    // 2. Create AtlasManager (global singleton)
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

    // 3. Create TextureMap for objects.png
    // Frame map from atlas-test.js (frames 11-18 are the walk animations)
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
    });
    scene.addComponent(objectsTexture);
    console.log('[Sprite Test] TextureMap created');

    // Load the image and add texture map to atlas manager
    // This will trigger auto-compilation during AtlasManager init
    await imageRegistry.loadImage('./assets/objects.png');
    atlasManager.addTextureMap(objectsTexture);
    console.log('[Sprite Test] Image loaded and added to atlas manager');

    // 4. Create Viewport (400x400, centered on screen)
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

    // 5. Create Camera Nexus with Transform and Camera
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

    // 6. Create Sprite Nexus with Transform, Sprite, and AnimationController
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

    // 7. Create UI overlay
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
