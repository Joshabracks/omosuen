# Omosuen Engine - Best Practices Guide

**Version:** 0.0.0 (Pre-Release)
**Last Updated:** 2026-02-06

This document outlines high-level best practices and standards for internal development of the Omosuen engine. Following these guidelines ensures consistency, maintainability, and optimal performance across the codebase.

---

## Table of Contents

1. [Architecture Philosophy](#architecture-philosophy)
2. [Component Development Standards](#component-development-standards)
3. [Component Lifecycle & Memory Management](#component-lifecycle--memory-management)
4. [Math Library Standards](#math-library-standards)
5. [Serialization Requirements](#serialization-requirements)
6. [Error Handling Philosophy](#error-handling-philosophy)
7. [Performance Optimization Guidelines](#performance-optimization-guidelines)
8. [Export Strategy](#export-strategy)
9. [Code Quality Standards](#code-quality-standards)
10. [Summary Checklist](#summary-checklist)

---

## Architecture Philosophy

### Hierarchical Components Over ECS

Omosuen uses a **hierarchical component pattern** rather than pure Entity-Component-System (ECS) architecture. This design prioritizes **developer experience and accessibility** over absolute performance maximization.

**Why Hierarchical Components?**
- **Lower Learning Curve**: More intuitive than ECS for novice developers
- **Familiar Mental Model**: Parent-child relationships map naturally to scene organization
- **Hidden Optimizations**: Internal data-oriented optimizations without exposing DOD complexity

**Inspiration from Godot**
- **Composition over Inheritance**: Components are building blocks that can be combined
- **Scene-as-Component**: Nexus acts as a container for reusable component groups
- **Built-in Patterns**: Common patterns (serialization, disposal) baked into the engine

### Internal vs External Complexity

**External (Developer-Facing)**: Simple, intuitive hierarchical component API
**Internal (Engine-Level)**: Data-oriented optimizations, cache-friendly memory layouts, batch processing

This separation allows excellent performance while remaining approachable for developers of all skill levels.

### Data-Oriented Design at Scale

For **massive games** with 10,000+ entities, Omosuen uses **data-oriented design (DOD)** that separates data from functionality.

**Why DOD?**
- **Memory Efficiency**: Zero method overhead per instance (traditional OOP wastes 75+ MB at 50,000 entities)
- **GC Performance**: Shorter garbage collection pauses (<10ms vs 50-200ms), fewer frame drops
- **CPU Optimization**: Monomorphic call sites enable aggressive inlining (10-20% faster update loops)

**When to Use DOD**
| Entity Count | Pattern | Reason |
|--------------|---------|--------|
| < 1,000 | Either | Performance difference negligible |
| 1,000 - 5,000 | Prefer DOD | Noticeable GC improvements |
| 5,000 - 10,000 | Use DOD | Significant performance gains |
| 10,000+ | **Must use DOD** | Required for 60fps |

**Component Proxy Wrapper**: Automatically wraps components for ergonomic method calls (`component.method()`) while `ComponentMethod` registry allows direct static calls for maximum performance in game loops.

---

## Component Development Standards

### File Structure

All components follow a **3-file data-oriented design pattern** that separates data from functionality:

```
src/component/{component-name}/
├── index.ts          # Re-exports data and methods
├── data.ts           # Pure interface + builder + serializer
└── methods.ts        # Static methods object
```

**Key Principle**: Data and functionality are separated for optimal performance at scale (10,000+ entities).

### Naming Conventions

**Component Types**: `kebab-case` (e.g., `"nexus"`, `"sprite"`, `"enemy-spawner"`)
**Component Instances**: Title Case recommended (e.g., `"Player Inventory"`, `"Boss Spawner"`)
**Module Constants**: `UPPER_SNAKE_CASE`
**Functions/Variables**: `camelCase`

### Component Registration

Every new component requires **four registrations** in `src/component/registry.ts`:

1. Add to `COMPONENT_TYPE` union type (in types.ts)
2. Import and add methods object to `ComponentMethod` record
3. Import and add builder function to `BUILDERS` record
4. Import and add `PROPERTY_ALLOWLIST` to `PROPERTY_ALLOWLIST` record

### Required Exports

Each component module must export:

**From data.ts:**
- Pure data interface extending `ComponentData` and `ComponentInstanceMethods<T>`
- Builder function returning pure data instances (no attached methods)
- ComponentSerializer with `serialize()` and `deserialize()` functions
- `PROPERTY_ALLOWLIST` array listing component-specific data properties

**From methods.ts:**
- Static methods object with all component methods (methods take component as first parameter)
- Methods interface for TypeScript typing (e.g., `SpriteMethods extends ComponentMethods`)

**From index.ts:**
- Re-export everything using `export * from './data'` and `export * from './methods'`

### Component Proxy Wrapper

Each component returned from `newComponent()` is automatically wrapped in a **Proxy** that provides type-safe, ergonomic method calls. The Proxy intercepts property access to distinguish between data properties and methods, routing method calls to the `ComponentMethod` registry while allowing direct access to allowlisted data properties.

**Ergonomic API (Proxy-wrapped):**
- Call methods directly on component: `component.methodName(args)`
- Automatic routing to `ComponentMethod[type][methodName](component, args)`
- Type-safe with full IntelliSense via `ComponentInstanceMethods<T>`
- Best for: Setup/initialization, event handlers, one-off operations, readable code

**Performance-Critical API (Direct Static Calls):**
- Bypass Proxy: `ComponentMethod[component.type].methodName(component, args)`
- No Proxy overhead, monomorphic call sites
- Best for: Game loops (60fps), batch processing, 1000+ entities/frame, maximum performance

**Property Access**: Data properties listed in `PROPERTY_ALLOWLIST` can be accessed directly (e.g., `nexus.components`, `nexus.paused`).

---

## Component Lifecycle & Memory Management

### Lifecycle Hooks

- **`init()`**: Called when component is created/added to scene
- **`update()`**: Called every frame during game loop
- **`dispose()`**: Called when component is removed or destroyed

### Module-Level Data Pattern

To **avoid garbage collection spikes**, allocate frequently-used data at module level rather than within component instances.

**Benefits:**
- Avoids repeated allocation/deallocation cycles
- Prevents GC pauses during gameplay
- Improves cache locality for hot data

**Pattern**: Component stores an index into module-level arrays/pools. Use `init()` to allocate slot, `dispose()` to release it.

### Disposal Requirements

**`dispose()` is REQUIRED when:**
- Component allocates slots in module-level pools/arrays
- Component holds references to shared resources
- Component registers event listeners or callbacks
- Component manages WebGL buffers or native resources

**`dispose()` is OPTIONAL when:**
- Component only uses instance-level data
- No external resources managed
- Garbage collector can safely handle cleanup

**Disposal Order**: Nexus performs **depth-first disposal** (children before parent).

### Unique Components

Set `unique: true` only for components where multiple instances would cause conflicts:
- Map rendering components
- Global state managers (FlagManager)
- Camera controllers (single active camera)
- Audio mixers (central audio management)

**Behavior**: Adding a unique component automatically disposes any existing component of the same type in that Nexus.

### Null Checking

**Always check for `null` after `newComponent()` calls**. Component creation can fail gracefully, returning `null` instead of throwing exceptions. Handle failures with warnings and fallbacks.

---

## Math Library Standards

### Immutability

**All Vector methods return new instances** rather than mutating the original. This prevents accidental mutation bugs and makes code easier to reason about.

### Vector Usage Guidelines

**Vector3D**: Use for 3D positions in world space (x, y, z coordinates)
**Vector2D**: Use for 2D positions on screen (x, y screen coordinates)
**Color Representation**: Both Vector3D and Vector4D support color getters (r, g, b, a properties)

### Array Classes

**Array2D & Array3D**: Use for small to medium datasets or frequently updated data
**Array3Dc (Compressed)**: Use for large datasets with repeating values that are rarely updated

**Array3Dc Best For:**
- Map/terrain data
- Voxel worlds
- Large 3D grids with repetitive patterns
- Data that is mostly read, rarely written

**Array3Dc Characteristics:**
- O(n) compression time
- O(log n) read access
- O(1) dirty writes (tracked in dirty map)
- Automatic flushing when dirty threshold reached

### Performance Best Practices

1. **Use `indexSet()` in `forEach()` loops** (2-3x faster than `set()`)
2. **Use `indexForEach()` when coordinates not needed** (fastest iteration)
3. **Avoid `set()` in hot loops** (allocates Vector instances)
4. **Prefer direct array access** (`array3D.value[i]`) when possible

---

## Serialization Requirements

### All Components Must Be Serializable

Every component must implement a `ComponentSerializer` to support save/load functionality.

**Why Critical:**
- Save game state to storage
- Network synchronization (future)
- Scene cloning and prefab systems
- Undo/redo functionality

### Serialization Location

Place serialization code in component's **data.ts** file alongside interface and builder function. See `src/component/nexus/data.ts` for reference pattern.

### What to Serialize

**DO Serialize:**
- Component type and name
- Game-relevant state (position, health, inventory items)
- Configuration data (speed, damage, AI parameters)
- Asset references (texture paths, audio file names)

**DO NOT Serialize:**
- Computed/derived values (calculate in `init()` instead)
- Temporary buffers or caches
- WebGL contexts or native resources
- Function references or closures

### Nested Components

For components containing other components (like Nexus), the main serializer handles recursion automatically. Component serializers only need to serialize their own data and child references.

### Validation

**Deserialize functions must validate data** and throw descriptive errors for corrupted save data. Check required fields, types, and value ranges before constructing components.

---

## Error Handling Philosophy

### Log, Don't Throw

The engine avoids throwing exceptions in favor of **logging errors** and **returning null** or **safe defaults**.

**Rationale:**
- Games should degrade gracefully, not crash
- Developers can check logs to debug issues
- Missing assets or failed operations shouldn't halt the entire game

### Error Pattern

Functions that can fail should:
1. Log error with descriptive message using `console.error()`
2. Return `null` or safe default value
3. Allow caller to handle failure gracefully

### Logging Levels

- **`console.error()`**: Critical errors (component creation failed, resource not found)
- **`console.warn()`**: Warnings (deprecated API usage, performance concerns)
- **`console.info()`**: Informational (component initialized, scene loaded)
- **`console.log()`**: Debug output (verbose state changes)

**Future Enhancement**: Log suppression, filtering, and custom logging handlers.

### When to Throw Exceptions

Reserve exceptions for **truly unrecoverable errors**:
- Invalid engine configuration (e.g., `maxMemoryThreshold` < 0)
- Serialization format errors (corrupted save data)
- Programmer errors (div by zero, calling methods on disposed components)

### Developer Responsibility

Developers using the engine should check for `null` returns and handle failures with appropriate fallbacks.

---

## Performance Optimization Guidelines

### Critical Rules

- **NO allocations in `update()` loops** - use module-level pools
- **Use `indexSet()` over `set()` in hot loops** (2-3x faster)
- **Use `indexForEach()` when coordinates not needed**
- **Batch process components** (avoid recursive searches)
- **Prefer linear memory access patterns** for cache efficiency

### Module-Level Pooling

For frequently allocated objects, use module-level object pools:
- Pre-allocate pool at module level
- Acquire objects from pool instead of `new`
- Return objects to pool in `dispose()`
- Set reasonable pool size limits

### Batch Processing

Process components in batches when possible. Get all components of a type once, then iterate. Avoid nested recursive searches in tight loops.

### Cache-Friendly Patterns

Favor linear memory access over random access:
- Iterate arrays sequentially
- Store related data contiguously
- Use TypedArrays for numeric data (Float32Array, etc.)
- Process data in order when possible

### Document Performance

Include performance notes in code:
- Document Big-O complexity for algorithms
- Note performance trade-offs in comments
- Include inline warnings for slow operations
- Specify when to use alternative approaches

### Performance-Critical vs Ergonomic Code Paths

**Use Direct Static Method Calls (bypass Proxy):**
- Syntax: `ComponentMethod[component.type].methodName(component, args)`
- Game update loops (60fps)
- Batch operations on 1000+ entities
- Maximum performance required

**Use Proxy-Wrapped Method Calls:**
- Syntax: `component.methodName(args)`
- Setup and initialization
- Event handlers
- One-off operations
- Readability matters more than performance

---

## Nexus Hierarchy Best Practices

### Scene Structure

Engine loads an **`activeScene`**, which is a root-level Nexus (a Nexus with no parent). Organize game content as children of this root scene.

### Component Organization

Organize components into **logical groupings** using Nexus hierarchies:
- Player hierarchy (sprite, controller, inventory, health)
- Enemy hierarchy (can be instantiated multiple times)
- UI hierarchy (HUD, menus, dialogs)
- Level hierarchy (map, spawners, triggers)

### Depth Considerations

**No enforced depth limits**: Hierarchy supports unlimited nesting.
**Performance**: Avoid unnecessary deep nesting. Flatter hierarchies (3-4 levels) are more performant for queries and updates.

### Component Communication

**Three approaches:**

1. **Parent/Child Traversal**: Use `Component.parent` and `Nexus.getComponent*()` methods
2. **Data Management System**: Global flags, flat data objects, message listeners (pub/sub)
3. **Direct References**: Hold direct references to other components (use sparingly, creates tight coupling)

Choose based on coupling needs and scope of communication.

---

## Export Strategy

### Flat Exports at Engine Level

All public APIs should be exported as **flat exports** from `src/index.ts`. This enables tree-shaking and provides clean import paths.

**Pattern**: Export all public interfaces, classes, functions, and types at top level. No nested namespaces required for imports.

### Tree-Shaking

Named exports enable tree-shaking for module bundlers. Developers can import only what they need, reducing bundle size.

### Backward Compatibility

Maintain `Omosuen` default export for UMD builds (browser script tags). Support both UMD and ES module imports.

**UMD**: Browser script tags auto-export to `window.Omosuen`
**ES Modules**: Named imports from `'omosuen'` package

---

## Code Quality Standards

### TypeScript Strict Mode

All code must compile with TypeScript strict mode enabled:
- `strict: true`
- `noImplicitAny: true`
- `strictNullChecks: true`
- `strictFunctionTypes: true`

**No `any` types** - use `unknown` or specific types.
**Explicit return types** on all functions.

### Comprehensive JSDoc Comments

Document all public APIs with JSDoc:
- Include `@param` descriptions for all parameters
- Include `@returns` description
- Include `@example` showing typical usage
- Document performance characteristics when relevant

### Prefer Simplicity

Follow Godot's philosophy: **"Use the simplest code possible"**

Write code that:
- Clearly expresses intent
- Avoids unnecessary abstraction
- Uses straightforward algorithms
- Is easy to understand and maintain

### Comment Philosophy

**Comment WHY, not WHAT**:
- Code explains what is happening (self-documenting)
- Comments explain why decisions were made
- Note performance considerations
- Warn about edge cases or gotchas

### Linting

Follow ESLint rules consistently. Run `npm run lint` before commits.

**Key Rules:**
- No unused variables
- Consistent naming conventions
- No `any` types
- Explicit return types
- Proper async/await usage

### Testing (Future)

Plan for:
- Unit tests for math utilities
- Component lifecycle tests
- Serialization round-trip tests
- Performance benchmarks

---

## Summary Checklist

### File Structure (Data-Oriented Design)

- [ ] Component directory created at `src/component/{component-name}/`
- [ ] **data.ts** created with:
  - [ ] Pure data interface extending `ComponentData` and `ComponentInstanceMethods<T>`
  - [ ] Builder function returning pure data only (no attached methods)
  - [ ] ComponentSerializer with `serialize()` and `deserialize()` functions
  - [ ] `PROPERTY_ALLOWLIST` array exported listing component-specific data properties
  - [ ] All four exported
- [ ] **methods.ts** created with:
  - [ ] Static methods object with all component methods
  - [ ] Methods interface exported for TypeScript typing (e.g., `SpriteMethods extends ComponentMethods`)
  - [ ] All exported
- [ ] **index.ts** re-exports both files: `export * from './data'`, `export * from './methods'`

### Component Registration (registry.ts)

- [ ] Component type is `kebab-case` and added to `COMPONENT_TYPE` union (in types.ts)
- [ ] Static methods object imported and added to `ComponentMethod` record
- [ ] Builder function imported and added to `BUILDERS` record
- [ ] `PROPERTY_ALLOWLIST` imported and added to `PROPERTY_ALLOWLIST` record

### Implementation Details

- [ ] Static methods take component as **first parameter**: `methodName(component, ...args)`
- [ ] Methods use `ComponentMethod[c.type]` for type-specific lookups when needed
- [ ] `dispose()` method uses static dispatch pattern (see Nexus.dispose in `src/component/nexus/methods.ts`)
- [ ] Module-level data is properly cleaned up in `dispose()`
- [ ] `unique` flag is set correctly (false for most components)

### Lifecycle & Memory

- [ ] `init()` allocates module-level data slots if needed
- [ ] `update()` contains no allocations (uses module-level pools)
- [ ] `dispose()` releases all module-level data slots
- [ ] `dispose()` cleans up event listeners and external resources

### Serialization

- [ ] Serializer placed in **data.ts** file
- [ ] `serialize()` exports all game-relevant state
- [ ] `deserialize()` validates data and throws descriptive errors
- [ ] Computed values not serialized (recalculated in `init()`)
- [ ] Asset references serialized as paths/names

### Error Handling

- [ ] Null checks performed after `newComponent()` calls
- [ ] Errors logged with `console.error()` instead of throwing
- [ ] Functions return `null` or safe defaults on failure
- [ ] Exceptions only thrown for unrecoverable errors

### Performance

- [ ] Performance-critical code documented with inline notes
- [ ] Big-O complexity noted for non-trivial algorithms
- [ ] `indexSet()` used in `forEach()` loops
- [ ] `indexForEach()` used when coordinates not needed
- [ ] No allocations in `update()` loops
- [ ] Module-level pooling for frequently allocated objects

### Documentation & Quality

- [ ] Public APIs have comprehensive JSDoc comments
- [ ] Code examples in docs use ergonomic Proxy-wrapped syntax for clarity
- [ ] Component exported from `src/index.ts` for flat exports
- [ ] Code passes TypeScript strict mode compilation
- [ ] Code passes `npm run lint`
- [ ] CLI unit tests pass: `npm run test:cli`
- [ ] Prefer simplicity and readability over cleverness

---

**Happy coding! Build something amazing with Omosuen.**
