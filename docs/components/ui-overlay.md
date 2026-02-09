# UI Overlay Component

HTML UI binding system for overlaying user interfaces on top of your game.

---

## Overview

**UI Overlay** provides a bridge between your game components and HTML/DOM elements. It allows you to:
- Create HTML-based UI overlays
- Bind DOM events to game logic
- Show/hide UI screens
- Navigate between UI screens with history
- Apply custom CSS styling
- Dynamically construct HTML content

---

## Interface

```typescript
interface UIOverlayT extends ComponentData {
    type: 'ui-overlay';
    unique: ComponentUnique.FALSE;  // Multiple instances allowed
    element: HTMLDivElement | null;
    bindings: UIBinding[];
    cssOverrides: Record<string, string>;
    previousOverlayId?: number;
    container: HTMLElement;
    showOverride?: string;
    hideOverride?: string;
    htmlConstructorKey?: string;
    _htmlConstructed: boolean;
}

interface UIBinding {
    selector: string;           // CSS selector for elements
    onActions: UIAction[];      // DOM events to listen for
    methodKey: string;          // Callback function key
}

type UIAction = 'click' | 'input' | 'keydown' | /* ... many more */
```

---

## Usage

### Basic Creation

```typescript
import { newComponent, registerBinding } from 'omosuen';

// Register event handler
registerBinding('handleClick', (event) => {
    console.log('Button clicked!', event);
});

// Create UI overlay
const ui = await newComponent('ui-overlay', {
    name: 'Main Menu',
    bindings: [
        {
            selector: '#start-button',
            onActions: ['click'],
            methodKey: 'handleClick'
        }
    ]
});

// Set HTML content
ui.container.innerHTML = `
    <div style="padding: 20px;">
        <h1>Main Menu</h1>
        <button id="start-button">Start Game</button>
    </div>
`;

// Apply bindings
ui.applyBindings();
```

### With CSS Overrides

```typescript
const ui = await newComponent('ui-overlay', {
    name: 'HUD',
    cssOverrides: {
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        pointerEvents: 'auto',  // Allow clicks
        zIndex: '2000'
    }
});
```

### With HTML Constructor

```typescript
import { registerHtmlConstructor } from 'omosuen';

// Register HTML builder function
registerHtmlConstructor('mainMenu', (overlay) => {
    return `
        <div class="menu">
            <h1>Welcome to ${overlay.name}</h1>
            <button id="start">Start</button>
            <button id="options">Options</button>
        </div>
    `;
});

// Create overlay with constructor
const menu = await newComponent('ui-overlay', {
    name: 'Main Menu',
    htmlConstructorKey: 'mainMenu',
    bindings: [
        { selector: '#start', onActions: ['click'], methodKey: 'startGame' },
        { selector: '#options', onActions: ['click'], methodKey: 'openOptions' }
    ]
});

// HTML is constructed automatically on first update
```

### Navigation with History

```typescript
// Create menu screen
const mainMenu = await newComponent('ui-overlay', { name: 'Main Menu' });
// ... setup mainMenu ...

// Create options screen that can go back to menu
const optionsMenu = await newComponent('ui-overlay', {
    name: 'Options',
    previousOverlayId: mainMenu.id  // Links back to main menu
});

// Navigate back
optionsMenu.back();  // Hides options, shows main menu
```

---

## Methods

### show()

Show the UI overlay (set display to visible).

```typescript
ui.show(): void
```

**Example:**

```typescript
ui.show();  // Makes overlay visible
```

**Custom show behavior:**

```typescript
import { registerMethod } from 'omosuen';

registerMethod('ui-overlay', 'fade-in-show', (overlay) => {
    overlay.container.style.opacity = '0';
    overlay.container.style.display = 'block';
    // Fade in animation
    let opacity = 0;
    const interval = setInterval(() => {
        opacity += 0.1;
        overlay.container.style.opacity = opacity.toString();
        if (opacity >= 1) clearInterval(interval);
    }, 30);
});

const ui = await newComponent('ui-overlay', {
    name: 'Menu',
    overrideKey: 'fade-in'  // Uses fade-in-show and fade-in-hide
});

ui.show();  // Uses custom fade-in animation
```

### hide()

Hide the UI overlay (set display to none).

```typescript
ui.hide(): void
```

**Example:**

```typescript
ui.hide();  // Hides overlay
```

### back()

Navigate back to previous overlay in navigation history.

```typescript
ui.back(): void
```

**Effect:**
1. Hides current overlay
2. Looks up previous overlay by `previousOverlayId`
3. Shows previous overlay

**Example:**

```typescript
// Setup navigation chain
const menu = await newComponent('ui-overlay', { name: 'Menu' });
const options = await newComponent('ui-overlay', {
    name: 'Options',
    previousOverlayId: menu.id
});

options.show();  // Show options
options.back();  // Hide options, show menu
```

### applyBindings()

Apply event listeners to DOM elements based on bindings configuration.

```typescript
ui.applyBindings(): void
```

**Example:**

```typescript
// Change HTML content
ui.container.innerHTML = '<button id="new-button">Click Me</button>';

// Re-apply bindings
ui.applyBindings();
```

**Note:** Bindings are automatically applied after HTML construction. Call this manually only if you change the HTML content.

---

## Properties

### container

The root HTMLDivElement for this overlay.

```typescript
ui.container: HTMLElement
```

**Example:**

```typescript
// Set content
ui.container.innerHTML = '<h1>Hello World</h1>';

// Apply styles
ui.container.style.backgroundColor = 'black';
ui.container.style.color = 'white';
```

### bindings

Array of event bindings.

```typescript
ui.bindings: UIBinding[]
```

**Example:**

```typescript
console.log(`Overlay has ${ui.bindings.length} bindings`);

ui.bindings.forEach(binding => {
    console.log(`${binding.selector}: ${binding.onActions.join(', ')}`);
});
```

---

## Supported Events (UIAction)

UI Overlay supports all standard DOM events:

**Mouse Events:** `click`, `dblclick`, `mousedown`, `mouseup`, `mousemove`, `mouseenter`, `mouseleave`, `contextmenu`

**Keyboard Events:** `keydown`, `keyup`, `keypress`

**Focus Events:** `focus`, `blur`, `focusin`, `focusout`

**Form Events:** `input`, `change`, `submit`, `reset`

**Touch Events:** `touchstart`, `touchend`, `touchmove`, `touchcancel`

**Pointer Events:** `pointerdown`, `pointerup`, `pointermove`, `pointerenter`, `pointerleave`

**Drag & Drop:** `drag`, `dragstart`, `dragend`, `dragenter`, `dragleave`, `dragover`, `drop`

**Other:** `wheel`, `scroll`, `resize`, `load`, `error`, and more

See [src/component/ui-overlay/data.ts:11-106](../../src/component/ui-overlay/data.ts) for the complete list.

---

## Registration Functions

### registerBinding(key, callback)

Register an event handler function for UI bindings.

```typescript
import { registerBinding } from 'omosuen';

registerBinding('handleClick', (event) => {
    console.log('Clicked!', event.target);
});
```

**Callback signature:** `(event: Event) => void`

### registerHtmlConstructor(key, constructor)

Register an HTML constructor function.

```typescript
import { registerHtmlConstructor } from 'omosuen';

registerHtmlConstructor('myMenu', (overlay) => {
    return `
        <div class="menu">
            <h1>${overlay.name}</h1>
            <p>Custom HTML content</p>
        </div>
    `;
});
```

**Constructor signature:** `(overlay: UIOverlayT) => string`

---

## Common Patterns

### HUD (Heads-Up Display)

```typescript
const hud = await newComponent('ui-overlay', {
    name: 'HUD',
    cssOverrides: {
        pointerEvents: 'none'  // Don't block game input
    }
});

hud.container.innerHTML = `
    <div style="padding: 10px; color: white;">
        <div>Health: <span id="health">100</span></div>
        <div>Score: <span id="score">0</span></div>
    </div>
`;

// Update HUD
function updateHUD(health, score) {
    document.getElementById('health').textContent = health;
    document.getElementById('score').textContent = score;
}
```

### Menu System

```typescript
// Main menu
const mainMenu = await newComponent('ui-overlay', {
    name: 'Main Menu',
    htmlConstructorKey: 'mainMenu',
    bindings: [
        { selector: '#play', onActions: ['click'], methodKey: 'startGame' },
        { selector: '#quit', onActions: ['click'], methodKey: 'quitGame' }
    ]
});

// Options (can go back to main)
const options = await newComponent('ui-overlay', {
    name: 'Options',
    previousOverlayId: mainMenu.id,
    htmlConstructorKey: 'optionsMenu',
    bindings: [
        { selector: '#back', onActions: ['click'], methodKey: 'goBack' }
    ]
});

// Register handlers
registerBinding('startGame', () => {
    mainMenu.hide();
    startGameLogic();
});

registerBinding('goBack', () => {
    options.back();  // Automatically shows mainMenu
});
```

### Form Input

```typescript
registerBinding('handleInput', (event) => {
    const input = event.target as HTMLInputElement;
    console.log('User typed:', input.value);
});

const form = await newComponent('ui-overlay', {
    name: 'Login Form',
    bindings: [
        { selector: '#username', onActions: ['input'], methodKey: 'handleInput' },
        { selector: '#submit', onActions: ['click'], methodKey: 'handleSubmit' }
    ]
});

form.container.innerHTML = `
    <form>
        <input id="username" type="text" placeholder="Username">
        <button id="submit" type="button">Login</button>
    </form>
`;

form.applyBindings();
```

### Loading Screen (with loader flag)

```typescript
const loading = await newComponent('ui-overlay', {
    name: 'Loading Screen',
    loader: true  // Updates during scene initialization
});

loading.container.innerHTML = `
    <div style="text-align: center; padding: 100px;">
        <h1>Loading...</h1>
        <div id="progress">0%</div>
    </div>
`;

// Custom update to show progress
registerMethod('ui-overlay', 'loading-update', (overlay, deltaTime) => {
    const progress = getInitProgress();  // Your progress tracking
    document.getElementById('progress').textContent = `${progress}%`;

    if (progress >= 100) {
        overlay.dispose();
    }
});
```

---

## Lifecycle

### init()

- Appends `container` to `document.body`
- Called once when overlay is added to scene

### update(deltaTime)

- Constructs HTML if `htmlConstructorKey` is set and not yet constructed
- Automatically calls `applyBindings()` after HTML construction
- Called every frame (unless `loader` flag is set and init is complete)

### dispose()

- Removes all event listeners
- Removes `container` from DOM
- Clears bindings array
- Called when overlay is removed or scene unloads

---

## Best Practices

### 1. Register Handlers Before Creating Overlays

```typescript
// GOOD - Register first
registerBinding('handleClick', (event) => { /* ... */ });
const ui = await newComponent('ui-overlay', {
    bindings: [{ selector: '#btn', onActions: ['click'], methodKey: 'handleClick' }]
});

// BAD - Register after (will warn)
const ui = await newComponent('ui-overlay', { /* bindings */ });
registerBinding('handleClick', (event) => { /* ... */ });  // Too late!
```

### 2. Use pointerEvents for Click-Through

```typescript
// HUD that doesn't block game input
const hud = await newComponent('ui-overlay', {
    name: 'HUD',
    cssOverrides: {
        pointerEvents: 'none'
    }
});

// Make specific elements clickable
hud.container.innerHTML = `
    <div style="pointer-events: auto;">
        <button>Pause</button>
    </div>
`;
```

### 3. Clean Navigation Chains

```typescript
// Create linear navigation flow
const screen1 = await newComponent('ui-overlay', { name: 'Screen 1' });
const screen2 = await newComponent('ui-overlay', {
    name: 'Screen 2',
    previousOverlayId: screen1.id
});
const screen3 = await newComponent('ui-overlay', {
    name: 'Screen 3',
    previousOverlayId: screen2.id
});

// Can navigate: screen3 -> screen2 -> screen1
```

### 4. Use HTML Constructors for Reusability

```typescript
// Reusable dialog constructor
registerHtmlConstructor('dialog', (overlay) => {
    return `
        <div class="dialog-backdrop">
            <div class="dialog-content">
                <h2>${overlay.name}</h2>
                <div id="dialog-body"></div>
                <button id="close">Close</button>
            </div>
        </div>
    `;
});

// Create multiple dialogs with same structure
const alert1 = await newComponent('ui-overlay', {
    name: 'Alert',
    htmlConstructorKey: 'dialog'
});

const confirm = await newComponent('ui-overlay', {
    name: 'Confirm',
    htmlConstructorKey: 'dialog'
});
```

---

## Performance Notes

- UI Overlays don't allocate during update loops
- Event listeners are managed automatically
- HTML construction happens once (cached via `_htmlConstructed`)
- Use CSS transforms for animations (hardware accelerated)

---

## Serialization

UI Overlays serialize their configuration but not HTML content:

```json
{
    "type": "ui-overlay",
    "name": "Main Menu",
    "cssOverrides": { "backgroundColor": "black" },
    "htmlConstructorKey": "mainMenu",
    "bindings": [
        {
            "selector": "#start",
            "onActions": ["click"],
            "methodKey": "startGame"
        }
    ],
    "previousOverlayId": 5
}
```

**Note:** Binding callbacks and HTML constructors must be re-registered after deserialization.

---

## Next Steps

- Learn about [Data Layer](data-layer.md) for storing UI state
- Explore [Messenger](messenger.md) for UI-to-game communication
- See [Component System](../component-system.md) for custom components

---

**Source:** [src/component/ui-overlay](../../src/component/ui-overlay/)
