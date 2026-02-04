# Omosuen Engine - Best Practices Guide

**Version:** 0.0.0 (Pre-Release)
**Last Updated:** 2026-02-04

This document outlines the best practices and standards for internal development of the Omosuen engine. Following these guidelines ensures consistency, maintainability, and optimal performance across the codebase.

---

## Table of Contents

1. [Architecture Philosophy](#architecture-philosophy)
2. [Component Development Standards](#component-development-standards)
3. [Component Lifecycle & Memory Management](#component-lifecycle--memory-management)
4. [Nexus Hierarchy Best Practices](#nexus-hierarchy-best-practices)
5. [Math Library Standards](#math-library-standards)
6. [Serialization Requirements](#serialization-requirements)
7. [Error Handling Philosophy](#error-handling-philosophy)
8. [Performance Optimization Guidelines](#performance-optimization-guidelines)
9. [Export Strategy](#export-strategy)
10. [Code Quality Standards](#code-quality-standards)

---

## Architecture Philosophy

### Hierarchical Components Over ECS

Omosuen uses a **hierarchical component pattern** rather than a pure Entity-Component-System (ECS) architecture. This design decision prioritizes **developer experience and accessibility** over absolute performance maximization.

**Why Hierarchical Components?**

- **Lower Learning Curve**: ECS systems can be confusing for novice developers. A hierarchical approach (similar to Godot or Unity's classic GameObject system) is more intuitive.
- **Familiar Mental Model**: Developers think in terms of parent-child relationships, which maps naturally to scene organization.
- **Hidden Optimizations**: The engine's specialized nature (fixed z-axis, axonometric rendering) allows for internal data-oriented optimizations without exposing DOD (Data-Oriented Design) complexity to end users.

**Inspiration from Godot**

Godot's success comes from its composition-driven scene tree architecture where games are built by composing specialized nodes rather than deep inheritance hierarchies. Omosuen follows this philosophy:

- **Composition over Inheritance**: Components are building blocks that can be combined
- **Scene-as-Component**: Nexus acts as a container for reusable, self-contained component groups
- **Built-in Patterns**: Common patterns (like serialization, disposal) are baked into the engine

### Internal vs External Complexity

**External (Developer-Facing)**: Simple, intuitive hierarchical component API
**Internal (Engine-Level)**: Data-oriented optimizations, cache-friendly memory layouts, batch processing

This separation allows the engine to achieve excellent performance while remaining approachable for developers of all skill levels.

---

## Component Development Standards

### File Structure

All components follow a **data-oriented design (DOD) pattern** with a 3-file directory structure that separates data from functionality:

```
src/
└── component/
    ├── index.ts              # Re-exports all components
    ├── types.ts              # Core component types, factory, and $ Proxy
    └── {component-name}/
        ├── index.ts          # Re-exports data and methods
        ├── data.ts           # Pure interface + builder + serializer
        └── methods.ts        # Static methods object
```

**Example**: For a new `sprite` component:

```
src/component/sprite/index.ts          # export * from './data', './methods'
src/component/sprite/data.ts           # Sprite interface + builder() + SpriteSerializer
src/component/sprite/methods.ts        # SpriteMethods object
```

**Key Principle**: Data and functionality are separated for optimal performance at scale (10,000+ entities)

### Naming Conventions

#### Component Types (COMPONENT_TYPE)

- **Format**: `kebab-case`
- **Examples**: `"nexus"`, `"sprite"`, `"enemy-spawner"`, `"map"`

```typescript
export type COMPONENT_TYPE = "nexus" | "sprite" | "enemy-spawner";
```

#### Component Instance Names

- **Recommendation**: Title Case (e.g., `"Player Inventory"`, `"Enemy Spawner"`)
- **Flexibility**: Ultimately up to the developer using the engine
- **Guideline**: Names should be descriptive and human-readable

```typescript
const inventory = await newComponent("inventory", { name: "Player Inventory" });
const spawner = await newComponent("enemy-spawner", { name: "Boss Arena Spawner" });
```

### Component Registration

Every new component must be registered in `src/component/types.ts` with **four required registrations**:

1. **Add to `COMPONENT_TYPE` union**:

```typescript
export type COMPONENT_TYPE = "nexus" | "sprite" | "your-new-component";
```

2. **Add methods object to `ComponentMethod` record**:

```typescript
import { Nexus } from './nexus/methods';
import { Sprite } from './sprite/methods';
import { YourNewComponent } from './your-new-component/methods';

export const ComponentMethod: Record<COMPONENT_TYPE, ComponentMethods> = {
  nexus: Nexus,
  sprite: Sprite,
  "your-new-component": YourNewComponent
};
```

3. **Add builder to `BUILDERS` record**:

```typescript
import { builder as nexusBuilder } from './nexus/data';
import { builder as spriteBuilder } from './sprite/data';
import { builder as yourNewComponentBuilder } from './your-new-component/data';

const BUILDERS: Record<COMPONENT_TYPE, builder> = {
  nexus: nexusBuilder,
  sprite: spriteBuilder,
  "your-new-component": yourNewComponentBuilder
};
```

4. **Add methods type to `ProxyMethodSignatures` union** (for `$` Proxy typing):

```typescript
import type { NexusMethods } from './nexus/methods';
import type { SpriteMethods } from './sprite/methods';
import type { YourNewComponentMethods } from './your-new-component/methods';

type ProxyMethodSignatures =
  ExtractMethods<NexusMethods> &
  ExtractMethods<SpriteMethods> &
  ExtractMethods<YourNewComponentMethods>;
```

---

### The $ Proxy Helper

The **`$` Proxy helper** provides a type-safe, ergonomic API for calling component methods without needing to know which specific component type you're working with. It automatically routes method calls to the correct implementation based on the component's `type` property.

#### Why Use the $ Proxy?

**Performance at Scale**: For massive games with 10,000+ entities, the data-oriented design separates data from methods. The `$` Proxy provides convenience without sacrificing performance.

**Type Safety**: The Proxy is strongly typed with `ProxyMethodSignatures`, providing full IntelliSense and compile-time type checking.

**Unified API**: Call any component method using the same pattern: `$.methodName(component, ...args)`

#### Basic Usage

```typescript
import { $, newComponent } from 'omosuen';

// Create components
const myNexus = await newComponent("nexus", { name: "Player" });
const child = await newComponent("nexus", { name: "Child" });

// Use $ Proxy for method calls
$.addComponent(myNexus, child);
const found = $.getComponentByName(myNexus, "Child", false);
$.dispose(myNexus);
```

#### Direct Static Method Calls (Advanced)

For performance-critical code (game loops, batch operations), you can bypass the Proxy and call static methods directly:

```typescript
import { Nexus } from 'omosuen';

// Game loop - maximum performance
function gameUpdate(scene: nexus, deltaTime: number) {
  const allNexuses = Nexus.getComponentsByType(scene, "nexus", true);

  for (let i = 0; i < allNexuses.length; i++) {
    const n = allNexuses[i] as nexus;
    if (!n.paused) {
      // Direct static call - no Proxy overhead
      Nexus.update(n, deltaTime);
    }
  }
}
```

#### When to Use Each Approach

| Scenario | Use | Reason |
|----------|-----|--------|
| Setup/initialization | `$` Proxy | Ergonomic, clear intent |
| Event handlers | `$` Proxy | Readability matters |
| One-off operations | `$` Proxy | Convenience over performance |
| Game loop (60fps) | Direct static | Minimize overhead |
| Batch processing | Direct static | Maximum performance |
| 1000+ entities/frame | Direct static | Avoid Proxy lookup |

#### Type Safety

The `$` Proxy is typed with all available component methods:

```typescript
// TypeScript provides autocomplete and type checking
$.addComponent(myNexus, child);       // ✓ Type-safe
$.getComponentByName(myNexus, "Test"); // ✓ Return type inferred
$.nonExistentMethod(myNexus);          // ✗ Compile error
```

---

### Required Exports

Each component module must export **three essential elements** following the data-oriented design pattern:

1. **Pure Data Interface** (in `data.ts`) - Component data structure only
2. **Builder Function** (in `data.ts`) - Creates pure data instances
3. **ComponentSerializer** (in `data.ts`) - Serialization logic
4. **Static Methods Object** (in `methods.ts`) - All component methods
5. **Methods Interface** (in `methods.ts`) - Exported for TypeScript typing

All elements are re-exported from the component's `index.ts` file for convenient importing.

**Example Template**:

```typescript
// src/component/sprite/data.ts
import { ComponentData, ComponentOptions, ComponentSerializer } from '../types';

// Pure data interface
export interface sprite extends ComponentData {
  type: 'sprite';
  unique: false;
  texture: string;
  position: Vector2D;
  // ... additional properties (DATA ONLY)
}

// Builder function (pure data only)
export function builder(options: ComponentOptions): sprite {
  return {
    type: 'sprite',
    name: options.name,
    unique: false,
    parent: null,
    _disposed: false,
    texture: '',
    position: new Vector2D(0, 0)
  };
}

// Serialization logic
function serialize(component: ComponentData): any {
  const s = component as sprite;
  return {
    type: 'sprite',
    name: s.name,
    texture: s.texture,
    position: { x: s.position.x, y: s.position.y }
  };
}

function deserialize(data: any): sprite {
  const errors = [];
  if (data.type !== 'sprite') errors.push(`type ${data.type} does not match "sprite"`);
  if (!data.name) errors.push(`Sprite requires a name`);
  if (errors.length) throw new Error(errors.join('\n'));

  const s = builder({ name: data.name });
  s.texture = data.texture;
  s.position = new Vector2D(data.position.x, data.position.y);
  return s;
}

export const SpriteSerializer: ComponentSerializer = {
  serialize,
  deserialize
};
```

```typescript
// src/component/sprite/methods.ts
import { ComponentData, ComponentMethods } from '../types';
import { sprite } from './data';

// Export interface for TypeScript typing
export interface SpriteMethods extends ComponentMethods {
  setTexture: (s: sprite, texture: string) => void;
  move: (s: sprite, delta: Vector2D) => void;
  dispose: (component: ComponentData) => void;
  // ... other methods
}

// Static methods object
export const Sprite: SpriteMethods = {
  type: 'sprite',

  setTexture: (s: sprite, texture: string) => {
    s.texture = texture;
  },

  move: (s: sprite, delta: Vector2D) => {
    s.position = s.position.add(delta);
  },

  dispose: (component: ComponentData) => {
    const s = component as sprite;
    // Cleanup logic
    s._disposed = true;
  }
};
```

```typescript
// src/component/sprite/index.ts
export * from './data';
export * from './methods';
```

**Key Differences from Old Pattern:**
- ✅ Builder returns **pure data only** (no attached methods)
- ✅ Methods are **static functions** in a separate object
- ✅ Methods take component as **first parameter**: `Sprite.move(sprite, delta)`
- ✅ Use **`$` Proxy** for ergonomic calls: `$.move(sprite, delta)`
- ✅ Serialization logic lives in **data.ts** alongside the interface and builder

---

## Component Lifecycle & Memory Management

### Lifecycle Hooks

Components support the following lifecycle hooks:

- **`init()`**: Called when component is first created/added to scene
- **`update()`**: Called every frame during game loop
- **`dispose()`**: Called when component is removed or destroyed

### Module-Level Data Pattern

To **avoid garbage collection spikes** that can cause FPS drops, allocate frequently-used data at the module level rather than within component instances.

**Why Module-Level Allocation?**

- Avoids repeated allocation/deallocation cycles
- Prevents GC pauses during gameplay
- Improves cache locality for hot data

**Example**:

```typescript
// BAD: Allocates new array every frame
export function builder(options: ComponentOptions): MyComponent {
  return {
    update() {
      const tempArray = new Array(1000); // GC pressure!
      // ... use tempArray
    }
  };
}

// GOOD: Reuse module-level array
const TEMP_ARRAY = new Array(1000); // Allocated once

export function builder(options: ComponentOptions): MyComponent {
  let dataIndex = -1; // Component-specific index

  return {
    init() {
      dataIndex = allocateSlotInPool(); // Reserve space
    },

    update() {
      // Reuse module-level array via index
      TEMP_ARRAY[dataIndex] = computeValue();
    },

    dispose() {
      if (dataIndex !== -1) {
        releaseSlotInPool(dataIndex); // Free space
        dataIndex = -1;
      }
    }
  };
}
```

### Disposal Requirements

**Rule**: If a component uses module-level data, it **MUST** implement `dispose()` to clean up that data.

**When `dispose()` is Optional**:

- Component only uses instance-level data
- No external resources (textures, audio, network connections)
- Garbage collector can safely handle cleanup

**When `dispose()` is Required**:

- Component allocates slots in module-level pools/arrays
- Component holds references to shared resources
- Component registers event listeners or callbacks
- Component manages WebGL buffers or other native resources

**Disposal Order**: Nexus performs **depth-first disposal** of child components before disposing itself.

### Unique Components

The `unique` flag automatically disposes existing components of the same type when a new one is added to a Nexus.

**Use Sparingly**: Only for components where multiple instances would cause conflicts.

**Examples of Unique Components**:

- **Map Component**: Only one map can be rendered at once
- **FlagManager**: Global state manager to avoid race conditions
- **CameraController**: Single active camera per scene
- **AudioMixer**: Central audio management

**Example**:

```typescript
export interface Map extends Component {
  type: 'map';
  unique: true; // Only one map allowed per Nexus
  // ...
}
```

### Null Checking After Component Creation

Always check for `null` after calling `newComponent()`:

```typescript
const sprite = await newComponent("sprite", { name: "Player Sprite" });

if (!sprite) {
  console.warn("Failed to create sprite component");
  return; // Handle gracefully
}

// Safe to use sprite
$.addComponent(nexus, sprite);
```

---

## Nexus Hierarchy Best Practices

### Scene Structure

The engine loads an **`activeScene`**, which is a root-level Nexus (a Nexus with no parent).

```typescript
// Root scene
const mainScene = await newComponent("nexus", { name: "Main Scene" });

// Child nexuses for organization
const playerNexus = await newComponent("nexus", { name: "Player" });
const enemiesNexus = await newComponent("nexus", { name: "Enemies" });
const uiNexus = await newComponent("nexus", { name: "UI" });

mainScene.addComponents([playerNexus, enemiesNexus, uiNexus]);
```

### Component Organization

Organize components into **logical groupings** using Nexus hierarchies:

```typescript
// Player hierarchy
playerNexus.addComponents([
  playerSprite,
  playerController,
  playerInventory,
  playerHealth
]);

// Enemy hierarchy (can be instantiated multiple times)
const enemyTemplate = await newComponent("nexus", { name: "Enemy Template" });
enemyTemplate.addComponents([
  enemySprite,
  enemyAI,
  enemyHealth
]);

// Spawn multiple enemies
for (let i = 0; i < 10; i++) {
  const enemy = cloneNexus(enemyTemplate); // Hypothetical clone function
  enemiesNexus.addComponent(enemy);
}
```

### Depth Limits

**No enforced depth limits**: The Nexus hierarchy supports unlimited nesting.

**Performance Consideration**: Avoid unnecessary deep nesting. Flatter hierarchies are generally more performant for queries and updates.

**Good Depth Example** (3-4 levels):

```
Scene
├── Player
│   ├── Sprite
│   ├── Controller
│   └── Inventory
└── Enemies
    ├── Enemy 1
    │   ├── Sprite
    │   └── AI
    └── Enemy 2
```

**Avoid Excessive Depth** (10+ levels unless necessary)

### Component Communication

Components can communicate through multiple approaches:

#### 1. Parent/Child Traversal

Use `Component.parent` and `Nexus.getComponent*()` methods:

```typescript
// Access parent
if (myComponent.parent && myComponent.parent.type === 'nexus') {
  const parentNexus = myComponent.parent as Nexus;
  const sibling = parentNexus.getComponentByType('sprite');
}

// Access children (if component is a Nexus)
const nexusComponent = component as Nexus;
const childSprite = nexusComponent.getComponentByType('sprite', true); // recursive
```

#### 2. Data Management System

The engine provides a **data management system** for global state:

- **Flat data objects**: Shared state accessible across components
- **Global flags**: Boolean states (e.g., `isGamePaused`, `isPlayerInvincible`)
- **Global message listeners**: Pub/sub pattern for decoupled communication

```typescript
// Example (hypothetical API)
DataManager.setFlag('gameStarted', true);
DataManager.subscribe('playerDied', () => {
  // Handle player death
});
```

#### 3. Direct References (Use Carefully)

Components can hold direct references to other components, but this creates tight coupling. Use sparingly.

```typescript
// Acceptable for tightly-coupled systems
interface PlayerController extends Component {
  sprite: Sprite | null; // Direct reference
}
```

---

## Math Library Standards

### Immutability

**All Vector methods return new instances** rather than mutating the original.

**Rationale**:

- Prevents accidental mutation bugs
- Makes code easier to reason about
- Follows functional programming principles
- Consistent with modern JavaScript best practices

**Example**:

```typescript
const position = new Vector3D(10, 20, 30);
const normalized = position.normalize(); // Returns new Vector3D

// position is unchanged
console.log(position); // Vector3D(10, 20, 30)
console.log(normalized); // Vector3D(0.267, 0.534, 0.801)
```

### Vector Usage Guidelines

#### Vector3D: World-Space Coordinates

Use `Vector3D` for **3D positions in world space**:

```typescript
const entityPosition = new Vector3D(100, 50, 25); // x, y, z in world
const velocity = new Vector3D(1, 0, -0.5);
const newPosition = entityPosition.add(velocity);
```

#### Vector2D: Screen-Space Coordinates

Use `Vector2D` for **2D positions on screen**:

```typescript
const screenPosition = new Vector2D(640, 480); // x, y on screen
const mousePosition = new Vector2D(event.clientX, event.clientY);
```

#### Color Representation

Both `Vector3D` and `Vector4D` support color getters:

```typescript
// RGB color (0-255 range)
const color = new Vector3D(255, 128, 64);
console.log(color.r, color.g, color.b); // 255, 128, 64

// RGBA color with alpha
const colorWithAlpha = new Vector4D(255, 128, 64, 0.5);
console.log(colorWithAlpha.r, colorWithAlpha.g, colorWithAlpha.b, colorWithAlpha.a);
```

### Array Classes

#### Array2D & Array3D: Standard Arrays

Use for **small to medium datasets** or **frequently updated data**:

```typescript
// 2D grid for UI layout
const grid = new Array2D<number>(new Vector2D(10, 10), 0);
grid.set(new Vector2D(5, 5), 42);

// 3D voxel data (small world)
const voxels = new Array3D<number>(new Vector3D(32, 32, 16), -1);
```

#### Array3Dc: Compressed Arrays

Use for **large datasets with repeating values that are rarely updated**:

```typescript
// Large map data (mostly empty or repeating tiles)
const mapData = new Array3D<number>(new Vector3D(1000, 1000, 10), 0);
// ... populate map
const compressedMap = new Array3Dc(mapData);

// Read operations are fast
const tile = compressedMap.get(new Vector3D(500, 500, 5));

// Writes are tracked in dirty map
compressedMap.set(new Vector3D(500, 500, 5), 42);

// Flush when done with batch updates
compressedMap.flush();
```

**When to Use Array3Dc**:

- Map/terrain data
- Voxel worlds
- Any large 3D grid with repetitive patterns
- Data that is mostly read, rarely written

**When NOT to Use Array3Dc**:

- Frequently changing data (defeats compression benefits)
- Small datasets (overhead not worth it)
- Random access patterns with lots of writes

### Performance Notes

The math library includes performance annotations for optimal usage:

```typescript
// GOOD: Use indexSet in forEach loops
array3D.forEach((cell, x, y, z, i) => {
  array3D.indexSet(i, newValue); // Fast
});

// AVOID: Using set() in forEach (recalculates index, creates Vector3D)
array3D.forEach((cell, x, y, z, i) => {
  array3D.set(new Vector3D(x, y, z), newValue); // 2-3x slower
});

// BEST: Use indexForEach when you don't need coordinates
array3D.indexForEach((cell, i) => {
  array3D.value[i] = newValue; // Fastest
});
```

---

## Serialization Requirements

### All Components Must Be Serializable

To support **save/load functionality**, every component must implement a `ComponentSerializer`.

**Why Serialization is Critical**:

- Save game state to local storage or files
- Network synchronization for multiplayer (future)
- Scene cloning and prefab systems
- Undo/redo functionality

### Serialization Pattern

Serialization code should be placed in the component's `data.ts` file alongside the interface and builder function. Follow the pattern established in `src/component/nexus/data.ts`:

```typescript
// src/component/my-component/data.ts
import { ComponentData, ComponentOptions, ComponentSerializer } from '../types';

// Interface definition
export interface myComponent extends ComponentData {
  type: 'my-component';
  unique: false;
  customProperty: string;
  position: Vector2D;
}

// Builder function
export function builder(options: ComponentOptions): myComponent {
  return {
    type: 'my-component',
    name: options.name,
    unique: false,
    parent: null,
    _disposed: false,
    customProperty: '',
    position: new Vector2D(0, 0)
  };
}

// Serialization functions
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serialize(component: ComponentData): any {
  const myComponent = component as myComponent;

  return {
    type: 'my-component',
    name: myComponent.name,
    customProperty: myComponent.customProperty,
    position: { x: myComponent.position.x, y: myComponent.position.y }
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deserialize(data: any): myComponent {
  // Validate data
  const errors = [];
  if (data.type !== 'my-component') {
    errors.push(`type ${data.type} does not match "my-component"`);
  }
  if (!data.name) {
    errors.push(`MyComponent requires a name`);
  }
  if (errors.length) {
    throw new Error(errors.join('\n'));
  }

  // Create component using builder
  const component = builder({ name: data.name });

  // Restore properties
  component.customProperty = data.customProperty;
  component.position = new Vector2D(data.position.x, data.position.y);

  return component;
}

// Export serializer
export const MyComponentSerializer: ComponentSerializer = {
  serialize,
  deserialize
};
```

### What to Serialize

**DO serialize**:

- Component type and name
- Game-relevant state (position, health, inventory items)
- Configuration data (speed, damage, AI parameters)
- References to assets (texture paths, audio file names)

**DO NOT serialize**:

- Computed/derived values (calculate in `init()` instead)
- Temporary buffers or caches
- WebGL contexts or native resources
- Function references or closures

### Handling Nested Components

For components containing other components (like Nexus), the main serializer will handle recursion:

```typescript
// Nexus serialization - simplified
function serialize(component: Component): SerializedData {
  const nexus = component as Nexus;

  const serializedComponents = [];
  for (const child of nexus.components) {
    serializedComponents.push(child); // Main serializer handles recursion
  }

  return {
    type: 'nexus',
    name: nexus.name,
    components: serializedComponents
  };
}
```

---

## Error Handling Philosophy

### Log, Don't Throw

The engine avoids throwing exceptions in favor of **logging errors** and **returning null** or **safe defaults**.

**Rationale**:

- Games should degrade gracefully, not crash
- Developers can check logs to debug issues
- Missing assets or failed operations shouldn't halt the entire game

### Error Handling Pattern

```typescript
export async function newComponent(
  type: COMPONENT_TYPE,
  options: ComponentOptions
) {
  const builder = BUILDERS[type];

  if (!builder) {
    console.error(
      `[NEW COMPONENT ERROR] component type ${type} does not exist`
    );
    return null; // Return null, don't throw
  }

  const component = await builder(options);

  if (!component) {
    console.error(
      `[NEW COMPONENT ERROR] component named ${options.name} failed to build`
    );
    return null;
  }

  component.id = COMPONENT_COUNT++;
  return component;
}
```

### Null Checking is Developer's Responsibility

Developers using the engine should check for null returns:

```typescript
const sprite = await newComponent("sprite", { name: "Player Sprite" });

if (!sprite) {
  // Handle error gracefully
  console.warn("Could not create sprite, using fallback");
  return;
}

// Safe to use sprite
```

### Logging Levels

The engine will support configurable logging:

- **`console.error()`**: Critical errors (component creation failed, resource not found)
- **`console.warn()`**: Warnings (deprecated API usage, performance concerns)
- **`console.info()`**: Informational (component initialized, scene loaded)
- **`console.log()`**: Debug output (verbose state changes)

**Future Enhancement**: Log suppression, filtering, and custom logging handlers.

### When to Throw Exceptions

Reserve exceptions for **truly unrecoverable errors**:

- Invalid engine configuration (e.g., `maxMemoryThreshold` < 0)
- Serialization format errors (corrupted save data)
- Programmer errors (calling methods on disposed components)

```typescript
divide(scalar: number): Vector3D {
  if (scalar === 0) {
    throw new Error('Cannot divide by zero'); // Unrecoverable math error
  }
  return new Vector3D(this.x / scalar, this.y / scalar, this.z / scalar);
}
```

---

## Performance Optimization Guidelines

### Use Built-In Array Methods

The `Array2D`, `Array3D`, and `Array3Dc` classes provide optimized methods for iteration and access.

**Performance Tips**:

1. **Use `indexSet()` in `forEach()` loops** (fastest):

```typescript
array3D.forEach((cell, x, y, z, i) => {
  array3D.indexSet(i, newValue);
});
```

2. **Use direct array access when possible**:

```typescript
array3D.forEach((cell, x, y, z, i) => {
  array3D.value[i] = newValue; // Also very fast
});
```

3. **Avoid `set()` in hot loops** (2-3x slower):

```typescript
// AVOID THIS
array3D.forEach((cell, x, y, z, i) => {
  array3D.set(new Vector3D(x, y, z), newValue); // Allocates Vector3D
});
```

4. **Use `indexForEach()` when coordinates aren't needed**:

```typescript
array3D.indexForEach((cell, i) => {
  array3D.value[i] = processCell(cell);
});
```

### Module-Level Pooling

For frequently allocated objects, use module-level pools:

```typescript
// Object pool for Vector3D instances
const VECTOR_POOL: Vector3D[] = [];
const POOL_SIZE = 1000;

function getPooledVector(x: number, y: number, z: number): Vector3D {
  if (VECTOR_POOL.length > 0) {
    const v = VECTOR_POOL.pop()!;
    v.x = x;
    v.y = y;
    v.z = z;
    return v;
  }
  return new Vector3D(x, y, z);
}

function releaseVector(v: Vector3D): void {
  if (VECTOR_POOL.length < POOL_SIZE) {
    VECTOR_POOL.push(v);
  }
}
```

### Batch Processing

Process components in batches when possible:

```typescript
// GOOD: Batch update all sprites
const sprites = $.getComponentsByType(nexus, 'sprite');
for (const sprite of sprites) {
  updateSprite(sprite);
}

// AVOID: Nested recursive searches
nexus.components.forEach(c => {
  if (c.type === 'nexus') {
    const childSprites = $.getComponentsByType(c as nexus, 'sprite', true);
    // ...
  }
});
```

### Document Performance Considerations

Include performance notes in code comments:

```typescript
/**
 * Compresses a 3D array using run-length encoding.
 *
 * Performance: O(n) compression time, O(log n) read access, O(1) dirty writes.
 * Best for large datasets with repeating values that are rarely updated.
 *
 * @param maxMemoryThreshold - Flush dirty map when this % of cells are modified (default 0.05 = 5%)
 */
export class Array3Dc<T> {
  // ...
}
```

### Cache-Friendly Patterns

Favor linear memory access patterns:

```typescript
// GOOD: Linear iteration
for (let i = 0; i < array.length; i++) {
  process(array[i]);
}

// AVOID: Random access in tight loops
for (let i = 0; i < 1000; i++) {
  const randomIndex = Math.floor(Math.random() * array.length);
  process(array[randomIndex]);
}
```

---

### Data-Oriented Design at Scale

For **massive open-world games** with 10,000+ entities, Omosuen uses a **data-oriented design (DOD)** pattern that separates data from functionality.

#### Why DOD?

**Memory Efficiency**: Traditional object-oriented patterns attach methods to each component instance. At scale:
- 10,000 nexus instances with 15 methods each = **15 MB of method closures**
- 50,000 entities = **75 MB wasted** on duplicate function objects

With DOD:
- **Zero method overhead** per instance
- Methods are shared static functions
- **75 MB saved** at 50,000 entities

**GC Performance**: Fewer allocations mean:
- Shorter garbage collection pauses (**<10ms** vs 50-200ms)
- Fewer frame drops (critical for 60fps gameplay)
- Better performance during chunk loading/unloading

**CPU Optimization**: Static methods enable:
- **Monomorphic call sites** (V8 can inline aggressively)
- Better instruction cache locality
- **10-20% faster update loops** at scale
- SIMD-like batch optimizations

#### When to Use DOD Patterns

| Entity Count | Pattern | Reason |
|--------------|---------|--------|
| < 1,000 | Either | Performance difference negligible |
| 1,000 - 5,000 | Prefer DOD | Noticeable GC improvements |
| 5,000 - 10,000 | Use DOD | Significant performance gains |
| 10,000+ | **Must use DOD** | Required for 60fps |

#### Performance-Critical Code Paths

For maximum performance in **game loops** and **batch operations**, use direct static method calls:

```typescript
// Game update loop - called 60 times per second
function gameUpdate(scene: nexus, deltaTime: number) {
  // Get all nexuses (recursive search)
  const allNexuses = Nexus.getComponentsByType(scene, "nexus", true) as nexus[];

  // Batch process with static methods (fastest)
  for (let i = 0; i < allNexuses.length; i++) {
    const n = allNexuses[i];
    if (!n.paused && !n._disposed) {
      Nexus.update(n, deltaTime);  // Direct static call
    }
  }
}
```

#### Ergonomic Code Paths

For **setup**, **initialization**, and **event handlers**, use the `$` Proxy for readability:

```typescript
// Scene initialization - called once
async function setupPlayerScene() {
  const scene = await newComponent("nexus", { name: "Player Scene" });
  const player = await newComponent("nexus", { name: "Player" });
  const inventory = await newComponent("nexus", { name: "Inventory" });

  // Use $ Proxy for clarity
  $.addComponent(scene, player);
  $.addComponent(player, inventory);

  return scene;
}
```

#### Memory Layout Optimization

DOD enables better memory layouts for cache efficiency:

```typescript
// Module-level arrays for hot data (cache-friendly)
const POSITIONS: Float32Array = new Float32Array(MAX_ENTITIES * 3);
const VELOCITIES: Float32Array = new Float32Array(MAX_ENTITIES * 3);

// Components store indices, not data
interface PhysicsComponent {
  positionIndex: number;  // Index into POSITIONS array
  velocityIndex: number;  // Index into VELOCITIES array
}

// Tight loop over contiguous memory (very fast)
for (let i = 0; i < entityCount * 3; i += 3) {
  POSITIONS[i] += VELOCITIES[i] * deltaTime;     // X
  POSITIONS[i+1] += VELOCITIES[i+1] * deltaTime; // Y
  POSITIONS[i+2] += VELOCITIES[i+2] * deltaTime; // Z
}
```

---

## Export Strategy

### Flat Exports at Engine Level

All public APIs should be exported as **flat exports** from `src/index.ts`:

```typescript
// src/index.ts
export { Nexus, builder as createNexus } from './component/nexus';
export { Sprite, builder as createSprite } from './component/sprite';
export { Vector2D, Vector3D, Vector4D, Array2D, Array3D, Array3Dc, lerp } from './math';
export { newComponent } from './component/types';
export type { Component, ComponentOptions, COMPONENT_TYPE } from './component/types';

// Engine object for UMD bundle
const Omosuen = {
  version: "0.1.0",
  name: "Omosuen",
  // ... methods
};

export default Omosuen;
export { Omosuen };
```

### Enable Tree-Shaking

Named exports enable tree-shaking for module bundlers:

```typescript
// Developers can import only what they need
import { Vector3D, $, newComponent } from 'omosuen';

// Or use the full engine object
import Omosuen from 'omosuen';
```

### Backward Compatibility

Maintain the `Omosuen` default export for UMD builds:

```typescript
// Browser (UMD bundle)
<script src="omosuen.js"></script>
<script>
  const engine = Omosuen;
  engine.init();
</script>

// ES Modules
import { Vector3D, newComponent } from 'omosuen';
```

---

## Code Quality Standards

### TypeScript Strict Mode

All code must compile with TypeScript strict mode enabled:

```json
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true
  }
}
```

### Comprehensive JSDoc Comments

Document all public APIs with JSDoc:

```typescript
/**
 * Creates a new component of the specified type.
 *
 * @param type - The component type (e.g., "nexus", "sprite")
 * @param options - Component configuration options
 * @returns The created component, or null if creation failed
 *
 * @example
 * ```typescript
 * const sprite = await newComponent("sprite", { name: "Player Sprite" });
 * if (sprite) {
 *   $.addComponent(nexus, sprite);
 * }
 * ```
 */
export async function newComponent(
  type: COMPONENT_TYPE,
  options: ComponentOptions
): Promise<Component | null> {
  // ...
}
```

### Prefer Simplicity and Readability

Follow Godot's philosophy: **"Use the simplest code possible"**

**Good**:

```typescript
function normalize(): Vector3D {
  const length = Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  return new Vector3D(this.x / length || 0, this.y / length || 0, this.z / length || 0);
}
```

**Over-Engineered**:

```typescript
function normalize(): Vector3D {
  const lengthSquared = this.magnitudeSquared();
  if (lengthSquared < Number.EPSILON) {
    return Vector3D.ZERO;
  }
  const invLength = 1.0 / Math.sqrt(lengthSquared);
  return this.multiplyScalar(invLength);
}
```

### Linting

Follow ESLint rules consistently:

```bash
npm run lint
```

Key rules:

- No unused variables
- Consistent naming conventions
- No `any` types (use `unknown` or specific types)
- Explicit return types on functions

### Testing (Future)

While not currently implemented, plan for:

- Unit tests for math utilities
- Component lifecycle tests
- Serialization round-trip tests
- Performance benchmarks

---

## Summary Checklist

When adding a new component to the engine, ensure:

### File Structure (Data-Oriented Design)
- [ ] Component directory created at `src/component/{component-name}/`
- [ ] **data.ts** created with:
  - [ ] Pure data interface extending `ComponentData`
  - [ ] Builder function that returns pure data only (no attached methods)
  - [ ] ComponentSerializer with `serialize()` and `deserialize()` functions
  - [ ] All three exported
- [ ] **methods.ts** created with:
  - [ ] Static methods object with all component methods
  - [ ] Methods interface exported for TypeScript typing (e.g., `SpriteMethods extends ComponentMethods`)
  - [ ] All exported
- [ ] **index.ts** re-exports both files: `export * from './data'`, `export * from './methods'`

### Component Registration (types.ts)
- [ ] Component type is `kebab-case` and added to `COMPONENT_TYPE` union
- [ ] Static methods object added to `ComponentMethod` record (imported from `./component-name/methods`)
- [ ] Builder function added to `BUILDERS` record (imported from `./component-name/data`)
- [ ] Methods interface type added to `ProxyMethodSignatures` union for `$` Proxy typing

### Implementation Details
- [ ] Static methods take component as **first parameter**: `methodName(component, ...args)`
- [ ] Methods use `ComponentMethod[c.type]` for type-specific lookups when needed
- [ ] `dispose()` method uses static dispatch pattern (see Nexus.dispose example)
- [ ] Module-level data is properly cleaned up in `dispose()`
- [ ] `unique` flag is set correctly (false for most components)

### Code Quality
- [ ] Null checks performed after `newComponent()` calls
- [ ] Error handling uses `console.error()` instead of throwing
- [ ] Performance-critical code documented with inline notes
- [ ] Public APIs have comprehensive JSDoc comments
- [ ] Code examples use `$` Proxy helper: `$.methodName(component, ...args)`
- [ ] Component exported from `src/index.ts` for flat exports
- [ ] Code passes TypeScript strict mode compilation
- [ ] Code passes `npm run lint`
- [ ] CLI unit tests pass: `npm run test:cli`

---

**Happy coding! Build something amazing with Omosuen.**
