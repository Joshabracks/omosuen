# Omosuen Test Game

A test game demonstrating Omosuen engine features with an IBM terminal-style UI.

## Features

- **Main Menu Scene**: Navigation hub with buttons to load different test scenes
- **Message Test Scene**: Comprehensive messenger system demonstration
  - Text input with Enter key handling
  - Data layer storage (messages keyed by timestamp)
  - Messenger component orchestration
  - Dynamic message log display
- **IBM Terminal Theme**: Orange on black retro styling

## Running the Test Game

### 1. Build Omosuen (if not already built)

```bash
npm run build:dev
```

This creates `test/dev/omosuen.js`

### 2. Start the Test Server

```bash
npm test
```

This will:
- Start the HTTP server on http://localhost:3000
- Automatically open your browser to the test game

### 3. Play the Test Game

- Main menu will load automatically
- Click "Message Test Scene" to test the messenger system
- Type messages and press Enter to see them logged
- Click "Back to Menu" to return

## File Structure

```
test/
├── index.html              # Minimal HTML entry point
├── style.css               # IBM terminal theme
├── game.js                 # Game initialization
├── integration-test-server.js  # HTTP server
└── scenes/
    ├── main-menu.js        # Main menu scene module
    └── message-test.js     # Message test scene module
```

## Architecture

### Game.js
- Imports Omosuen from UMD bundle
- Creates root messenger that logs ALL messages to console
- Registers scene modules
- Loads main menu and starts game loop

### Main Menu Scene
- UI overlay with navigation buttons
- CSS classes only (no inline styles)
- UIBindings for scene switching

### Message Test Scene
- **Data Layer**: Stores messages with timestamp keys
- **Messenger**: Orchestrates with 2 listeners:
  - `text-submit`: Receives input, stores in data-layer, triggers update
  - `message-log-update`: Reads data-layer, updates display
- **UI Binding**: Enter key handler that:
  - Gets messenger via `scene.getComponentByType('messenger')`
  - Sends `text-submit` message
  - Clears input field

## Message Flow

```
User types → Enter key
    ↓
UIBinding 'handleMessageInput'
    ↓
messenger.send('text-submit', {timestamp, text})
    ↓
Listener 'handleTextSubmit'
    ↓
dataLayer.$.set(timestamp, text)
    ↓
messenger.send('message-log-update')
    ↓
Listener 'handleLogUpdate'
    ↓
Read all from dataLayer.storage
    ↓
Update #message-log display
```

## Development Notes

- All messages are logged to console by root messenger
- CSS uses only classes (no inline styles)
- Scenes use JavaScript ES modules
- Data layer uses Proxy access (`dataLayer.$`)
- Messenger uses pattern matching for listeners

## Extending

To add a new test scene:

1. Create `scenes/your-scene.js` with `export async function createScene()`
2. Register HTML constructor and bindings
3. Register in `game.js`: `registerSceneModule('your-scene', './scenes/your-scene.js')`
4. Add button in main menu to load it

## Troubleshooting

**Scene not loading?**
- Check browser console for errors
- Ensure all bindings are registered before scene creation
- Verify HTML constructor is registered

**Messages not working?**
- Open browser console to see message logs
- Check that messenger component exists in scene
- Verify message listeners are registered

**Styles not applied?**
- Ensure `style.css` is loaded in index.html
- Check that CSS classes match those in style.css
- Use browser dev tools to inspect elements
