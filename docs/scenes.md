# Scene Management

Learn how to create, load, and manage scenes in Omosuen.

---

## Overview

Scenes in Omosuen are simply **root-level Nexus components** that contain your game entities and systems. The scene management system provides registration, loading, and serialization capabilities.

---

## What is a Scene?

A scene is a Nexus component that serves as the root of your game hierarchy:

```typescript
const scene = await newComponent('nexus', { name: 'Level 1' });

// Add entities to the scene
const player = await newComponent('nexus', { name: 'Player' });
const enemies = await newComponent('nexus', { name: 'Enemies' });

scene.addComponent(player);
scene.addComponent(enemies);
```

**Key Points:**
- Scenes are just Nexus components
- One scene is "active" at a time
- Switching scenes disposes the old scene and loads the new one
- Scenes can be loaded from memory, modules, or serialized files

---

## Scene Registration

Before a scene can be loaded, it must be registered:

### 1. Register from Memory

```typescript
// Create scene in code
const menuScene = await newComponent('nexus', { name: 'Main Menu' });
// ... build scene ...

// Register it
registerScene('menu', menuScene);
```

### 2. Register from Module

```typescript
// Register a JavaScript module path
registerSceneModule('level1', './scenes/level1.js');

// The module must export one of:
// - Default export: nexus component
// - Default export: function returning nexus
// - Named export: createScene() function
```

**Module Example (scenes/level1.js):**

```javascript
import { newComponent } from 'omosuen';

export async function createScene() {
    const scene = await newComponent('nexus', { name: 'Level 1' });

    // Build scene
    const player = await newComponent('nexus', { name: 'Player' });
    scene.addComponent(player);

    return scene;
}
```

### 3. Register from Serialized File

```typescript
// Register a JSON file path
registerSceneSerialized('level2', './scenes/level2.json');

// The JSON file contains serialized scene data
```

---

## Scene Loading

### Switch Scenes

The primary way to change scenes:

```typescript
// Unloads current scene, loads new scene
await switchScene('level1');

// Returns the loaded scene
const scene = await switchScene('menu');
if (scene) {
    console.log(`Switched to ${scene.name}`);
}
```

**Switching process:**
1. Disposes current active scene (if any)
2. Loads new scene from registry
3. Sets new scene as active
4. Components are queued for initialization

### Load Without Switching

```typescript
// Load a scene without making it active
const scene = await loadScene('level1');

// Later, make it active manually
unloadScene();  // Unload current
registerScene('current', scene);
await switchScene('current');
```

### Get Active Scene

```typescript
const current = getActiveScene();
if (current) {
    console.log(`Active scene: ${current.name}`);
} else {
    console.log('No scene loaded');
}
```

### Unload Scene

```typescript
// Dispose current scene without loading a new one
unloadScene();
```

---

## Scene Lifecycle

### Scene Loading Flow

```
registerScene()
     │
     ▼
switchScene()
     │
     ├─► unloadScene() [if scene is active]
     │        └─► scene.dispose()
     │
     ├─► loadScene()
     │        ├─► Load from memory
     │        ├─► Load from module (dynamic import)
     │        └─► Load from file (fetch + deserialize)
     │
     ├─► setActiveScene()
     └─► Queue all components for init
              │
              ▼
         Game loop calls processInitQueue()
              │
              ▼
         Components initialized progressively
```

### Component Initialization

After scene loading, components are initialized progressively:

- Each frame gets a **time budget** based on target FPS
- Components are initialized until budget is exhausted
- Initialization continues across multiple frames if needed
- Components with `loader: true` update during initialization

**Example:**

```typescript
// Scene with 1000 entities
const scene = await newComponent('nexus', { name: 'Big Level' });

for (let i = 0; i < 1000; i++) {
    const entity = await newComponent('nexus', { name: `Entity ${i}` });
    scene.addComponent(entity);
}

// Load the scene
await switchScene('big-level');

// start() begins game loop
start(60);

// Entities initialize progressively over several frames
// No single-frame spike
```

---

## Serialization

Scenes can be saved to and loaded from JSON:

### Serialize a Scene

```typescript
import { serializeComponentRecursive } from 'omosuen';

const scene = getActiveScene();
if (scene) {
    // Convert scene hierarchy to JSON-compatible object
    const data = serializeComponentRecursive(scene);

    // Save to file/server
    const json = JSON.stringify(data, null, 2);
    // ... write to file or send to server ...
}
```

### Deserialize a Scene

```typescript
import { deserializeComponentRecursive } from 'omosuen';

// Load JSON data
const response = await fetch('./scenes/level1.json');
const data = await response.json();

// Reconstruct scene hierarchy
const scene = deserializeComponentRecursive(data);

if (scene && scene.type === 'nexus') {
    registerScene('level1', scene);
    await switchScene('level1');
}
```

### What Gets Serialized?

**Included:**
- Component type and name
- Component ID
- All component data fields
- Child component hierarchy (recursive)
- Component options (overrideKey, updateOverride, loader)

**Excluded:**
- Methods (loaded from registry)
- Parent references (reconstructed during deserialization)
- Disposed components (`_disposed: true`)
- Transient runtime state

### Serialization Format

```json
{
    "type": "nexus",
    "name": "Level 1",
    "id": 0,
    "components": [
        {
            "type": "nexus",
            "name": "Player",
            "id": 1,
            "components": [
                {
                    "type": "data-layer",
                    "name": "Health",
                    "id": 2,
                    "dataType": "number",
                    "data": 100
                }
            ]
        },
        {
            "type": "messenger",
            "name": "Events",
            "id": 3
        }
    ]
}
```

---

## Scene Organization Patterns

### 1. Hub-Based Organization

```typescript
// Main menu hub
const menu = await newComponent('nexus', { name: 'Main Menu' });
registerScene('menu', menu);

// Level hub with sub-scenes
const levelSelect = await newComponent('nexus', { name: 'Level Select' });
registerScene('level-select', levelSelect);

// Individual levels
for (let i = 1; i <= 10; i++) {
    registerSceneModule(`level${i}`, `./scenes/level${i}.js`);
}

// Flow: menu -> level-select -> level1 -> level2 -> ...
```

### 2. Persistent Data Across Scenes

```typescript
// Singleton data (survives scene switches)
let persistentData = {
    playerStats: { level: 1, xp: 0 },
    inventory: [],
    flags: {}
};

// Recreate in each scene
async function createScene(name) {
    const scene = await newComponent('nexus', { name });

    const player = await newComponent('nexus', { name: 'Player' });

    // Restore persistent data
    const stats = await newComponent('data-layer', { name: 'Stats' });
    stats.data = persistentData.playerStats;

    player.addComponent(stats);
    scene.addComponent(player);

    return scene;
}
```

### 3. Procedural Scene Generation

```typescript
async function generateDungeon(seed) {
    const scene = await newComponent('nexus', { name: `Dungeon ${seed}` });

    // Procedurally generate rooms
    for (let i = 0; i < 10; i++) {
        const room = await createRoom(seed + i);
        scene.addComponent(room);
    }

    return scene;
}

// Register dynamically
const dungeon = await generateDungeon(12345);
registerScene('dungeon', dungeon);
await switchScene('dungeon');
```

---

## Scene Utilities

### Check if Scene Exists

```typescript
if (hasScene('level1')) {
    await switchScene('level1');
} else {
    console.error('Scene not registered!');
}
```

### List All Scenes

```typescript
const scenes = listScenes();
console.log('Available scenes:', scenes);
// ['menu', 'level1', 'level2', ...]
```

### Unregister Scene

```typescript
// Remove scene from registry
unregisterScene('old-level');

// Can't load it anymore
await switchScene('old-level'); // Error
```

---

## Loading Strategies

### Preload All Scenes

```typescript
// Load all scenes at startup
async function preloadScenes() {
    registerSceneModule('menu', './scenes/menu.js');
    registerSceneModule('level1', './scenes/level1.js');
    registerSceneModule('level2', './scenes/level2.js');

    // Modules loaded lazily when switched to
}
```

### Lazy Load on Demand

```typescript
// Register scene just before loading
async function loadLevel(levelNum) {
    registerSceneModule(`level${levelNum}`, `./scenes/level${levelNum}.js`);
    await switchScene(`level${levelNum}`);
}
```

### Mixed Strategy

```typescript
// Preload critical scenes, lazy load others
registerScene('menu', menuScene);  // Preloaded
registerSceneModule('level1', './scenes/level1.js');  // Lazy

// Later
await switchScene('menu');  // Instant
await switchScene('level1');  // Loads module first
```

---

## Best Practices

### 1. Scene Naming Conventions

```typescript
// Use descriptive, hierarchical names
registerScene('menu:main', mainMenu);
registerScene('menu:options', optionsMenu);
registerScene('game:level1', level1);
registerScene('game:level2', level2);
```

### 2. Cleanup Resources

```typescript
// Use dispose() to clean up scene-specific resources
const MyComponentMethods = {
    dispose: (component) => {
        // Release WebGL resources
        // Cancel pending network requests
        // Remove global event listeners
    }
};
```

### 3. Error Handling

```typescript
const scene = await switchScene('level1');
if (!scene) {
    console.error('Failed to load scene, falling back to menu');
    await switchScene('menu');
}
```

### 4. Loading Screens

```typescript
// Create loading UI with loader flag
const loadingScreen = await newComponent('ui-overlay', {
    name: 'Loading',
    loader: true  // Updates during init
});

scene.addComponent(loadingScreen);
```

### 5. Scene Validation

```typescript
// Validate scene before saving
function validateScene(scene) {
    if (!scene || scene.type !== 'nexus') {
        console.error('Invalid scene: must be a nexus');
        return false;
    }

    // Check for required components
    const player = scene.getComponentByName('Player');
    if (!player) {
        console.error('Scene missing player');
        return false;
    }

    return true;
}
```

---

## Common Patterns

### Scene Transitions

```typescript
async function transitionToScene(newScene, effect = 'fade') {
    // Fade out
    await playTransitionEffect(effect, 'out');

    // Switch scene
    await switchScene(newScene);

    // Fade in
    await playTransitionEffect(effect, 'in');
}
```

### Scene Checkpoints

```typescript
// Save scene state at checkpoint
const checkpointData = serializeComponentRecursive(getActiveScene());
localStorage.setItem('checkpoint', JSON.stringify(checkpointData));

// Load from checkpoint
const data = JSON.parse(localStorage.getItem('checkpoint'));
const scene = deserializeComponentRecursive(data);
registerScene('checkpoint', scene);
await switchScene('checkpoint');
```

### Scene Preloading UI

```typescript
async function preloadWithProgress(scenes) {
    for (let i = 0; i < scenes.length; i++) {
        const progress = (i + 1) / scenes.length;
        updateLoadingBar(progress);

        await loadScene(scenes[i]);
    }
}
```

---

## Next Steps

- Learn about [Component System](component-system.md) for building scene contents
- Understand [Game Loop](game-loop.md) for scene updates
- Explore [Built-in Components](../README.md#built-in-components) for scene features

---

**Need Help?** Check the source code in `src/scene/` for implementation details.
