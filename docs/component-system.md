# Component System

Learn how to create and use custom components in Omosuen.

---

## Overview

Components are the building blocks of Omosuen. They represent **data + behavior** bundles that can be attached to Nexus containers to build game entities and systems.

---

## Component Anatomy

Every component consists of three parts:

### 1. Interface Definition

Extends `ComponentData` and defines the data structure:

```typescript
import { ComponentData } from './types';

export interface MyComponent extends ComponentData {
    type: 'my-component';
    health: number;
    maxHealth: number;
}
```

### 2. Builder Function

Creates instances of the component:

```typescript
import { ComponentOptions } from './types';
import { MyComponent } from './component';

export async function buildMyComponent(
    options: ComponentOptions
): Promise<MyComponent> {
    return {
        name: options.name,
        type: 'my-component',
        parent: null,
        unique: ComponentUnique.FALSE,
        health: 100,
        maxHealth: 100,
    };
}
```

### 3. Component Serializer

Handles saving/loading:

```typescript
import { ComponentSerializer, SerializedData } from './types';
import { MyComponent } from './component';

export const MyComponentSerializer: ComponentSerializer = {
    serialize(component: ComponentData): SerializedData {
        const c = component as MyComponent;
        return {
            type: c.type,
            name: c.name,
            health: c.health,
            maxHealth: c.maxHealth,
        };
    },

    deserialize(data: SerializedData): ComponentData {
        return {
            name: data.name as string,
            type: 'my-component',
            parent: null,
            unique: ComponentUnique.FALSE,
            health: data.health as number,
            maxHealth: data.maxHealth as number,
        };
    },
};
```

---

## Component Lifecycle

Components have three lifecycle hooks:

### init()

Called once when the component is added to the scene. Runs progressively (time-budgeted) to avoid frame drops.

```typescript
export const MyComponentMethods = {
    type: 'my-component',

    init: (component: ComponentData) => {
        const c = component as MyComponent;
        console.log(`${c.name} initialized with ${c.health} HP`);
        // Setup logic here
    },

    // ... other methods
};
```

**When to use:**
- Loading resources
- Setting up initial state
- Registering event listeners

**Note:** Init is time-budgeted. Heavy initialization should be split across multiple components or use async loading.

### update(deltaTime)

Called every frame while the game loop is running (unless paused).

```typescript
update: (component: ComponentData, deltaTime: number) => {
    const c = component as MyComponent;

    // deltaTime is in milliseconds
    // Regenerate 10 HP per second
    c.health = Math.min(c.health + 10 * (deltaTime / 1000), c.maxHealth);
}
```

**When to use:**
- Per-frame logic
- Movement and physics
- Input handling
- Animation updates

**Performance:**
- **Zero allocations** in update loops
- Use module-level pools for temporary data
- Batch operations when possible

### dispose()

Called when the component is removed or the scene unloads.

```typescript
dispose: (component: ComponentData) => {
    const c = component as MyComponent;
    console.log(`${c.name} disposed`);

    // Cleanup module-level data if used
    // Remove event listeners
    // Free WebGL resources, etc.
}
```

**When to use:**
- Cleaning up module-level pools/arrays
- Removing event listeners
- Freeing WebGL resources
- Disconnecting from external systems

**REQUIRED when:**
- Component uses module-level memory allocation
- Component registers global event listeners
- Component creates external resources

---

## Component Registration

To make your component available to the engine:

### 1. Add Type to COMPONENT_TYPE Union

In `src/component/types.ts`:

```typescript
export type COMPONENT_TYPE =
    | 'nexus'
    | 'ui-overlay'
    | 'data-layer'
    | 'flag-manager'
    | 'messenger'
    | 'my-component';  // Add your type here
```

### 2. Register Builder in BUILDERS Record

In `src/component/registry.ts`:

```typescript
import { buildMyComponent } from './my-component';

export const BUILDERS: Record<COMPONENT_TYPE, Builder> = {
    'nexus': buildNexus,
    'ui-overlay': buildUIOverlay,
    'data-layer': buildDataLayer,
    'flag-manager': buildFlagManager,
    'messenger': buildMessenger,
    'my-component': buildMyComponent,  // Register builder
};
```

### 3. Register Methods (if any)

In `src/component/registry.ts`:

```typescript
import { MyComponentMethods } from './my-component/methods';

export const MethodRegistry: Record<COMPONENT_TYPE, ComponentMethods> = {
    'nexus': Nexus,
    'ui-overlay': UIOverlay,
    'data-layer': DataLayer,
    'flag-manager': FlagManager,
    'messenger': Messenger,
    'my-component': MyComponentMethods,  // Register methods
};
```

### 4. Add to Property Allowlist

If your component has custom data fields that should be accessible via Proxy:

```typescript
export const PROPERTY_ALLOWLIST: Record<COMPONENT_TYPE, string[]> = {
    'nexus': ['components'],
    'ui-overlay': ['htmlElement', 'bindings'],
    'my-component': ['health', 'maxHealth'],  // Allow these properties
    // ...
};
```

---

## Component Options

When creating components, you can pass several options:

```typescript
const component = await newComponent('my-component', {
    name: 'Player Health',     // REQUIRED: Human-readable name
    overrideKey: 'customKey',  // Optional: Custom dispatch key
    updateOverride: 'method',  // Optional: Custom update method name
});
```

### overrideKey

Allows components to share update logic:

```typescript
// Both components use the same update logic
const enemy1 = await newComponent('enemy', {
    name: 'Goblin',
    overrideKey: 'melee-enemy'
});

const enemy2 = await newComponent('enemy', {
    name: 'Skeleton',
    overrideKey: 'melee-enemy'  // Same key!
});
```

### updateOverride

Specify a custom method name for updates:

```typescript
const component = await newComponent('my-component', {
    name: 'Special',
    updateOverride: 'customUpdate'  // Calls customUpdate() instead of update()
});
```

---

## Component Uniqueness

Components can enforce uniqueness constraints:

```typescript
export interface MyComponent extends ComponentData {
    type: 'my-component';
    unique: ComponentUnique.LOCAL;  // Set uniqueness level
}

enum ComponentUnique {
    FALSE = 0,  // Multiple instances allowed (default)
    LOCAL = 1,  // Only one per parent Nexus
    GLOBAL = 2, // Only one per entire scene
}
```

### FALSE (Multiple Instances)

```typescript
// Multiple data-layers allowed in same Nexus
const health = await newComponent('data-layer', { name: 'Health' });
const mana = await newComponent('data-layer', { name: 'Mana' });

nexus.addComponent(health);
nexus.addComponent(mana);  // Both exist
```

### LOCAL (One Per Parent)

```typescript
// Only one messenger per Nexus
const messenger1 = await newComponent('messenger', { name: 'Events' });
const messenger2 = await newComponent('messenger', { name: 'New Events' });

nexus.addComponent(messenger1);  // Added successfully
nexus.addComponent(messenger2);  // messenger1 is disposed, messenger2 takes its place
```

### GLOBAL (One Per Scene)

```typescript
// Only one flag-manager in entire scene
const flags1 = await newComponent('flag-manager', { name: 'Flags' });
const flags2 = await newComponent('flag-manager', { name: 'New Flags' });

scene.addComponent(flags1);  // Added successfully
child.addComponent(flags2);  // flags1 is disposed (even in different Nexus!)
```

---

## Custom Methods

Components can define custom methods:

### 1. Define Method Interface

```typescript
export interface MyComponentMethods extends ComponentMethods {
    type: 'my-component';

    // Custom methods
    takeDamage: (c: MyComponent, amount: number) => void;
    heal: (c: MyComponent, amount: number) => void;
}
```

### 2. Implement Methods

```typescript
export const MyComponentMethods: MyComponentMethods = {
    type: 'my-component',

    takeDamage: (c: MyComponent, amount: number) => {
        c.health = Math.max(0, c.health - amount);
        if (c.health === 0) {
            console.log(`${c.name} died!`);
        }
    },

    heal: (c: MyComponent, amount: number) => {
        c.health = Math.min(c.maxHealth, c.health + amount);
    },

    // Lifecycle hooks
    init: (component: ComponentData) => { /* ... */ },
    update: (component: ComponentData, deltaTime: number) => { /* ... */ },
    dispose: (component: ComponentData) => { /* ... */ },
};
```

### 3. Use Methods

```typescript
const health = await newComponent('my-component', { name: 'Player Health' });

// Methods are available via Proxy
health.takeDamage(25);
health.heal(10);
```

---

## File Structure

Organize components in their own directories:

```
src/component/my-component/
├── index.ts          # Re-exports
├── component.ts      # Interface definition
├── builder.ts        # Builder function
├── methods.ts        # Component methods
└── serializer.ts     # Serializer implementation
```

### index.ts

```typescript
export * from './component';
export * from './builder';
export * from './methods';
export * from './serializer';
```

---

## Best Practices

### 1. Null Check Component Creation

`newComponent()` can return `null` if creation fails:

```typescript
const component = await newComponent('my-component', { name: 'Example' });
if (!component) {
    console.error('Failed to create component!');
    return;
}
```

### 2. Use Module-Level Pools for Hot Paths

```typescript
// Module-level pool (reused across all instances)
const TEMP_RESULTS: ComponentData[] = [];

export const MyComponentMethods = {
    // Use pool in update loop
    update: (component: ComponentData, deltaTime: number) => {
        TEMP_RESULTS.length = 0;  // Clear without allocation
        // ... use TEMP_RESULTS ...
    },

    // REQUIRED: Clean up in dispose
    dispose: (component: ComponentData) => {
        TEMP_RESULTS.length = 0;
    },
};
```

### 3. Document Performance Characteristics

```typescript
/**
 * Finds all enemies within range.
 *
 * Performance: O(n) where n is number of entities.
 * Allocates array for results. Use sparingly in update loops.
 */
findEnemiesInRange(range: number): Enemy[] {
    // ...
}
```

### 4. Use TypeScript Strict Mode

```typescript
// GOOD
function process(value: number | undefined): number {
    return value ?? 0;  // Handle undefined explicitly
}

// BAD
function process(value: number): number {
    return value;  // Might receive undefined at runtime
}
```

### 5. Error Handling: Log, Don't Throw

```typescript
// GOOD
if (!target) {
    console.error('[MY COMPONENT] Target not found');
    return null;  // Graceful degradation
}

// BAD
if (!target) {
    throw new Error('Target not found');  // Crashes game
}
```

---

## Common Patterns

### Singleton Component (GLOBAL)

```typescript
export interface GameManager extends ComponentData {
    type: 'game-manager';
    unique: ComponentUnique.GLOBAL;  // Only one in scene
    score: number;
    level: number;
}

// Access anywhere in scene
const manager = scene.getComponentByType('game-manager', true);
```

### Component Groups (Multiple Instances)

```typescript
// Multiple timers on same entity
const attackTimer = await newComponent('timer', { name: 'Attack Cooldown' });
const dodgeTimer = await newComponent('timer', { name: 'Dodge Cooldown' });

entity.addComponent(attackTimer);
entity.addComponent(dodgeTimer);
```

### Loader Components

```typescript
const loadingScreen = await newComponent('ui-overlay', {
    name: 'Loading',
    loader: true  // Updates during init phase
});

scene.addComponent(loadingScreen);
```

---

## Testing Components

```typescript
// Test component creation
const component = await newComponent('my-component', { name: 'Test' });
console.assert(component !== null, 'Component created');
console.assert(component.type === 'my-component', 'Correct type');

// Test lifecycle
component.init?.(component);  // Manual init
component.update?.(component, 16.67);  // Simulate frame
component.dispose?.(component);  // Manual cleanup
```

---

## Next Steps

- Explore [Built-in Components](../README.md#built-in-components) for examples
- Learn about [Scenes](scenes.md) to organize components
- Read [Architecture](architecture.md) for design patterns
- Check [CLAUDE.md](../CLAUDE.md) for development guidelines

---

**Need Help?** Review the source code in `src/component/` for real-world examples.
