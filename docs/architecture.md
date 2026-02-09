# Omosuen Architecture

Understanding the core architectural decisions behind Omosuen.

---

## Design Philosophy

Omosuen follows a **"simple API, optimized internals"** philosophy inspired by Godot:

1. **Developer Experience First** - Clean, intuitive APIs over theoretical maximum performance
2. **Composition Over Inheritance** - Flexible component hierarchies
3. **Graceful Degradation** - Log errors, don't crash; games should keep running
4. **Performance Where It Matters** - Zero allocations in hot paths, data locality
5. **Predictable Behavior** - Explicit is better than implicit

---

## Core Concepts

### 1. Hierarchical Component Pattern (Not ECS)

Omosuen intentionally uses a **hierarchical component system** rather than Entity-Component-System (ECS):

```
Scene (Nexus)
├── Player (Nexus)
│   ├── Health (Data Layer)
│   ├── Inventory (Data Layer)
│   └── Messenger
├── Enemies (Nexus)
│   ├── Enemy 1 (Nexus)
│   ├── Enemy 2 (Nexus)
│   └── ...
└── UI (Nexus)
    └── HUD (UI Overlay)
```

**Why not ECS?**
- More intuitive for most developers
- Easier to reason about parent-child relationships
- Simpler scene serialization
- Better for games with moderate entity counts (hundreds, not thousands)

**Tradeoffs:**
- Less cache-friendly than pure ECS
- Slightly slower for massive entity counts (1000+)
- More memory per entity

---

### 2. Data-Oriented Design (DOD)

While using a hierarchical pattern, Omosuen still applies DOD principles:

#### Method Registry

Methods are **not stored on component instances**. They live in a central registry:

```typescript
// Component data (lightweight)
interface NexusData {
    name: string;
    type: 'nexus';
    id: number;
    components: ComponentData[];
    // ... no methods here!
}

// Methods stored separately
const Nexus: NexusMethods = {
    addComponent: (n: NexusT, component: ComponentData) => { ... },
    getComponentByName: (n: NexusT, name: string) => { ... },
    // ...
};
```

**Benefits:**
- Smaller component instances (less memory)
- Better for serialization (no function serialization)
- Methods can be hot-swapped at runtime
- Supports method batching/optimization

#### Proxy Layer

Components are wrapped in Proxies to provide clean API:

```typescript
// What you write:
nexus.addComponent(player);

// What happens internally:
MethodRegistry['nexus']['addComponent'](nexus, player);
```

The Proxy intercepts method calls and routes them to the registry. This gives you:
- Clean, method-based API (feels like OOP)
- Internal DOD benefits (data and methods separated)
- TypeScript autocomplete support

---

### 3. Module-Level Memory Management

For performance-critical paths, Omosuen uses **module-level memory pools**:

```typescript
// Example: Pre-allocated array for component queries
const QUERY_RESULTS: ComponentData[] = [];

function getComponentsByType(type: string): ComponentData[] {
    QUERY_RESULTS.length = 0; // Clear without allocation
    // ... populate QUERY_RESULTS ...
    return QUERY_RESULTS.slice(); // Return copy
}
```

**Rules:**
- Zero allocations in `update()` loops
- Use pools for frequently-called operations
- Components with pools **must** implement `dispose()` to clean up
- Document memory reuse patterns in comments

---

### 4. Nexus: The Universal Container

**Nexus** is the fundamental building block:

- **Scene roots** are Nexus components
- **Entities** (player, enemies) are Nexus components
- **Groups** (UI container, enemies folder) are Nexus components

```typescript
// All of these are Nexus:
const scene = await newComponent('nexus', { name: 'Level 1' });
const player = await newComponent('nexus', { name: 'Player' });
const enemies = await newComponent('nexus', { name: 'Enemies' });

// Nest them however you want:
scene.addComponent(player);
scene.addComponent(enemies);
```

**Why a single container type?**
- Simple mental model
- Easy to refactor hierarchy
- No "entity vs scene" distinction
- Flexible for different game architectures

---

### 5. Component Types

Components in Omosuen are **data + behavior bundles**:

```typescript
interface Component {
    name: string;        // Human-readable identifier
    type: string;        // Component type ('nexus', 'messenger', etc.)
    id: number;          // Unique ID (auto-assigned)
    parent: Component | null;  // Parent in hierarchy

    // Lifecycle hooks
    init?(): void;
    update?(deltaTime: number): void;
    dispose?(): void;
}
```

**Built-in Component Types:**
- `nexus` - Container/entity
- `ui-overlay` - HTML UI binding
- `data-layer` - Generic data storage
- `flag-manager` - Global flag system
- `messenger` - Message queue

---

### 6. Component Uniqueness

Components can enforce uniqueness constraints:

```typescript
enum ComponentUnique {
    FALSE = 0,  // Multiple instances allowed
    LOCAL = 1,  // Only one per parent Nexus
    GLOBAL = 2, // Only one per entire scene
}
```

**Examples:**
- `messenger`: Often LOCAL (one per entity)
- `flag-manager`: Often GLOBAL (one per scene)
- `data-layer`: Usually FALSE (multiple allowed)

When a unique component is added, existing instances are automatically disposed.

---

## System Architecture

### Game Loop Flow

```
┌─────────────────────────────────────┐
│   requestAnimationFrame(gameLoop)   │
└──────────────┬──────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│  1. Calculate Delta Time & FPS       │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│  2. Process Init Queue               │
│     (Time-budgeted, progressive)     │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│  3. Update Components                │
│     (Respects pause state)           │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│  4. Process Dispose Queue            │
│     (Batched cleanup)                │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│  5. Render (Stub)                    │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│  6. Poll Messages (Messenger system) │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│  7. Poll Flags (Flag system)         │
└──────────────┬───────────────────────┘
               │
               ▼
         (Loop repeats)
```

### Progressive Initialization

Components aren't initialized immediately. Instead:

1. `newComponent()` creates the component and queues it
2. Each frame, `processInitQueue()` runs with a time budget
3. Components are initialized progressively until queue is empty
4. Components with `loader: true` update during initialization

**Why?**
- Prevents frame drops during scene loading
- Allows loading screens to update
- Distributes initialization cost across frames

---

## Performance Patterns

### 1. Immutable Math Operations

All math operations return **new instances**:

```typescript
// CORRECT
const newPos = oldPos.add(velocity);

// WRONG (not supported)
oldPos.addInPlace(velocity);
```

**Why?**
- Prevents accidental mutations
- Easier to reason about
- Supports functional patterns

**Performance note:** For hot loops, reuse variables:

```typescript
// In update loop - reuse variable
this.position = this.position.add(this.velocity);
// Old position is GC'd, but this is still faster than in-place
```

### 2. Array Iteration Optimization

Use `indexSet()` and `indexForEach()` in hot paths:

```typescript
// SLOW (recalculates index, creates Vector objects)
array3d.forEach((cell, x, y, z) => {
    array3d.set(new Vector3D(x, y, z), newValue);
});

// FAST (direct index access)
array3d.forEach((cell, x, y, z, i) => {
    array3d.indexSet(i, newValue);
});

// FASTEST (when you don't need coordinates)
array3d.indexForEach((cell, i) => {
    array3d.indexSet(i, newValue);
});
```

### 3. Batch Component Queries

```typescript
// SLOW (searches tree multiple times)
for (let i = 0; i < 100; i++) {
    const enemy = scene.getComponentById(i);
    enemy.update();
}

// FAST (single tree traversal)
const enemies = scene.getComponentsByType('enemy', true);
enemies.forEach(enemy => enemy.update());
```

---

## Serialization

Components can be serialized to JSON:

```typescript
// Each component provides a serializer
export const DataLayerSerializer: ComponentSerializer = {
    serialize(component: ComponentData): SerializedData {
        // Convert to plain object
    },
    deserialize(data: SerializedData): ComponentData {
        // Reconstruct from plain object
    }
};
```

**Serialization includes:**
- Component data (name, type, id, custom fields)
- Child component hierarchy (for Nexus)
- Parent references (reconstructed on load)

**Excludes:**
- Methods (loaded from registry)
- Disposed components (`_disposed: true`)

---

## TypeScript Integration

### Type Safety

Components have full type information:

```typescript
// TypeScript knows nexus has addComponent()
const nexus = await newComponent('nexus', { name: 'Player' });
nexus.addComponent(child); // ✓ Autocomplete works

// TypeScript knows messenger has send()
const messenger = await newComponent('messenger', { name: 'Events' });
messenger.send('attack', { damage: 10 }); // ✓ Autocomplete works
```

### Instance Methods via Type Transformation

Methods are stored centrally but typed as instance methods:

```typescript
// Registry signature
addComponent: (n: NexusT, component: ComponentData) => void

// Transformed to instance signature
addComponent: (component: ComponentData) => void

// Type transformation via ComponentInstanceMethods<T>
```

This gives you the best of both worlds:
- IDE autocomplete
- Type safety
- DOD performance benefits

---

## Extension Points

### Creating Custom Components

1. Define the interface (extends `ComponentData`)
2. Create a builder function
3. Create a serializer
4. Register in `COMPONENT_TYPE` union and `BUILDERS` record

See [Component System](component-system.md) for details.

### Custom Method Registries

You can register custom method types for callbacks:

```typescript
registerMethod('my-callback-type', 'myCallback', (data) => {
    // Your callback logic
});
```

Used by the messenger system for dynamic listener registration.

---

## Design Tradeoffs

### What Omosuen Optimizes For

✓ Developer ergonomics
✓ Clean TypeScript integration
✓ Moderate entity counts (100-1000)
✓ Scene serialization
✓ Flexible hierarchies

### What Omosuen Doesn't Optimize For

✗ Maximum raw performance (use ECS instead)
✗ Massive entity counts (10,000+)
✗ Minimal memory footprint
✗ Pure functional programming

---

## Further Reading

- [Component System](component-system.md) - Creating custom components
- [Game Loop](game-loop.md) - Loop phases and timing
- [CLAUDE.md](../CLAUDE.md) - Development guidelines and best practices
