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
