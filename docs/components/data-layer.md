# Data Layer Component

Type-safe key-value storage component with Proxy-based access.

---

## Overview

**Data Layer** provides a flexible storage system for component data with:
- Type-safe storage (string, number, boolean, Vector2D/3D/4D)
- Type enforcement (once a key is set with a type, it stays that type)
- Proxy-based property access (`dataLayer.$.health = 100`)
- Explicit method access (`DataLayer.set(dataLayer, 'health', 100)`)
- Serialization support (including Vector types)

---

## Interface

```typescript
interface DataLayerT extends ComponentData {
    type: 'data-layer';
    unique: ComponentUnique.FALSE;  // Multiple instances allowed
    storage: Map<string, DataLayerType>;
    typeMap: Map<string, string>;
    $: any;  // Proxy for property access
}

type DataLayerType =
    | string
    | number
    | boolean
    | Vector2D
    | Vector3D
    | Vector4D;
```

---

## Usage

### Basic Creation

```typescript
import { newComponent } from 'omosuen';

const dataLayer = await newComponent('data-layer', { name: 'Player Stats' });
```

### Proxy Access (Recommended)

```typescript
// Set values via Proxy
dataLayer.$.health = 100;
dataLayer.$.name = "Alice";
dataLayer.$.isAlive = true;
dataLayer.$.position = new Vector3D(10, 20, 30);

// Get values via Proxy
console.log(dataLayer.$.health);  // 100
console.log(dataLayer.$.name);    // "Alice"

// Check existence
if ('health' in dataLayer.$) {
    console.log('Has health stat');
}

// Delete values
delete dataLayer.$.tempValue;
```

### Method Access

```typescript
import { DataLayer } from 'omosuen';

// Set values
DataLayer.set(dataLayer, 'health', 100);
DataLayer.set(dataLayer, 'position', new Vector3D(0, 0, 0));

// Get values
const health = DataLayer.get(dataLayer, 'health');
const position = DataLayer.get(dataLayer, 'position');

// Check existence
if (DataLayer.has(dataLayer, 'health')) {
    console.log('Has health');
}

// Delete values
DataLayer.delete(dataLayer, 'tempValue');

// Batch operations
DataLayer.setAll(dataLayer, {
    health: 100,
    speed: 5.5,
    level: 1
});

const stats = DataLayer.getAll(dataLayer, ['health', 'speed', 'level']);
console.log(stats);  // { health: 100, speed: 5.5, level: 1 }
```

---

## Methods

### set(key, value)

Set a value with type validation and enforcement.

```typescript
DataLayer.set(dataLayer: DataLayerT, key: string, value: DataLayerType): boolean
```

**Parameters:**
- `key` - The key to set
- `value` - Value (must be valid DataLayerType)

**Returns:** `true` if successful, `false` if type validation fails

**Example:**

```typescript
DataLayer.set(dataLayer, 'health', 100);  // ✓ Sets health to 100
DataLayer.set(dataLayer, 'health', 'text');  // ✗ Fails - type mismatch (logs error)
DataLayer.set(dataLayer, 'health', 90);   // ✓ OK - same type (number)
```

**Type Enforcement:**

```typescript
// First set establishes type
dataLayer.$.score = 0;  // score is now type 'number'

// Subsequent sets must match type
dataLayer.$.score = 100;  // ✓ OK - number
dataLayer.$.score = "100";  // ✗ ERROR - type mismatch
```

### get(key)

Get a value by key.

```typescript
DataLayer.get(dataLayer: DataLayerT, key: string): DataLayerType | null
```

**Parameters:**
- `key` - The key to retrieve

**Returns:** Stored value, or `null` if key doesn't exist

**Example:**

```typescript
const health = DataLayer.get(dataLayer, 'health');
if (health !== null) {
    console.log('Health:', health);
}
```

### has(key)

Check if a key exists.

```typescript
DataLayer.has(dataLayer: DataLayerT, key: string): boolean
```

**Parameters:**
- `key` - The key to check

**Returns:** `true` if key exists, `false` otherwise

**Example:**

```typescript
if (DataLayer.has(dataLayer, 'health')) {
    console.log('Player has health stat');
}
```

### delete(key)

Delete a key-value pair.

```typescript
DataLayer.delete(dataLayer: DataLayerT, key: string): boolean
```

**Parameters:**
- `key` - The key to delete

**Returns:** `true` if key was deleted, `false` if it didn't exist

**Example:**

```typescript
DataLayer.delete(dataLayer, 'tempBonus');
```

**Note:** Deletes both the value and its type mapping. The key can be reused with a different type after deletion.

### setAll(data)

Set multiple key-value pairs at once.

```typescript
DataLayer.setAll(dataLayer: DataLayerT, data: Record<string, unknown>): void
```

**Parameters:**
- `data` - Object containing key-value pairs

**Example:**

```typescript
DataLayer.setAll(dataLayer, {
    health: 100,
    speed: 5.5,
    isAlive: true,
    position: new Vector3D(10, 20, 30)
});
```

**Note:** Invalid entries are logged as warnings and skipped. Type enforcement applies.

### getAll(keys)

Get multiple values at once.

```typescript
DataLayer.getAll(dataLayer: DataLayerT, keys: string[]): Record<string, DataLayerType>
```

**Parameters:**
- `keys` - Array of keys to retrieve

**Returns:** Object containing requested key-value pairs (missing keys are omitted)

**Example:**

```typescript
const stats = DataLayer.getAll(dataLayer, ['health', 'speed', 'nonexistent']);
console.log(stats);  // { health: 100, speed: 5.5 }
// 'nonexistent' is omitted
```

---

## Properties

### storage

Direct access to the internal Map storage.

```typescript
dataLayer.storage: Map<string, DataLayerType>
```

**Example:**

```typescript
console.log(`Data layer has ${dataLayer.storage.size} entries`);

dataLayer.storage.forEach((value, key) => {
    console.log(`${key}: ${value}`);
});
```

**Warning:** Modifying this directly bypasses type enforcement. Use methods or Proxy instead.

### typeMap

Map of keys to their type names.

```typescript
dataLayer.typeMap: Map<string, string>
```

**Example:**

```typescript
console.log('Type of health:', dataLayer.typeMap.get('health'));  // "number"
console.log('Type of position:', dataLayer.typeMap.get('position'));  // "Vector3D"
```

### $

Proxy object for property-based access.

```typescript
dataLayer.$: any
```

**Example:**

```typescript
// Cleaner than method calls
dataLayer.$.health = 100;
dataLayer.$.position = new Vector3D(0, 0, 0);

// Direct property access
const health = dataLayer.$.health;
```

---

## Allowed Types

### Primitive Types

```typescript
// String
dataLayer.$.name = "Alice";

// Number
dataLayer.$.health = 100;
dataLayer.$.speed = 5.5;

// Boolean
dataLayer.$.isAlive = true;
```

### Vector Types

```typescript
import { Vector2D, Vector3D, Vector4D } from 'omosuen';

// 2D position
dataLayer.$.position2D = new Vector2D(10, 20);

// 3D position or RGB color
dataLayer.$.position3D = new Vector3D(10, 20, 30);
dataLayer.$.color = new Vector3D(255, 128, 64);
console.log(dataLayer.$.color.r, dataLayer.$.color.g, dataLayer.$.color.b);

// 4D vector or RGBA color
dataLayer.$.rotation = new Vector4D(0, 0, 0, 1);
dataLayer.$.tint = new Vector4D(255, 255, 255, 128);
console.log(dataLayer.$.tint.a);  // Alpha channel
```

**Note:** All other types are rejected with an error message.

---

## Common Patterns

### Entity Stats

```typescript
const player = await newComponent('nexus', { name: 'Player' });

const stats = await newComponent('data-layer', { name: 'Stats' });
stats.$.health = 100;
stats.$.maxHealth = 100;
stats.$.level = 1;
stats.$.xp = 0;

player.addComponent(stats);

// Later: update stats
stats.$.health -= 25;
if (stats.$.health <= 0) {
    console.log('Player died!');
}
```

### Position and Movement

```typescript
const entity = await newComponent('nexus', { name: 'Enemy' });

const transform = await newComponent('data-layer', { name: 'Transform' });
transform.$.position = new Vector3D(100, 50, 0);
transform.$.velocity = new Vector3D(1, 0, 0);
transform.$.rotation = 0;

entity.addComponent(transform);

// Update loop
function update(deltaTime) {
    const dt = deltaTime / 1000;

    // Move based on velocity
    transform.$.position = transform.$.position.add(
        transform.$.velocity.multiply(dt)
    );
}
```

### Configuration Data

```typescript
const gameConfig = await newComponent('data-layer', { name: 'Config' });
gameConfig.$.difficulty = 1;  // 0=easy, 1=normal, 2=hard
gameConfig.$.volume = 0.8;
gameConfig.$.fullscreen = false;
gameConfig.$.language = "en";

// Save to localStorage
const configData = DataLayer.getAll(gameConfig, [
    'difficulty', 'volume', 'fullscreen', 'language'
]);
localStorage.setItem('config', JSON.stringify(configData));

// Load from localStorage
const savedConfig = JSON.parse(localStorage.getItem('config'));
DataLayer.setAll(gameConfig, savedConfig);
```

### Multiple Data Layers

```typescript
// One entity can have multiple data layers for organization
const player = await newComponent('nexus', { name: 'Player' });

const stats = await newComponent('data-layer', { name: 'Stats' });
stats.$.health = 100;
stats.$.mana = 50;

const inventory = await newComponent('data-layer', { name: 'Inventory' });
inventory.$.gold = 0;
inventory.$.keys = 0;

const position = await newComponent('data-layer', { name: 'Transform' });
position.$.x = 0;
position.$.y = 0;

player.addComponent(stats);
player.addComponent(inventory);
player.addComponent(position);
```

---

## Type Enforcement

### How It Works

```typescript
// First set determines type
dataLayer.$.health = 100;  // health is now 'number'

// Type is enforced
dataLayer.$.health = 90;    // ✓ OK
dataLayer.$.health = "90";  // ✗ ERROR: type mismatch

// Deletion resets type
delete dataLayer.$.health;

// Can now use different type
dataLayer.$.health = "healthy";  // ✓ OK (health is now 'string')
```

### Type Names

- `'string'` - String values
- `'number'` - Number values (int or float)
- `'boolean'` - Boolean values
- `'Vector2D'` - Vector2D instances
- `'Vector3D'` - Vector3D instances
- `'Vector4D'` - Vector4D instances

---

## Serialization

Data Layer serializes all data including Vectors:

```json
{
    "type": "data-layer",
    "name": "Player Stats",
    "storage": {
        "health": 100,
        "name": "Alice",
        "position": {
            "_vectorType": "Vector3D",
            "x": 10,
            "y": 20,
            "z": 30
        }
    },
    "typeMap": {
        "health": "number",
        "name": "string",
        "position": "Vector3D"
    }
}
```

Vectors are automatically reconstructed on deserialization.

---

## Best Practices

### 1. Use Descriptive Names

```typescript
// GOOD
const playerStats = await newComponent('data-layer', { name: 'Player Stats' });

// BAD
const dl1 = await newComponent('data-layer', { name: 'dl1' });
```

### 2. Organize Related Data

```typescript
// GOOD - One layer per logical group
const stats = await newComponent('data-layer', { name: 'Stats' });
stats.$.health = 100;
stats.$.mana = 50;

const inventory = await newComponent('data-layer', { name: 'Inventory' });
inventory.$.gold = 0;

// AVOID - Mixing unrelated data
const misc = await newComponent('data-layer', { name: 'Misc' });
misc.$.health = 100;
misc.$.gold = 0;
misc.$.x = 10;  // Confusing!
```

### 3. Initialize All Fields

```typescript
// GOOD - All fields initialized
const stats = await newComponent('data-layer', { name: 'Stats' });
stats.$.health = 100;
stats.$.maxHealth = 100;
stats.$.level = 1;
stats.$.xp = 0;

// AVOID - Uninitialized fields
if (stats.$.health) {  // Might be undefined!
    // ...
}
```

### 4. Use Vectors for Spatial Data

```typescript
// GOOD - Use Vector3D
dataLayer.$.position = new Vector3D(10, 20, 30);
dataLayer.$.velocity = new Vector3D(1, 0, 0);

// AVOID - Separate coordinates (harder to work with)
dataLayer.$.x = 10;
dataLayer.$.y = 20;
dataLayer.$.z = 30;
```

---

## Performance Notes

- Map-based storage is O(1) for get/set/has/delete
- Type checking happens on every set (minimal overhead)
- Proxy access has slight overhead vs direct Map access
- Use `storage` directly for maximum performance in hot loops (bypasses type checking)

---

## Next Steps

- Learn about [Vectors](../math/vector3d.md) for spatial data
- Explore [Flag Manager](flag-manager.md) for boolean flags
- See [Nexus](nexus.md) for organizing data layers

---

**Source:** [src/component/data-layer](../../src/component/data-layer/)
