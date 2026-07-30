/**
 * Omosuen Test Game
 * Main game initialization and scene management
 */

// Wait for Omosuen to be available
if (!window.Omosuen) {
    throw new Error('Omosuen UMD bundle not loaded. Ensure ./dev/omosuen.js is included before game.js');
}

// Import Omosuen from the built UMD bundle
const Omosuen = window.Omosuen;

/**
 * Initialize the game
 */
async function initGame() {
    console.log('Initializing Omosuen Test Game...');

    // Initialize Omosuen with log suppression + the official Aseprite loader
    // plugin (self-registers the `aseprite-loader` component before scenes load).
    await Omosuen.init({
        logSuppression: 5,  // Suppress logs after 5 occurrences
        plugins: [
            './dev/aseprite-loader.plugin.js',
            './dev/browser-local-storage.plugin.js',
            './dev/perf-monitor.plugin.js'
        ]
    });

    // Create root-level messenger to log all messages
    const rootMessenger = await Omosuen.newComponent('messenger', {
        name: 'Root Message Logger'
    });

    // Register message listener to log all messages
    Omosuen.registerMethod('message-listener', 'logAllMessages', (envelope) => {
        console.log('[MESSAGE]', {
            message: envelope.message,
            sender: envelope.sender.name,
            receiver: envelope.receiver.name,
            body: envelope.body
        });
    });

    // Add listener for ALL_MESSAGES
    rootMessenger.on(Omosuen.ALL_MESSAGES, 'logAllMessages');

    // Register scene modules
    Omosuen.registerSceneModule('main-menu', '/scenes/main-menu.js');
    Omosuen.registerSceneModule('message-test', '/scenes/message-test.js');
    Omosuen.registerSceneModule('viewport-test', '/scenes/viewport-test.js');
    Omosuen.registerSceneModule('atlas-test', '/scenes/atlas-test.js');
    Omosuen.registerSceneModule('sprite-test', '/scenes/sprite-test.js');
    Omosuen.registerSceneModule('aseprite-test', '/scenes/aseprite-test.js');
    Omosuen.registerSceneModule('aseprite-multi-test', '/scenes/aseprite-multi-test.js');
    Omosuen.registerSceneModule('aseprite-shared-test', '/scenes/aseprite-shared-test.js');
    Omosuen.registerSceneModule('cellmap-test', '/scenes/cellmap-test.js');
    Omosuen.registerSceneModule('depth-cues-test', '/scenes/depth-cues-test.js');
    Omosuen.registerSceneModule('screen-pick-test', '/scenes/screen-pick-test.js');
    Omosuen.registerSceneModule('audio-test', '/scenes/audio-test.js');
    Omosuen.registerSceneModule('speed-dial-test', '/scenes/speed-dial-test.js');

    // Switch to main menu
    await Omosuen.switchScene('main-menu');

    // Start game loop at 60 FPS
    Omosuen.start(60);

    console.log('Game initialized successfully!');
}

// Start the game when page loads
window.addEventListener('load', () => {
    initGame().catch(error => {
        console.error('Failed to initialize game:', error);
    });
});
