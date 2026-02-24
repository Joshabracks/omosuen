/**
 * Viewport Test Scene
 * Demonstrates viewport component functionality with:
 * - Interactive color blending based on mouse distance from corners
 * - Click to center viewport on cursor
 * - Arrow keys to resize viewport
 * - Backspace to clear viewport
 */

const Omosuen = window.Omosuen;

/**
 * Register HTML constructor for viewport test UI
 */
Omosuen.registerHtmlConstructor('viewportTest', (overlay) => {
    return `
        <div class="container screen scan-lines">
            <button id="btn-back" class="back-button">← Back to Menu</button>
            <button id="btn-message-test" class="back-button" style="left: 140px;">→ Message Test</button>

            <h1 class="title">Viewport Test Scene</h1>

            <div class="text center">
                <p>Move mouse anywhere on screen to blend corner colors</p>
                <p>Click to center viewport on cursor</p>
                <p>Arrow keys to resize (min: 25, max: 500)</p>
                <p>Backspace to clear viewport</p>
            </div>
        </div>
    `;
});

/**
 * Register UI binding for back button
 */
Omosuen.registerBinding('backToMenuFromViewport', async (event) => {
    console.log('Returning to main menu...');
    await Omosuen.switchScene('main-menu');
});

/**
 * Register UI binding for message test button
 */
Omosuen.registerBinding('goToMessageTest', async (event) => {
    console.log('Going to message test...');
    await Omosuen.switchScene('message-test');
});

/**
 * Register UI binding for mousemove - color blending based on distance
 */
Omosuen.registerBinding('handleViewportMouseMove', function(event) {
    const scene = Omosuen.getActiveScene();
    if (!scene) return;

    const viewport = scene.getComponentByType('viewport');
    if (!viewport) return;

    // Get mouse position in document coordinates
    const mouseX = event.clientX;
    const mouseY = event.clientY;

    // Define corner positions using document/window dimensions
    const topLeft = { x: 0, y: 0 };
    const topRight = { x: window.innerWidth, y: 0 };
    const lowerRight = { x: window.innerWidth, y: window.innerHeight };
    const lowerLeft = { x: 0, y: window.innerHeight };

    // Calculate max distance (diagonal from top-right to bottom-left of document)
    const maxDistance = Math.sqrt(Math.pow(window.innerWidth, 2) + Math.pow(window.innerHeight, 2));

    // Calculate distance from each corner
    const distTopLeft = Math.sqrt(Math.pow(mouseX - topLeft.x, 2) + Math.pow(mouseY - topLeft.y, 2));
    const distTopRight = Math.sqrt(Math.pow(mouseX - topRight.x, 2) + Math.pow(mouseY - topRight.y, 2));
    const distLowerRight = Math.sqrt(Math.pow(mouseX - lowerRight.x, 2) + Math.pow(mouseY - lowerRight.y, 2));
    const distLowerLeft = Math.sqrt(Math.pow(mouseX - lowerLeft.x, 2) + Math.pow(mouseY - lowerLeft.y, 2));

    // Normalize distances to 0-1 using lerp (inverse - closer = higher weight)
    const weightTopLeft = 1 - Omosuen.lerp(0, 1, distTopLeft / maxDistance);
    const weightTopRight = 1 - Omosuen.lerp(0, 1, distTopRight / maxDistance);
    const weightLowerRight = 1 - Omosuen.lerp(0, 1, distLowerRight / maxDistance);
    const weightLowerLeft = 1 - Omosuen.lerp(0, 1, distLowerLeft / maxDistance);

    // Define corner colors (RGB values 0-1)
    const colorTopLeft = { r: 0, g: 0, b: 1 };      // Blue
    const colorTopRight = { r: 0, g: 1, b: 0 };     // Green
    const colorLowerRight = { r: 1, g: 1, b: 0 };   // Yellow
    const colorLowerLeft = { r: 1, g: 0, b: 0 };    // Red

    // Blend colors by weighted average
    const r = (
        colorTopLeft.r * weightTopLeft +
        colorTopRight.r * weightTopRight +
        colorLowerRight.r * weightLowerRight +
        colorLowerLeft.r * weightLowerLeft
    ) / 4;

    const g = (
        colorTopLeft.g * weightTopLeft +
        colorTopRight.g * weightTopRight +
        colorLowerRight.g * weightLowerRight +
        colorLowerLeft.g * weightLowerLeft
    ) / 4;

    const b = (
        colorTopLeft.b * weightTopLeft +
        colorTopRight.b * weightTopRight +
        colorLowerRight.b * weightLowerRight +
        colorLowerLeft.b * weightLowerLeft
    ) / 4;

    // Set viewport background color (RGBA, alpha = 1)
    viewport.setBackgroundColor(r, g, b, 1);
    viewport.clear();
});

/**
 * Register UI binding for mouseup - center viewport on cursor
 */
Omosuen.registerBinding('handleViewportMouseUp', function(event) {
    const scene = Omosuen.getActiveScene();
    if (!scene) return;

    const viewport = scene.getComponentByType('viewport');
    if (!viewport) return;

    // Get mouse position on screen
    const mouseX = event.clientX;
    const mouseY = event.clientY;

    // Center viewport on cursor (subtract 125 from both x and y)
    viewport.setOffset(mouseX - 125, mouseY - 125);
});

/**
 * Register UI binding for keyup - arrow keys for resize, backspace for clear
 */
Omosuen.registerBinding('handleViewportKeypress', function(event) {
    const scene = Omosuen.getActiveScene();
    if (!scene) return;

    const viewport = scene.getComponentByType('viewport');
    if (!viewport) return;

    let newWidth = viewport.width;
    let newHeight = viewport.height;

    switch(event.key) {
        case 'ArrowUp':
            newHeight = Math.min(500, viewport.height + 1);
            viewport.resize(newWidth, newHeight);
            viewport.clear();
            break;
        case 'ArrowDown':
            newHeight = Math.max(25, viewport.height - 1);
            viewport.resize(newWidth, newHeight);
            viewport.clear();
            break;
        case 'ArrowLeft':
            newWidth = Math.max(25, viewport.width - 1);
            viewport.resize(newWidth, newHeight);
            viewport.clear();
            break;
        case 'ArrowRight':
            newWidth = Math.min(500, viewport.width + 1);
            viewport.resize(newWidth, newHeight);
            viewport.clear();
            break;
        case 'Backspace':
            viewport.clear();
            break;
    }
});

/**
 * Create and export the viewport test scene
 */
export async function createScene() {
    console.log('[Viewport Test] Creating scene...');

    // Create root nexus
    const scene = await Omosuen.newComponent('nexus', { name: 'Viewport Test Scene' });

    // Create viewport component (250x250, centered on screen)
    const viewport = await Omosuen.newComponent('viewport', {
        name: 'Test Viewport',
        width: 250,
        height: 250,
        offsetX: window.innerWidth / 2 - 125,
        offsetY: window.innerHeight / 2 - 125,
        backgroundColor: new Omosuen.Vector4D(0.5, 0.5, 0.5, 1.0)
    });
    scene.addComponent(viewport);
    console.log('[Viewport Test] Viewport created');

    // Create UI overlay with viewport event bindings
    const ui = await Omosuen.newComponent('ui-overlay', {
        name: 'Viewport Test UI',
        htmlConstructorKey: 'viewportTest',
        bindings: [
            {
                selector: '#btn-back',
                onActions: ['click'],
                methodKey: 'backToMenuFromViewport'
            },
            {
                selector: '#btn-message-test',
                onActions: ['click'],
                methodKey: 'goToMessageTest'
            },
            {
                selector: 'body',
                onActions: ['mousemove'],
                methodKey: 'handleViewportMouseMove'
            },
            {
                selector: 'body',
                onActions: ['mouseup'],
                methodKey: 'handleViewportMouseUp'
            },
            {
                selector: 'body',
                onActions: ['keydown'],
                methodKey: 'handleViewportKeypress'
            }
        ]
    });
    scene.addComponent(ui);
    console.log('[Viewport Test] UI overlay created');

    console.log('[Viewport Test] Scene created successfully');
    return scene;
}
