# Getting Started with Omosuen

This guide will walk you through creating your first Omosuen project.

---

## Installation

### From npm (when published)

```bash
npm install omosuen
```

### From Source

```bash
git clone https://github.com/yourusername/omosuen.git
cd omosuen
npm install
npm run build
```

---

## Your First Project

### 1. Basic HTML Setup

Create an `index.html` file:

```html
<!DOCTYPE html>
<html>
<head>
    <title>My Omosuen Game</title>
</head>
<body>
    <script src="path/to/omosuen.js"></script>
    <script src="game.js"></script>
</body>
</html>
```

### 2. Create a Simple Scene

Create a `game.js` file:

```javascript
// Omosuen is automatically available on window when using the UMD bundle
const { newComponent, registerScene, switchScene, start } = Omosuen;

async function init() {
    // Create the root scene nexus
    const scene = await newComponent('nexus', { name: 'Main Scene' });

    // Create a player entity
    const player = await newComponent('nexus', { name: 'Player' });

    // Add player to scene
    scene.addComponent(player);

    // Register the scene
    registerScene('main', scene);

    // Switch to the scene
    await switchScene('main');

    // Start the game loop at 60 FPS
    start(60);

    console.log('Game started!');
}

// Start the game when page loads
init();
```

### 3. Run Your Game

Open `index.html` in a browser, open the developer console, and you should see "Game started!".

---

## Basic Workflow

### 1. Component Creation

Components are created using `newComponent()`:

```javascript
const component = await newComponent(type, options);
```

All components require:
- `type`: The component type (e.g., `'nexus'`, `'messenger'`)
- `options.name`: A human-readable name

```javascript
const player = await newComponent('nexus', { name: 'Player' });
const enemy = await newComponent('nexus', { name: 'Goblin' });
```

### 2. Building Hierarchies

Use Nexus components as containers:

```javascript
const scene = await newComponent('nexus', { name: 'Level 1' });
const player = await newComponent('nexus', { name: 'Player' });
const enemies = await newComponent('nexus', { name: 'Enemies' });

// Add to scene
scene.addComponent(player);
scene.addComponent(enemies);

// Add multiple enemies
for (let i = 0; i < 5; i++) {
    const enemy = await newComponent('nexus', { name: `Enemy ${i}` });
    enemies.addComponent(enemy);
}
```

### 3. Finding Components

Nexus provides methods to search the hierarchy:

```javascript
// Find by name
const player = scene.getComponentByName('Player');

// Find by type
const messenger = scene.getComponentByType('messenger');

// Find recursively (searches children too)
const enemy = scene.getComponentByName('Enemy 3', true);

// Get all of a type
const allEnemies = enemies.getComponentsByName('Enemy', true);
```

### 4. Scene Management

```javascript
// Register scenes
registerScene('menu', menuScene);
registerScene('level1', level1Scene);
registerScene('level2', level2Scene);

// Switch between scenes
await switchScene('menu');

// Later...
await switchScene('level1');

// Get current scene
const current = getActiveScene();
console.log(current.name); // "level1"
```

### 5. Game Loop

```javascript
// Start the loop
start(60); // 60 FPS target

// Pause/resume
pause();  // Stop calling component update() methods
resume(); // Resume updates

// Stop completely
stop();

// Check status
if (isRunning()) {
    console.log(`Running at ${getFPS()} FPS`);
}
```

---

## Component Lifecycle

Every component has three lifecycle hooks:

### init()

Called once when the component is added to a scene. Runs progressively (time-budgeted across frames):

```javascript
init: (component) => {
    console.log(`${component.name} initialized`);
    // Setup logic here
}
```

### update(deltaTime)

Called every frame while the game loop is running:

```javascript
update: (component, deltaTime) => {
    // deltaTime is in milliseconds
    // Move 100 pixels per second
    component.x += 100 * (deltaTime / 1000);
}
```

### dispose()

Called when the component is removed or the scene unloads:

```javascript
dispose: (component) => {
    console.log(`${component.name} disposed`);
    // Cleanup logic here
}
```

---

## Next Steps

- Read [Architecture](architecture.md) to understand Omosuen's design
- Learn about [Component System](component-system.md) to create custom components
- Explore [Built-in Components](../README.md#built-in-components) for available functionality
- Check out [Math Library](../README.md#math-library) for vectors and arrays

---

## Common Patterns

### Loading Scene from Module

```javascript
// scene.js
export async function createScene() {
    const scene = await Omosuen.newComponent('nexus', { name: 'Level 1' });
    // ... build scene ...
    return scene;
}

// game.js
registerSceneModule('level1', './scene.js');
await switchScene('level1');
```

### Progressive Loading with Loader Flag

```javascript
const loadingUI = await newComponent('ui-overlay', {
    name: 'Loading Screen',
    loader: true  // Updates even during init phase
});

scene.addComponent(loadingUI);
```

### Component Communication

```javascript
// Direct reference
const player = scene.getComponentByName('Player');
player.health = 100;

// Messaging system
const messenger = await newComponent('messenger', { name: 'EventBus' });
scene.addComponent(messenger);

// Send messages between components
messenger.send('player:damage', { amount: 10 });
```

---

**Need Help?** Check the [API Reference](api-reference.md) or review [CLAUDE.md](../CLAUDE.md) for development guidelines.
