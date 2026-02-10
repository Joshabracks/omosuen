# API Reference

Quick reference for Omosuen's main exports and functions.

---

## Core Engine

### Version and Info

```typescript
import { version, name, init } from 'omosuen';

// Engine version
version: string  // "0.1.0"

// Engine name
name: string  // "Omosuen"

// Initialize engine (logs to console)
init(): void
```

---

## Component System

### Component Creation

```typescript
import { newComponent } from 'omosuen';

// Create a component
newComponent(
    type: COMPONENT_TYPE,
    options: ComponentOptions
): Promise<ComponentData | null>

// Component types
type COMPONENT_TYPE =
    | 'nexus'
    | 'ui-overlay'
    | 'data-layer'
    | 'flag-manager'
    | 'messenger';

// Component options
interface ComponentOptions {
    name: string;              // REQUIRED: Human-readable name
    overrideKey?: string;      // Optional: Custom dispatch key
    updateOverride?: string;   // Optional: Custom update method name
}
```

### Component Data

```typescript
interface ComponentData {
    name: string;              // Human-readable name
    type: COMPONENT_TYPE;      // Component type
    id?: number;               // Unique ID (auto-assigned)
    parent: ComponentData | null;  // Parent component
    _disposed?: boolean;       // Disposal flag
    loader?: boolean;          // Updates during init phase
    unique?: ComponentUnique;  // Uniqueness constraint
    overrideKey?: string;      // Custom dispatch key
    updateOverride?: string;   // Custom update method
    _initialized?: boolean;    // Initialization flag
}

enum ComponentUnique {
    FALSE = 0,  // Multiple instances allowed
    LOCAL = 1,  // One per parent Nexus
    GLOBAL = 2, // One per entire scene
}
```

### Component Registry

```typescript
import { resetComponentCount, setComponentCount } from 'omosuen';

// Reset component ID counter (used during scene loading)
resetComponentCount(): void

// Set component ID counter
setComponentCount(count: number): void
```

---

## Scene Management

### Scene Registration

```typescript
import {
    registerScene,
    registerSceneModule,
    registerSceneSerialized,
    hasScene,
    listScenes,
    unregisterScene
} from 'omosuen';

// Register scene from memory (pre-built nexus)
registerScene(name: string, scene: NexusT): void

// Register scene from JavaScript module
registerSceneModule(name: string, modulePath: string): void

// Register scene from serialized JSON file
registerSceneSerialized(name: string, filePath: string): void

// Check if scene exists
hasScene(name: string): boolean

// List all registered scenes
listScenes(): string[]

// Unregister scene
unregisterScene(name: string): void
```

### Scene Loading

```typescript
import {
    loadScene,
    unloadScene,
    switchScene,
    getActiveScene
} from 'omosuen';

// Load a scene (doesn't set as active)
loadScene(name: string): Promise<NexusT | null>

// Unload current active scene
unloadScene(): void

// Switch to a different scene (unloads current, loads new)
switchScene(name: string): Promise<NexusT | null>

// Get currently active scene
getActiveScene(): NexusT | null
```

### Scene Serialization

```typescript
import {
    serializeComponentRecursive,
    deserializeComponentRecursive
} from 'omosuen';

// Serialize component hierarchy to JSON-compatible object
serializeComponentRecursive(component: ComponentData): any

// Deserialize component hierarchy from JSON data
deserializeComponentRecursive(
    data: any,
    maxId?: { value: number }
): ComponentData | null
```

---

## Game Loop

### Loop Control

```typescript
import { start, stop, pause, resume } from 'omosuen';

// Start the game loop
start(targetFPS?: number): void  // Default: 60

// Stop the game loop completely
stop(): void

// Pause component updates (loop continues)
pause(): void

// Resume component updates
resume(): void
```

### Loop Status

```typescript
import {
    isRunning,
    isPaused,
    getFrameTime,
    getFPS,
    getTargetFPS
} from 'omosuen';

// Check if loop is running
isRunning(): boolean

// Check if updates are paused
isPaused(): boolean

// Get delta time from last frame (milliseconds)
getFrameTime(): number

// Get current FPS (instantaneous)
getFPS(): number

// Get target FPS
getTargetFPS(): number
```

### Initialization System

```typescript
import {
    queueInit,
    processInitQueue,
    isInitializing,
    clearInitQueue,
    getInitQueueSize,
    getInitQueueLength
} from 'omosuen';

// Queue component for initialization
queueInit(id: number): void

// Process init queue (called by game loop)
processInitQueue(scene: NexusT, targetFrameTime: number): void

// Check if components are initializing
isInitializing(): boolean

// Clear init queue
clearInitQueue(): void

// Get init queue size
getInitQueueSize(): number
getInitQueueLength(): number  // Alias
```

### Disposal System

```typescript
import {
    queueDispose,
    markForDisposal,
    processDisposeQueue,
    clearDisposeQueue,
    getDisposeQueueSize
} from 'omosuen';

// Queue component for disposal by ID
queueDispose(id: number): void

// Mark component for disposal
markForDisposal(component: ComponentData): void

// Process dispose queue (called by game loop)
processDisposeQueue(scene: NexusT): void

// Clear dispose queue
clearDisposeQueue(): void

// Get dispose queue size
getDisposeQueueSize(): number
```

### Update System

```typescript
import { updateScene } from 'omosuen';

// Update all components in scene hierarchy
updateScene(scene: NexusT, deltaTime: number): void
```

### Render/Messaging/Flags (Stubs)

```typescript
import { renderScene, pollMessages, pollFlags } from 'omosuen';

// Render scene (stub)
renderScene(scene: NexusT): void

// Poll message queue (stub)
pollMessages(): void

// Poll flag changes (stub)
pollFlags(): void
```

---

## Nexus Component

```typescript
interface NexusT extends ComponentData {
    type: 'nexus';
    components: ComponentData[];
}

// Nexus methods (available via Proxy)
nexus.addComponent(component: ComponentData): void
nexus.addComponents(components: ComponentData[] | Record<string, ComponentData>): void

nexus.getComponentById(id: number, recursive?: boolean): ComponentData | null
nexus.getComponentByType(type: string, recursive?: boolean): ComponentData | null
nexus.getComponentsByType(type: string, recursive?: boolean): ComponentData[]
nexus.getComponentByName(name: string, recursive?: boolean): ComponentData | null
nexus.getComponentsByName(name: string, recursive?: boolean): ComponentData[]
nexus.getComponentByTypeAndName(type: string, name: string, recursive?: boolean): ComponentData | null
nexus.getComponentsByTypeAndName(type: string, name: string, recursive?: boolean): ComponentData[]

nexus.dispose(): void
```

---

## Messenger Component

```typescript
import { ALL_MESSAGES, ANY_MESSAGES } from 'omosuen';

// Message pattern symbols
ALL_MESSAGES: symbol   // Receive all messages
ANY_MESSAGES: symbol   // Receive messages matching filters

// Message types
interface MessageEnvelope {
    message: string;           // Message identifier
    sender: ComponentData;     // Sender messenger
    receiver: ComponentData;   // Matched receiver
    messenger: ComponentData;  // Handler messenger
    body: MessageBody;         // Payload data
    receiverOptions?: MessageReceiverOptions;
}

type MessageBody = Record<string, unknown>;

interface MessageReceiverOptions {
    mode: 'match-any' | 'match-all' | 'broadcast';
    names?: string[];
    types?: COMPONENT_TYPE[];
    ids?: number[];
}

interface ListenerConfig {
    pattern: string | RegExp | typeof ALL_MESSAGES | typeof ANY_MESSAGES;
    callbackKey: string;
}

type MessageCallback = (envelope: MessageEnvelope) => void;

// Messenger methods (implementation in progress)
// See docs/components/messenger.md for details
```

---

## Math Library

### Vector Classes

```typescript
import { Vector2D, Vector3D, Vector4D } from 'omosuen';

// Vector2D
class Vector2D {
    constructor(x: number, y: number)
    normalize(): Vector2D
    add(other: Vector2D): Vector2D
    subtract(other: Vector2D): Vector2D
    multiply(scalar: number): Vector2D
    divide(scalar: number): Vector2D
    rotate(degrees: number): Vector2D
    angleRadians(): number
}

// Vector3D
class Vector3D {
    constructor(x: number, y: number, z: number)
    normalize(): Vector3D
    add(other: Vector3D): Vector3D
    subtract(other: Vector3D): Vector3D
    multiply(scalar: number): Vector3D
    divide(scalar: number): Vector3D

    // Color getters
    get r(): number  // Alias for x
    get g(): number  // Alias for y
    get b(): number  // Alias for z
}

// Vector4D
class Vector4D {
    constructor(x: number, y: number, z: number, w: number)
    normalize(): Vector4D
    add(other: Vector4D): Vector4D
    subtract(other: Vector4D): Vector4D
    multiply(scalar: number): Vector4D
    divide(scalar: number): Vector4D
    toString(): string

    // Color getters
    get r(): number  // Alias for x
    get g(): number  // Alias for y
    get b(): number  // Alias for z
    get a(): number  // Alias for w
}
```

### Array Classes

```typescript
import { Array2D, Array3D, Array3Dc, Array3Di } from 'omosuen';

// Array2D<T>
class Array2D<T> {
    constructor(size: Vector2D, defaultValue?: T)
    size: Vector2D
    value: T[]
    get width(): number
    get height(): number

    set(coordinates: Vector2D, v: T): void
    indexSet(i: number, v: T): void
    get(coordinates: Vector2D): T
    forEach(callback: (cell: T, x: number, y: number, index: number) => void): void
    indexForEach(callback: (cell: T, index: number) => void): void
}

// Array3D<T>
class Array3D<T> {
    constructor(size: Vector3D, defaultValue?: T)
    size: Vector3D
    value: T[]
    get width(): number
    get depth(): number
    get height(): number

    set(coordinates: Vector3D, v: T): void
    indexSet(i: number, v: T): void
    get(coordinates: Vector3D): T
    forEach(callback: (cell: T, x: number, y: number, z: number, index: number) => void): void
    indexForEach(callback: (cell: T, index: number) => void): void
}

// Array3Dc<T> (RLE-compressed)
class Array3Dc<T> {
    constructor(a: Array3D<T>, maxMemoryThreshold?: number)
    size: Vector3D
    values: T[]
    counts: Uint32Array
    get width(): number
    get depth(): number
    get height(): number

    set(coordinates: Vector3D, value: T): void
    get(coordinates: Vector3D): T | undefined
    forEach(callback: (cell: T, x: number, y: number, z: number, i: number) => void): void
    expand(): Array3D<T>
    flush(): void
    setOnFlushCallback(callback: (() => void) | null): void
}

// Array3Di (Integer array with optional bit packing)
class Array3Di {
    constructor(
        data: Array3D<number>,
        bitWidth?: 8 | 16 | 32,
        bitPackingConfig?: Array<1 | 2 | 4 | 8 | 16>,
        overflow?: 'mod' | 'clamp' | 'fail'
    )
    size: Vector3D
    data: Uint8Array | Uint16Array | Uint32Array
    get width(): number
    get depth(): number
    get height(): number

    // Methods for non-packed mode
    set(coordinates: Vector3D, value: number): void
    get(coordinates: Vector3D): number
    indexSet(index: number, value: number): void
    indexGet(index: number): number

    // Methods for packed mode
    setPacked(coordinates: Vector3D, values: number[]): void
    getUnpacked(coordinates: Vector3D): number[]

    // Universal methods
    forEach(callback: (cell: number, x: number, y: number, z: number, index: number) => void): void
    expand(): Array3D<number>
}
```

### Math Utilities

```typescript
import { lerp } from 'omosuen';

// Linear interpolation
lerp(a: number, b: number, t: number): number
```

---

## Type Exports

### Component Types

```typescript
import type {
    ComponentData,
    ComponentOptions,
    ComponentMethods,
    ComponentSerializer,
    ComponentInstanceMethods,
    COMPONENT_TYPE,
    SerializedData
} from 'omosuen';

// Specific component types
import type {
    nexus,          // NexusT type
    NexusMethods,
    ui_overlay,     // UIOverlayT type
    UIOverlayMethods,
    UIBinding,
    data_layer,     // DataLayer type
    DataLayerMethods,
    DataLayerType,
    flag_manager,   // FlagManagerT type
    FlagManagerMethods,
    messenger,      // MessengerT type
    MessengerMethods
} from 'omosuen';
```

### Serializers

```typescript
import {
    NexusSerializer,
    UIOverlaySerializer,
    DataLayerSerializer,
    FlagManagerSerializer,
    MessengerSerializer
} from 'omosuen';

// All implement ComponentSerializer interface
interface ComponentSerializer {
    serialize(component: ComponentData): SerializedData
    deserialize(data: SerializedData): ComponentData | Promise<ComponentData>
}
```

---

## Constants

```typescript
import { ComponentUnique } from 'omosuen';

enum ComponentUnique {
    FALSE = 0,  // Multiple instances allowed
    LOCAL = 1,  // One per parent Nexus
    GLOBAL = 2, // One per entire scene
}
```

---

## Usage Examples

### Basic Setup

```typescript
import * as Omosuen from 'omosuen';

async function main() {
    // Create scene
    const scene = await Omosuen.newComponent('nexus', { name: 'Main' });

    // Add components
    const player = await Omosuen.newComponent('nexus', { name: 'Player' });
    scene.addComponent(player);

    // Register and load
    Omosuen.registerScene('main', scene);
    await Omosuen.switchScene('main');

    // Start loop
    Omosuen.start(60);
}
```

### Component Creation

```typescript
const component = await newComponent('data-layer', {
    name: 'Player Health',
    overrideKey: 'health-system',
    updateOverride: 'healthUpdate'
});
```

### Scene Management

```typescript
// Register scenes
registerScene('menu', menuScene);
registerSceneModule('level1', './scenes/level1.js');
registerSceneSerialized('save', './saves/checkpoint.json');

// Switch scenes
await switchScene('menu');
await switchScene('level1');

// Serialize current scene
const data = serializeComponentRecursive(getActiveScene());
const json = JSON.stringify(data);
```

### Game Loop

```typescript
// Start
start(60);

// Pause for menu
pause();
// ... show menu ...
resume();

// Monitor
if (getFPS() < 30) {
    console.warn('Performance issue detected');
}

// Stop
stop();
```

### Array3Di Usage

```typescript
import { Array3D, Array3Di, Vector3D } from 'omosuen';

// Example 1: Basic integer storage (no bit packing)
const simpleData = new Array3D<number>(new Vector3D(10, 10, 10), 0);
// Fill with some values...
for (let i = 0; i < simpleData.value.length; i++) {
    simpleData.value[i] = i % 256;
}

// Create 8-bit integer array with modulo overflow
const intArray = new Array3Di(simpleData, 8, undefined, 'mod');

// Access values
const value = intArray.get(new Vector3D(5, 5, 5));
intArray.set(new Vector3D(5, 5, 5), 200);

// Example 2: Bit packing for RGBA color storage
// Pack RGBA values (8,8,8,8) into 32-bit integers
const colorData = new Array3D<number>(new Vector3D(2, 2, 1), 0);
// RGBA values: [R, G, B, A, R, G, B, A, ...]
colorData.value = [255, 128, 64, 255, 0, 255, 0, 128]; // 2 pixels

const packedColors = new Array3Di(
    colorData,
    32,
    [8, 8, 8, 8], // R, G, B, A
    'clamp'
);

// Access packed color at position
const rgba = packedColors.getUnpacked(new Vector3D(0, 0, 0)); // [255, 128, 64, 255]

// Set new color
packedColors.setPacked(new Vector3D(1, 0, 0), [100, 200, 50, 255]);

// Example 3: Custom bit packing for game data
// Pack entity data: [health (8 bits), stamina (8 bits), level (8 bits), flags (4 bits), type (2 bits), state (2 bits)]
const entityData = new Array3D<number>(new Vector3D(6, 1, 1), 0);
entityData.value = [100, 80, 5, 3, 1, 2]; // One entity's data

const packedEntities = new Array3Di(
    entityData,
    32,
    [8, 8, 8, 4, 2, 2], // health, stamina, level, flags, type, state
    'fail' // Throw error on invalid values
);

// Unpack entity data
const [health, stamina, level, flags, type, state] =
    packedEntities.getUnpacked(new Vector3D(0, 0, 0));

// Expand back to Array3D
const expanded = packedEntities.expand();
```

---

## Next Steps

- [Getting Started](getting-started.md) - Learn basic workflow
- [Architecture](architecture.md) - Understand design patterns
- [Component System](component-system.md) - Create custom components
- Built-in Components:
  - [Nexus](components/nexus.md)
  - [UI Overlay](components/ui-overlay.md)
  - [Data Layer](components/data-layer.md)
  - [Flag Manager](components/flag-manager.md)
  - [Messenger](components/messenger.md)
- Math Library:
  - [Vector2D](math/vector2d.md)
  - [Vector3D](math/vector3d.md)
  - [Vector4D](math/vector4d.md)
  - [Array2D](math/array2d.md)
  - [Array3D](math/array3d.md)
  - [Array3Dc](math/array3dc.md)
  - [Array3Di](math/array3di.md)

---

**Need Help?** Check the source code or TypeScript definitions for detailed type information.
