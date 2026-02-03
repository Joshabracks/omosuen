# Omosuen Engine - Best Practices Guide

**Version:** 0.1.0
**Last Updated:** 2026-02-03

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

All components follow a consistent directory structure:

```
src/
└── component/
    ├── index.ts              # Re-exports all components
    ├── types.ts              # Core component types and factory
    └── {component-name}/
        └── index.ts          # Component implementation
```

**Example**: For a new `sprite` component:

```
src/component/sprite/index.ts
```

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

Every new component must be registered in `src/component/types.ts`:

1. **Add to `COMPONENT_TYPE` union**:

```typescript
export type COMPONENT_TYPE = "nexus" | "sprite" | "your-new-component";
```

2. **Add builder to `BUILDERS` record**:

```typescript
import { builder as yourNewComponent } from './your-new-component'

const BUILDERS: Record<COMPONENT_TYPE, builder> = {
  nexus,
  sprite,
  "your-new-component": yourNewComponent
};
```

### Required Exports

Each component module must export:

1. **TypeScript Interface** extending `Component`
2. **Builder Function** that creates component instances
3. **ComponentSerializer** for save/load functionality

**Example Template**:

```typescript
// src/component/sprite/index.ts
import { Component, ComponentOptions, ComponentSerializer } from '../types';

export interface Sprite extends Component {
  type: 'sprite';
  unique: false;
  texture: string;
  position: Vector2D;
  // ... additional properties
}

export function builder(options: ComponentOptions): Sprite {
  const sprite: Sprite = {
    type: 'sprite',
    name: options.name,
    unique: false,
    parent: null,
    _disposed: false,
    texture: '',
    position: new Vector2D(0, 0),

    init() {
      // Initialization logic
    },

    update() {
      // Update logic
    },

    dispose() {
      // Cleanup logic (if needed)
    }
  };

  return sprite;
}

function serialize(component: Component): SerializedData {
  const sprite = component as Sprite;
  return {
    type: 'sprite',
    name: sprite.name,
    texture: sprite.texture,
    position: { x: sprite.position.x, y: sprite.position.y }
  };
}

function deserialize(data: SerializedData): Sprite {
  const sprite = builder({ name: data.name });
  sprite.texture = data.texture;
  sprite.position = new Vector2D(data.position.x, data.position.y);
  return sprite;
}

export const SpriteSerializer: ComponentSerializer = {
  serialize,
  deserialize
};
```

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
nexus.addComponent(sprite);
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

Follow the pattern established in `src/component/nexus/index.ts`:

```typescript
function serialize(component: Component): SerializedData {
  const myComponent = component as MyComponent;

  return {
    type: 'my-component',
    name: myComponent.name,
    // Serialize all relevant properties
    customProperty: myComponent.customProperty,
    position: { x: myComponent.position.x, y: myComponent.position.y }
  };
}

function deserialize(data: SerializedData): MyComponent {
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

  // Create component
  const component = builder({ name: data.name });

  // Restore properties
  component.customProperty = data.customProperty;
  component.position = new Vector2D(data.position.x, data.position.y);

  return component;
}

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
const sprites = nexus.getComponentsByType('sprite');
for (const sprite of sprites) {
  updateSprite(sprite);
}

// AVOID: Nested recursive searches
nexus.components.forEach(c => {
  if (c.type === 'nexus') {
    const childSprites = (c as Nexus).getComponentsByType('sprite', true);
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
import { Vector3D, Nexus } from 'omosuen';

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
 *   nexus.addComponent(sprite);
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

- [ ] Component lives in `src/component/{component-name}/index.ts`
- [ ] Component type is `kebab-case` and added to `COMPONENT_TYPE` union
- [ ] Builder function added to `BUILDERS` record in `types.ts`
- [ ] TypeScript interface extends `Component`
- [ ] Component implements required lifecycle hooks (`init`, `update`, `dispose`)
- [ ] Module-level data is properly cleaned up in `dispose()`
- [ ] `unique` flag is set correctly (false for most components)
- [ ] `ComponentSerializer` is implemented with `serialize()` and `deserialize()`
- [ ] Null checks are performed after `newComponent()` calls
- [ ] Error handling uses `console.error()` instead of throwing
- [ ] Performance-critical code is documented with inline notes
- [ ] Public APIs have comprehensive JSDoc comments
- [ ] Component is exported from `src/index.ts` for flat exports
- [ ] Code passes TypeScript strict mode compilation
- [ ] Code passes `npm run lint`

---

**Happy coding! Build something amazing with Omosuen.**
