/**
 * Message Test Scene
 * Demonstrates messenger component functionality with:
 * - Text input with Enter key binding
 * - Data layer storage (messages keyed by timestamp)
 * - Messenger orchestration
 * - Dynamic message log display
 */

const Omosuen = window.Omosuen;

/**
 * Register HTML constructor for message test UI
 */
Omosuen.registerHtmlConstructor('messageTest', (overlay) => {
    return `
        <div class="container screen scan-lines">
            <button id="btn-back" class="back-button">← Back to Menu</button>

            <h1 class="title">Message Test Scene</h1>

            <div class="form-group">
                <label class="form-label">Enter Message:</label>
                <input
                    type="text"
                    id="message-input"
                    class="input-field"
                    placeholder="Type a message and press Enter..."
                    autocomplete="off"
                />
            </div>

            <div class="message-log" id="message-log">
                <div class="text center">No messages yet. Type something above and press Enter!</div>
            </div>

            <p class="text center">
                Messages are stored in a data-layer component, keyed by timestamp.<br>
                The messenger component orchestrates all communication.
            </p>
        </div>
    `;
});

/**
 * Register UI binding for back button
 */
Omosuen.registerBinding('backToMenu', async (event) => {
    console.log('Returning to main menu...');
    await Omosuen.switchScene('main-menu');
});

/**
 * Register UI binding for Enter key on input field
 * This accesses the messenger via ui.parent and sends a message
 */
Omosuen.registerBinding('handleMessageInput', function(event) {
    // Check if Enter key was pressed
    if (event.key !== 'Enter') {
        return;
    }

    const input = event.target;
    const text = input.value.trim();

    if (!text) {
        return; // Don't send empty messages
    }

    console.log('[UI Binding] Enter pressed, message:', text);

    // Access the messenger via ui.parent.getComponentByType('messenger')
    // Note: 'this' in the binding context is the UI overlay component
    const uiOverlay = event.target.closest('[id]')?._omosuenComponent;

    // Get the scene (parent of UI overlay)
    const scene = Omosuen.getActiveScene();
    if (!scene) {
        console.error('[UI Binding] No active scene found');
        return;
    }

    // Get messenger from scene
    const messenger = scene.getComponentByType('messenger');
    if (!messenger) {
        console.error('[UI Binding] Messenger not found in scene');
        return;
    }

    // Create timestamp
    const timestamp = Date.now();

    // Send message with text-submit identifier
    console.log('[UI Binding] Sending text-submit message');
    messenger.send('text-submit', null, {
        timestamp: timestamp,
        text: text
    });

    // Clear input field
    input.value = '';
});

/**
 * Register message listener: text-submit
 * Receives message, stores in data-layer, sends message-log-update
 */
Omosuen.registerMethod('message-listener', 'handleTextSubmit', (envelope) => {
    console.log('[Listener] text-submit received:', envelope.body);

    const { timestamp, text } = envelope.body;

    // Get data-layer from scene
    const scene = Omosuen.getActiveScene();
    const dataLayer = scene.getComponentByType('data-layer');

    if (!dataLayer) {
        console.error('[Listener] Data layer not found');
        return;
    }

    // Store message in data-layer with timestamp as key
    dataLayer.set(String(timestamp), text);
    console.log('[Listener] Message stored in data-layer:', { timestamp, text });

    // Get messenger to send update notification
    const messenger = scene.getComponentByType('messenger');
    if (!messenger) {
        console.error('[Listener] Messenger not found');
        return;
    }

    // Send message-log-update message
    console.log('[Listener] Sending message-log-update');
    messenger.send('message-log-update', null, {});
});

/**
 * Register message listener: message-log-update
 * Reads data-layer and updates the display
 */
Omosuen.registerMethod('message-listener', 'handleLogUpdate', (envelope) => {
    console.log('[Listener] message-log-update received');

    // Get data-layer from scene
    const scene = Omosuen.getActiveScene();
    const dataLayer = scene.getComponentByType('data-layer');

    if (!dataLayer) {
        console.error('[Listener] Data layer not found');
        return;
    }

    // Get all messages from storage
    const messages = [];
    dataLayer.storage.forEach((text, timestamp) => {
        messages.push({
            timestamp: parseInt(timestamp),
            text: text
        });
    });

    // Sort by timestamp (oldest first)
    messages.sort((a, b) => a.timestamp - b.timestamp);

    console.log('[Listener] Found', messages.length, 'messages');

    // Update display
    const logElement = document.getElementById('message-log');
    if (!logElement) {
        console.error('[Listener] Message log element not found');
        return;
    }

    if (messages.length === 0) {
        logElement.innerHTML = '<div class="text center">No messages yet. Type something above and press Enter!</div>';
        return;
    }

    // Build HTML for messages
    let html = '';
    messages.forEach(msg => {
        const date = new Date(msg.timestamp);
        const timeStr = date.toLocaleTimeString();

        html += `
            <div class="message-entry">
                <span class="message-timestamp">[${timeStr}]</span>
                <span class="message-text">${escapeHtml(msg.text)}</span>
            </div>
        `;
    });

    logElement.innerHTML = html;

    // Scroll to bottom
    logElement.scrollTop = logElement.scrollHeight;

    console.log('[Listener] Display updated with', messages.length, 'messages');
});

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Create and export the message test scene
 */
export async function createScene() {
    console.log('[Message Test] Creating scene...');

    // Create root nexus
    const scene = await Omosuen.newComponent('nexus', { name: 'Message Test Scene' });

    // Create data-layer for message storage
    const dataLayer = await Omosuen.newComponent('data-layer', {
        name: 'Message Storage'
    });
    scene.addComponent(dataLayer);
    console.log('[Message Test] Data layer created');

    // Create messenger with listeners
    const messenger = await Omosuen.newComponent('messenger', {
        name: 'Message Test Messenger',
        listeners: [
            {
                pattern: 'text-submit',
                callbackKey: 'handleTextSubmit'
            },
            {
                pattern: 'message-log-update',
                callbackKey: 'handleLogUpdate'
            }
        ]
    });
    scene.addComponent(messenger);
    console.log('[Message Test] Messenger created with listeners');

    // Create UI overlay
    const ui = await Omosuen.newComponent('ui-overlay', {
        name: 'Message Test UI',
        htmlConstructorKey: 'messageTest',
        bindings: [
            {
                selector: '#btn-back',
                onActions: ['click'],
                methodKey: 'backToMenu'
            },
            {
                selector: '#message-input',
                onActions: ['keypress'],
                methodKey: 'handleMessageInput'
            }
        ]
    });
    scene.addComponent(ui);
    console.log('[Message Test] UI overlay created');

    console.log('[Message Test] Scene created successfully');
    return scene;
}
