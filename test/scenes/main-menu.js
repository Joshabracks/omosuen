/**
 * Main Menu Scene
 * Provides navigation to all test scenes
 */

const Omosuen = window.Omosuen;

/**
 * Register HTML constructor for main menu
 */
Omosuen.registerHtmlConstructor('mainMenu', (overlay) => {
    return `
        <div class="container screen scan-lines">
            <h1 class="title glow-strong">Omosuen Engine</h1>
            <h2 class="subtitle center">Test Game Menu</h2>
            <div class="margin-top">
                <button id="btn-message-test" class="menu-button">Message Test Scene</button>
                <button id="btn-viewport-test" class="menu-button">Viewport Test Scene</button>
                <button id="btn-future2" class="menu-button" disabled>Future Test 2</button>
            </div>
            <p class="text center margin-top">
                Press a button to load a test scene
            </p>
        </div>
    `;
});

/**
 * Register UI bindings for menu navigation
 */
Omosuen.registerBinding('loadMessageTest', async (event) => {
    console.log('Loading Message Test scene...');
    await Omosuen.switchScene('message-test');
});

Omosuen.registerBinding('loadViewportTest', async (event) => {
    console.log('Loading Viewport Test scene...');
    await Omosuen.switchScene('viewport-test');
});

/**
 * Create and export the main menu scene
 */
export async function createScene() {
    console.log('[Main Menu] Creating scene...');

    // Create root nexus
    const scene = await Omosuen.newComponent('nexus', { name: 'Main Menu' });

    // Create UI overlay
    const ui = await Omosuen.newComponent('ui-overlay', {
        name: 'Main Menu UI',
        htmlConstructorKey: 'mainMenu',
        bindings: [
            {
                selector: '#btn-message-test',
                onActions: ['click'],
                methodKey: 'loadMessageTest'
            },
            {
                selector: '#btn-viewport-test',
                onActions: ['click'],
                methodKey: 'loadViewportTest'
            }
        ]
    });

    // Add UI to scene
    scene.addComponent(ui);

    console.log('[Main Menu] Scene created successfully');
    return scene;
}
