# Game Loop

Understanding the game loop system and component lifecycle in Omosuen.

---

## Overview

The game loop is the heart of Omosuen, running continuously to update, render, and manage all game components. It uses `requestAnimationFrame` for smooth, browser-optimized performance.

---

## Loop Phases

Each frame executes these phases in order:

```
1. Calculate Delta Time & FPS
2. Process Init Queue (progressive)
3. Update Components (respects pause)
4. Process Dispose Queue (batched)
5. Render Scene (stub)
6. Poll Messages (messenger system)
7. Poll Flags (flag system)
```

### Phase Details

#### 1. Calculate Delta Time & FPS

```typescript
deltaTime = currentTime - lastFrameTime;
currentFPS = 1000 / deltaTime;
```

- **Delta time** is uncapped (reflects actual elapsed time)
- **FPS** is instantaneous (not averaged)
- Use delta time for frame-rate independent behavior

#### 2. Process Init Queue

Components are initialized progressively with a time budget:

```typescript
const targetFrameTime = 1000 / targetFPS;  // e.g., 16.67ms for 60fps
processInitQueue(activeScene, targetFrameTime);
```

- Each frame gets a portion of the frame time for initialization
- Prevents frame drops during scene loading
- Components with `loader: true` update during this phase

#### 3. Update Components

Recursively updates all components in the scene hierarchy:

```typescript
if (!loopPaused) {
    updateScene(activeScene, deltaTime);
}
```

- Calls `update(component, deltaTime)` for each component
- Skipped if loop is paused
- Components with `loader: true` skip updates after init completes

#### 4. Process Dispose Queue

Batched cleanup of disposed components:

```typescript
processDisposeQueue(activeScene);
```

- Calls `dispose(component)` for queued components
- Removes disposed components from parent Nexus
- Batched for efficiency

#### 5. Render Scene (Stub)

Placeholder for rendering logic:

```typescript
renderScene(activeScene);
```

Currently a stub. Extend for your rendering needs.

#### 6. Poll Messages

Processes the global message queue:

```typescript
pollMessages();
```

Dispatches messages to registered messenger listeners.

#### 7. Poll Flags

Processes flag state changes:

```typescript
pollFlags();
```

Handles flag-manager updates.

---

## Loop Control

### Start the Loop

```typescript
import { start } from 'omosuen';

// Load a scene first
await switchScene('main');

// Start at 60 FPS
start(60);
```

**Parameters:**
- `fps` (default: 60) - Target frames per second

**Notes:**
- Must have a scene loaded first
- Can only start once (warns if already running)
- Resets delta time and frame counters

### Stop the Loop

```typescript
import { stop } from 'omosuen';

stop();
```

**Effect:**
- Cancels `requestAnimationFrame`
- Resets loop state
- Does NOT dispose the scene

**Use when:**
- Shutting down the game
- Completely halting execution

### Pause Updates

```typescript
import { pause } from 'omosuen';

pause();
```

**Effect:**
- Loop continues running
- Component `update()` methods are NOT called
- Init, dispose, render, messaging still occur

**Use when:**
- Pause menu
- Modal dialogs
- Game paused state

### Resume Updates

```typescript
import { resume } from 'omosuen';

resume();
```

**Effect:**
- Resumes calling component `update()` methods
- Delta time continues accumulating during pause

---

## Loop Status

### Check if Running

```typescript
import { isRunning } from 'omosuen';

if (!isRunning()) {
    start(60);
}
```

### Check if Paused

```typescript
import { isPaused } from 'omosuen';

if (isPaused()) {
    resume();
}
```

### Get Frame Time

```typescript
import { getFrameTime } from 'omosuen';

const deltaTime = getFrameTime();
console.log(`Last frame: ${deltaTime.toFixed(2)}ms`);
```

### Get Current FPS

```typescript
import { getFPS } from 'omosuen';

const fps = getFPS();
console.log(`Running at ${fps.toFixed(1)} FPS`);
```

### Get Target FPS

```typescript
import { getTargetFPS } from 'omosuen';

const target = getTargetFPS();
console.log(`Target: ${target} FPS`);
```

---

## Delta Time Usage

Delta time makes movement frame-rate independent:

### Without Delta Time (WRONG)

```typescript
update: (component, deltaTime) => {
    // Moves 5 pixels per frame
    // Fast at 60fps, slow at 30fps
    component.x += 5;
}
```

### With Delta Time (CORRECT)

```typescript
update: (component, deltaTime) => {
    // Moves 300 pixels per second
    // Same speed at any frame rate
    component.x += 300 * (deltaTime / 1000);
}
```

### Common Pattern

```typescript
update: (component, deltaTime) => {
    const dt = deltaTime / 1000;  // Convert to seconds

    // Movement: 100 units/second
    component.position.x += component.velocity.x * dt;
    component.position.y += component.velocity.y * dt;

    // Rotation: 45 degrees/second
    component.rotation += 45 * dt;

    // Timer countdown
    component.timer -= dt;
    if (component.timer <= 0) {
        component.trigger();
    }
}
```

---

## Progressive Initialization

Components don't initialize immediately. Instead, they're added to a queue and initialized progressively.

### How It Works

1. `newComponent()` creates component and calls `queueInit(id)`
2. Each frame, `processInitQueue()` initializes components until time budget is exhausted
3. Initialization continues across frames until queue is empty

### Time Budget

```typescript
// For 60 FPS target:
const targetFrameTime = 1000 / 60;  // 16.67ms

// Budget allocation (example):
// - 8ms for init
// - 8ms for update/render/other
```

### Loader Components

Components with `loader: true` update during initialization:

```typescript
const loadingUI = await newComponent('ui-overlay', {
    name: 'Loading Screen',
    loader: true  // Updates even during init phase
});
```

**Use cases:**
- Loading screens
- Progress bars
- Loading animations

### Init Queue Management

```typescript
// Get queue size
const size = getInitQueueSize();
console.log(`${size} components waiting to initialize`);

// Get queue length (alias)
const length = getInitQueueLength();

// Check if initializing
if (isInitializing()) {
    console.log('Components still initializing...');
}

// Clear queue (rarely needed)
clearInitQueue();
```

---

## Disposal System

Components can be disposed (removed) during the game loop.

### Queue for Disposal

```typescript
import { queueDispose } from 'omosuen';

// Queue by ID
queueDispose(component.id);
```

### Mark for Disposal

```typescript
import { markForDisposal } from 'omosuen';

// Mark component
markForDisposal(component);

// Component.dispose() will be called next frame
```

### Direct Disposal

```typescript
// Call dispose directly (immediate)
component.dispose();
```

### Disposal Queue Management

```typescript
import { getDisposeQueueSize, clearDisposeQueue } from 'omosuen';

// Get queue size
const size = getDisposeQueueSize();
console.log(`${size} components queued for disposal`);

// Clear queue (rarely needed)
clearDisposeQueue();
```

---

## Update System

### Update Flow

```
updateScene(rootNexus, deltaTime)
    │
    ├─► For each component in rootNexus.components:
    │       │
    │       ├─► Skip if component._disposed
    │       │
    │       ├─► Skip if component.loader && scene._initialized
    │       │
    │       ├─► Get update method:
    │       │       │
    │       │       ├─► Use component.updateOverride if set
    │       │       └─► Otherwise use default update()
    │       │
    │       ├─► Call update(component, deltaTime)
    │       │
    │       └─► If component is Nexus:
    │               └─► Recursively updateScene(component, deltaTime)
    │
    └─► Return
```

### Update Override

Components can use custom update methods:

```typescript
// Create with custom update method name
const component = await newComponent('my-component', {
    name: 'Special',
    updateOverride: 'customUpdate'
});

// Component methods
const MyComponentMethods = {
    update: (component, deltaTime) => {
        // Default update
    },

    customUpdate: (component, deltaTime) => {
        // Custom update logic
    }
};
```

### Override Key

Share update logic across components:

```typescript
// Both use same update logic
const enemy1 = await newComponent('enemy', {
    name: 'Goblin',
    overrideKey: 'melee-ai'
});

const enemy2 = await newComponent('enemy', {
    name: 'Skeleton',
    overrideKey: 'melee-ai'
});

// Both dispatch to same update method
```

---

## Performance Optimization

### 1. Zero Allocations in Update

```typescript
// BAD - Allocates every frame
update: (component, deltaTime) => {
    const results = [];  // New array every frame
    const temp = new Vector3D(0, 0, 0);  // New vector every frame
}

// GOOD - Use module-level pools
const TEMP_RESULTS = [];
const TEMP_VECTOR = new Vector3D(0, 0, 0);

update: (component, deltaTime) => {
    TEMP_RESULTS.length = 0;  // Reuse array
    // ... use TEMP_RESULTS ...
}
```

### 2. Batch Operations

```typescript
// BAD - Multiple tree traversals
update: (component, deltaTime) => {
    for (let id of enemyIds) {
        const enemy = scene.getComponentById(id, true);
        enemy.update();
    }
}

// GOOD - Single traversal
update: (component, deltaTime) => {
    const enemies = scene.getComponentsByType('enemy', true);
    enemies.forEach(enemy => enemy.update());
}
```

### 3. Early Exit

```typescript
update: (component, deltaTime) => {
    // Skip if not active
    if (!component.active) return;

    // Skip if off-screen
    if (!component.isVisible()) return;

    // Expensive logic here
    // ...
}
```

### 4. Update Frequency

```typescript
// Update every N frames for expensive logic
update: (component, deltaTime) => {
    component.frameCounter = (component.frameCounter || 0) + 1;

    // Cheap logic every frame
    component.animate(deltaTime);

    // Expensive logic every 10 frames
    if (component.frameCounter % 10 === 0) {
        component.pathfind();
    }
}
```

---

## Common Patterns

### Pause Menu

```typescript
// Show pause menu
async function showPauseMenu() {
    pause();
    const pauseUI = await newComponent('ui-overlay', {
        name: 'Pause Menu',
        loader: true  // Updates while paused
    });
    getActiveScene().addComponent(pauseUI);
}

// Hide pause menu
function hidePauseMenu() {
    const pauseUI = getActiveScene().getComponentByName('Pause Menu');
    if (pauseUI) {
        pauseUI.dispose();
    }
    resume();
}
```

### Loading Screen

```typescript
async function loadLevel(levelName) {
    const scene = await newComponent('nexus', { name: levelName });

    // Add loading UI
    const loading = await newComponent('ui-overlay', {
        name: 'Loading',
        loader: true
    });
    scene.addComponent(loading);

    // Add heavy entities
    for (let i = 0; i < 1000; i++) {
        const entity = await newComponent('nexus', { name: `Entity ${i}` });
        scene.addComponent(entity);
    }

    // Switch scene
    registerScene(levelName, scene);
    await switchScene(levelName);
    start(60);

    // Loading UI stays visible during progressive init
    // Remove it when init completes
    loading.dispose();
}
```

### FPS Counter

```typescript
const FPSCounter = {
    type: 'fps-counter',

    update: (component, deltaTime) => {
        const fps = getFPS();
        component.htmlElement.textContent = `FPS: ${fps.toFixed(1)}`;
    }
};
```

### Time Scaling

```typescript
let timeScale = 1.0;

update: (component, deltaTime) => {
    const scaledDelta = deltaTime * timeScale;

    // Use scaled delta for gameplay
    component.position.x += component.velocity.x * (scaledDelta / 1000);
}

// Slow motion
timeScale = 0.5;

// Bullet time
timeScale = 0.1;

// Fast forward
timeScale = 2.0;
```

---

## Debugging

### Log Frame Times

```typescript
let frameCount = 0;
let totalTime = 0;

const DebugLoop = {
    update: (component, deltaTime) => {
        frameCount++;
        totalTime += deltaTime;

        if (frameCount % 60 === 0) {
            const avgTime = totalTime / 60;
            console.log(`Avg frame time: ${avgTime.toFixed(2)}ms`);
            totalTime = 0;
        }
    }
};
```

### Detect Frame Drops

```typescript
const FrameDropDetector = {
    update: (component, deltaTime) => {
        const targetFrameTime = 1000 / getTargetFPS();

        if (deltaTime > targetFrameTime * 2) {
            console.warn(`Frame drop: ${deltaTime.toFixed(2)}ms`);
        }
    }
};
```

### Profile Updates

```typescript
update: (component, deltaTime) => {
    const startTime = performance.now();

    // Your update logic
    heavyComputation();

    const elapsed = performance.now() - startTime;
    if (elapsed > 5) {
        console.warn(`Slow update: ${elapsed.toFixed(2)}ms`);
    }
}
```

---

## Best Practices

### 1. Always Use Delta Time

```typescript
// Multiply time-based values by deltaTime
component.x += velocity * (deltaTime / 1000);
```

### 2. Avoid Allocations in Update

```typescript
// Use module-level pools for temporary data
const TEMP_ARRAY = [];
```

### 3. Batch Component Queries

```typescript
// Query once, iterate many
const enemies = scene.getComponentsByType('enemy', true);
enemies.forEach(e => e.update());
```

### 4. Use Loader Flag for Loading UI

```typescript
// Loading UI updates during init
const loading = await newComponent('ui-overlay', {
    name: 'Loading',
    loader: true
});
```

### 5. Dispose Resources Properly

```typescript
dispose: (component) => {
    // Clean up module-level pools
    POOL.length = 0;

    // Remove event listeners
    window.removeEventListener('resize', component.handleResize);
}
```

---

## Next Steps

- Learn about [Component System](component-system.md) for update implementation
- Explore [Scenes](scenes.md) for scene lifecycle
- Check [Architecture](architecture.md) for performance patterns

---

**Need Help?** Review the source code in `src/loop/` for implementation details.
