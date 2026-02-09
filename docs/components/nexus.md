# Nexus Component

The fundamental container component for building hierarchical structures in Omosuen.

---

## Overview

**Nexus** is the universal container type in Omosuen. It serves as:
- Scene roots
- Game entities (player, enemies, NPCs)
- Logical groups (UI container, level geometry)
- Component organizers

All Nexus components can contain child components, allowing flexible hierarchies.

---

## Interface

```typescript
interface NexusT extends ComponentData {
    type: 'nexus';
    unique: ComponentUnique.FALSE;  // Multiple instances allowed
    components: ComponentData[];    // Child components
    paused: boolean;                // Pause state
}
```

---

## Usage

### Basic Creation

```typescript
import { newComponent } from 'omosuen';

const nexus = await newComponent('nexus', { name: 'My Container' });
```

### Building Hierarchies

```typescript
// Create scene
const scene = await newComponent('nexus', { name: 'Level 1' });

// Create entities
const player = await newComponent('nexus', { name: 'Player' });
const enemy = await newComponent('nexus', { name: 'Goblin' });

// Add to scene
scene.addComponent(player);
scene.addComponent(enemy);
```

### Nested Structures

```typescript
// Scene
//  ├── Player
//  │   ├── Health (data-layer)
//  │   └── Inventory (data-layer)
//  └── Enemies
//      ├── Goblin 1
//      ├── Goblin 2
//      └── Boss

const scene = await newComponent('nexus', { name: 'Level' });

// Player with components
const player = await newComponent('nexus', { name: 'Player' });
const health = await newComponent('data-layer', { name: 'Health' });
const inventory = await newComponent('data-layer', { name: 'Inventory' });
player.addComponent(health);
player.addComponent(inventory);

// Enemy group
const enemies = await newComponent('nexus', { name: 'Enemies' });
const goblin1 = await newComponent('nexus', { name: 'Goblin 1' });
const goblin2 = await newComponent('nexus', { name: 'Goblin 2' });
const boss = await newComponent('nexus', { name: 'Boss' });
enemies.addComponent(goblin1);
enemies.addComponent(goblin2);
enemies.addComponent(boss);

// Add to scene
scene.addComponent(player);
scene.addComponent(enemies);
```

---

## Methods

### addComponent(component)

Add a single child component to this Nexus.

```typescript
nexus.addComponent(component: ComponentData): void
```

**Parameters:**
- `component` - Component to add (sets `component.parent = nexus`)

**Example:**

```typescript
const parent = await newComponent('nexus', { name: 'Parent' });
const child = await newComponent('nexus', { name: 'Child' });

parent.addComponent(child);
console.log(child.parent === parent); // true
```

**Uniqueness handling:**
- If component has `unique: LOCAL`, disposes existing components of same type in this Nexus
- If component has `unique: GLOBAL`, disposes ALL instances in entire scene hierarchy

### addComponents(components)

Add multiple child components at once.

```typescript
nexus.addComponents(
    components: ComponentData[] | Record<string, ComponentData>
): void
```

**Parameters:**
- `components` - Array or object of components to add

**Examples:**

```typescript
// Array
const components = [child1, child2, child3];
nexus.addComponents(components);

// Object
const components = {
    player: playerNexus,
    enemy: enemyNexus,
    ui: uiNexus
};
nexus.addComponents(components);
```

### getComponentById(id, recursive?)

Find a component by its unique ID.

```typescript
nexus.getComponentById(
    id: number,
    recursive?: boolean
): ComponentData | null
```

**Parameters:**
- `id` - Component ID to search for
- `recursive` - If true, searches child Nexus components recursively (default: false)

**Returns:** Component if found, null otherwise

**Example:**

```typescript
const component = nexus.getComponentById(42);
if (component) {
    console.log(`Found: ${component.name}`);
}

// Search entire hierarchy
const deepComponent = nexus.getComponentById(99, true);
```

### getComponentByType(type, recursive?)

Find the first component of a specific type.

```typescript
nexus.getComponentByType(
    type: string,
    recursive?: boolean
): ComponentData | null
```

**Parameters:**
- `type` - Component type to search for (`'nexus'`, `'messenger'`, etc.)
- `recursive` - If true, searches child Nexus components recursively (default: false)

**Returns:** First matching component, or null if none found

**Example:**

```typescript
// Find messenger in immediate children
const messenger = nexus.getComponentByType('messenger');

// Find messenger anywhere in hierarchy
const deepMessenger = nexus.getComponentByType('messenger', true);
```

### getComponentsByType(type, recursive?)

Find all components of a specific type.

```typescript
nexus.getComponentsByType(
    type: string,
    recursive?: boolean
): ComponentData[]
```

**Parameters:**
- `type` - Component type to search for
- `recursive` - If true, searches child Nexus components recursively (default: false)

**Returns:** Array of matching components (empty if none found)

**Example:**

```typescript
// Get all data-layers in immediate children
const layers = nexus.getComponentsByType('data-layer');

// Get all enemies in entire scene
const enemies = scene.getComponentsByType('enemy', true);
enemies.forEach(enemy => {
    console.log(`Found enemy: ${enemy.name}`);
});
```

**Performance:** O(n) where n is number of components searched. Optimized to avoid intermediate allocations.

### getComponentByName(name, recursive?)

Find the first component with a specific name.

```typescript
nexus.getComponentByName(
    name: string,
    recursive?: boolean
): ComponentData | null
```

**Parameters:**
- `name` - Component name to search for
- `recursive` - If true, searches child Nexus components recursively (default: false)

**Returns:** First matching component, or null if none found

**Example:**

```typescript
const player = scene.getComponentByName('Player');
const boss = scene.getComponentByName('Boss', true);
```

### getComponentsByName(name, recursive?)

Find all components with a specific name.

```typescript
nexus.getComponentsByName(
    name: string,
    recursive?: boolean
): ComponentData[]
```

**Parameters:**
- `name` - Component name to search for
- `recursive` - If true, searches child Nexus components recursively (default: false)

**Returns:** Array of matching components (empty if none found)

**Example:**

```typescript
// Find all components named "Health"
const healths = scene.getComponentsByName('Health', true);
```

### getComponentByTypeAndName(type, name, recursive?)

Find the first component matching both type and name.

```typescript
nexus.getComponentByTypeAndName(
    type: string,
    name: string,
    recursive?: boolean
): ComponentData | null
```

**Parameters:**
- `type` - Component type
- `name` - Component name
- `recursive` - If true, searches recursively (default: false)

**Returns:** First matching component, or null if none found

**Example:**

```typescript
const playerHealth = scene.getComponentByTypeAndName(
    'data-layer',
    'Player Health',
    true
);
```

### getComponentsByTypeAndName(type, name, recursive?)

Find all components matching both type and name.

```typescript
nexus.getComponentsByTypeAndName(
    type: string,
    name: string,
    recursive?: boolean
): ComponentData[]
```

**Parameters:**
- `type` - Component type
- `name` - Component name
- `recursive` - If true, searches recursively (default: false)

**Returns:** Array of matching components

**Example:**

```typescript
const timers = scene.getComponentsByTypeAndName('timer', 'Cooldown', true);
```

### dispose()

Recursively dispose this Nexus and all its children.

```typescript
nexus.dispose(): void
```

**Effect:**
- Calls `dispose()` on all child components (depth-first)
- Clears the `components` array
- Marks this Nexus as `_disposed = true`

**Example:**

```typescript
// Dispose entire scene hierarchy
scene.dispose();

// All children are also disposed
console.log(player._disposed); // true
console.log(enemy._disposed); // true
```

---

## Properties

### components

Direct access to child components array.

```typescript
nexus.components: ComponentData[]
```

**Example:**

```typescript
console.log(`${nexus.name} has ${nexus.components.length} children`);

nexus.components.forEach(child => {
    console.log(` - ${child.name}`);
});
```

**Warning:** Modifying this array directly bypasses uniqueness checks. Use `addComponent()` instead.

### paused

Pause state for this Nexus.

```typescript
nexus.paused: boolean
```

**Note:** Currently unused by the engine. Reserved for future pause functionality.

---

## Common Patterns

### Entity Pattern

```typescript
// Entity = Nexus + Data Components
const player = await newComponent('nexus', { name: 'Player' });

// Add data components
const health = await newComponent('data-layer', { name: 'Health' });
health.$.value = 100;
health.$.maxValue = 100;

const position = await newComponent('data-layer', { name: 'Position' });
position.$.x = 0;
position.$.y = 0;

player.addComponent(health);
player.addComponent(position);
```

### Grouping Pattern

```typescript
// Use Nexus as logical container
const ui = await newComponent('nexus', { name: 'UI' });

const hud = await newComponent('ui-overlay', { name: 'HUD' });
const menu = await newComponent('ui-overlay', { name: 'Menu' });

ui.addComponent(hud);
ui.addComponent(menu);

scene.addComponent(ui);
```

### Dynamic Entity Creation

```typescript
// Spawn entities at runtime
async function spawnEnemy(x, y) {
    const enemy = await newComponent('nexus', { name: 'Goblin' });

    const position = await newComponent('data-layer', { name: 'Position' });
    position.$.x = x;
    position.$.y = y;

    enemy.addComponent(position);
    enemyContainer.addComponent(enemy);

    return enemy;
}

// Spawn 10 enemies
for (let i = 0; i < 10; i++) {
    await spawnEnemy(i * 10, 0);
}
```

### Query and Process Pattern

```typescript
// Find all enemies and update them
const enemies = scene.getComponentsByType('enemy', true);

enemies.forEach(enemy => {
    const health = enemy.getComponentByType('data-layer');
    if (health && health.$.value <= 0) {
        enemy.dispose();
    }
});
```

---

## Performance Notes

### Query Performance

- `getComponentBy*()` methods are O(n) where n is the number of components
- Recursive queries traverse entire hierarchy
- Use non-recursive queries when possible
- Cache query results if used multiple times

```typescript
// BAD - Queries every frame
update: (component, deltaTime) => {
    const enemies = scene.getComponentsByType('enemy', true);
    enemies.forEach(e => { /* ... */ });
}

// GOOD - Query once, cache result
let enemies = [];

init: (component) => {
    enemies = scene.getComponentsByType('enemy', true);
}

update: (component, deltaTime) => {
    enemies.forEach(e => { /* ... */ });
}
```

### Component Count

Nexus is optimized for moderate entity counts (100-1000). For larger scenes:

- Group entities spatially
- Use visibility culling
- Limit recursive queries
- Consider breaking into multiple scenes

---

## Best Practices

### 1. Use Descriptive Names

```typescript
// GOOD
const playerInventory = await newComponent('nexus', { name: 'Player Inventory' });

// BAD
const n1 = await newComponent('nexus', { name: 'n1' });
```

### 2. Organize by Purpose

```typescript
// Scene structure
const scene = await newComponent('nexus', { name: 'Level 1' });

const entities = await newComponent('nexus', { name: 'Entities' });
const ui = await newComponent('nexus', { name: 'UI' });
const systems = await newComponent('nexus', { name: 'Systems' });

scene.addComponent(entities);
scene.addComponent(ui);
scene.addComponent(systems);
```

### 3. Cache Frequently Used Components

```typescript
// Cache player reference
const player = scene.getComponentByName('Player', true);

// Use cached reference
function damagePlayer(amount) {
    const health = player.getComponentByType('data-layer');
    health.$.value -= amount;
}
```

### 4. Clean Up Properly

```typescript
// Dispose removes from parent and cleans up children
function removeEnemy(enemy) {
    enemy.dispose();
    // enemy is now marked _disposed
    // Will be removed from parent in next disposal pass
}
```

---

## Serialization

Nexus components serialize their entire hierarchy:

```typescript
import { serializeComponentRecursive } from 'omosuen';

const scene = await newComponent('nexus', { name: 'Level 1' });
// ... build scene ...

// Serialize entire hierarchy
const data = serializeComponentRecursive(scene);
const json = JSON.stringify(data, null, 2);

// Save to file
localStorage.setItem('scene', json);
```

**Serialized format:**

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
            "components": [/* player's children */]
        },
        {
            "type": "nexus",
            "name": "Enemy",
            "id": 2,
            "components": []
        }
    ]
}
```

---

## Next Steps

- Learn about [other components](../../README.md#built-in-components)
- Explore [Component System](../component-system.md) for creating custom components
- See [Scenes](../scenes.md) for scene management

---

**Source:** [src/component/nexus](../../src/component/nexus/)
