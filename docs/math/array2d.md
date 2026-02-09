# Array2D

2D grid/array structure with optimized iteration.

---

## Overview

`Array2D<T>` provides a type-safe 2D array structure backed by a flat 1D array for performance. Supports coordinate-based access and optimized iteration.

---

## Constructor

```typescript
new Array2D<T>(size: Vector2D, defaultValue?: T)
```

**Parameters:**
- `size` - Dimensions of the 2D array
- `defaultValue` - Initial value for all cells (default: `-1 as T`)

**Example:**

```typescript
import { Array2D, Vector2D } from 'omosuen';

// 10x10 grid of numbers (initialized to -1)
const grid = new Array2D<number>(new Vector2D(10, 10));

// 5x5 grid of strings (initialized to "empty")
const textGrid = new Array2D<string>(new Vector2D(5, 5), "empty");
```

---

## Properties

```typescript
array2d.size: Vector2D      // Dimensions
array2d.value: T[]          // Flat array storage
array2d.width: number       // Alias for size.x
array2d.height: number      // Alias for size.y
```

---

## Methods

### set(coordinates, value)

Set a cell by 2D coordinates.

```typescript
set(coordinates: Vector2D, v: T): void
```

**Example:**

```typescript
const grid = new Array2D<number>(new Vector2D(10, 10));
grid.set(new Vector2D(5, 3), 42);
```

**Performance:** O(1), but creates Vector2D and calculates index

### indexSet(index, value)

Set a cell by flat array index (fastest).

```typescript
indexSet(i: number, v: T): void
```

**Example:**

```typescript
grid.indexSet(53, 42);  // Direct index access (fastest)
```

**Performance:** O(1), no overhead

### get(coordinates)

Get a cell by 2D coordinates.

```typescript
get(coordinates: Vector2D): T
```

**Example:**

```typescript
const value = grid.get(new Vector2D(5, 3));
```

### forEach(callback)

Iterate over all cells with coordinates.

```typescript
forEach(callback: (cell: T, x: number, y: number, index: number) => void): void
```

**Parameters:**
- `cell` - Current cell value
- `x` - X coordinate
- `y` - Y coordinate
- `index` - Flat array index

**Example:**

```typescript
grid.forEach((cell, x, y, i) => {
    console.log(`Cell at (${x}, ${y}): ${cell}`);

    // FAST - Use indexSet with provided index
    if (cell === -1) {
        grid.indexSet(i, 0);
    }
});
```

**Performance Note:** Use `indexSet(i, value)` inside forEach for best performance.

### indexForEach(callback)

Iterate over all cells (index-only, faster when coordinates not needed).

```typescript
indexForEach(callback: (cell: T, index: number) => void): void
```

**Example:**

```typescript
// Fastest iteration when coordinates not needed
grid.indexForEach((cell, i) => {
    if (cell < 0) {
        grid.indexSet(i, 0);
    }
});
```

---

## Common Patterns

### Tile Map

```typescript
// Create 20x15 tilemap
const tilemap = new Array2D<number>(new Vector2D(20, 15), 0);

// Set tiles
tilemap.set(new Vector2D(0, 0), 1);   // Grass
tilemap.set(new Vector2D(1, 0), 2);   // Stone
tilemap.set(new Vector2D(2, 0), 3);   // Water

// Get tile at position
const tile = tilemap.get(new Vector2D(5, 5));
```

### Pathfinding Grid

```typescript
const grid = new Array2D<number>(new Vector2D(50, 50), 0);

// Mark obstacles
grid.set(new Vector2D(10, 10), -1);  // Wall
grid.set(new Vector2D(10, 11), -1);  // Wall

// Check if cell is walkable
function isWalkable(x, y) {
    const cell = grid.get(new Vector2D(x, y));
    return cell >= 0;
}
```

### Collision Map

```typescript
const collisionMap = new Array2D<boolean>(new Vector2D(100, 100), false);

// Mark collision areas
collisionMap.set(new Vector2D(25, 25), true);

// Check collision
function checkCollision(x, y) {
    return collisionMap.get(new Vector2D(x, y));
}
```

### Initialize Grid

```typescript
const grid = new Array2D<number>(new Vector2D(10, 10));

// Fill with pattern
grid.forEach((cell, x, y, i) => {
    // Checkerboard pattern
    grid.indexSet(i, (x + y) % 2);
});
```

### Neighbor Search

```typescript
function getNeighbors(x, y) {
    const neighbors = [];
    const offsets = [
        [-1, 0], [1, 0], [0, -1], [0, 1]  // Left, Right, Up, Down
    ];

    offsets.forEach(([dx, dy]) => {
        const nx = x + dx;
        const ny = y + dy;

        if (nx >= 0 && nx < grid.width && ny >= 0 && ny < grid.height) {
            neighbors.push(grid.get(new Vector2D(nx, ny)));
        }
    });

    return neighbors;
}
```

---

## Performance Optimization

### Use indexSet() in forEach()

```typescript
// SLOW - Recalculates index every time
grid.forEach((cell, x, y, i) => {
    grid.set(new Vector2D(x, y), newValue);  // Creates Vector2D, recalculates index
});

// FAST - Direct index access
grid.forEach((cell, x, y, i) => {
    grid.indexSet(i, newValue);  // No overhead
});

// FASTEST - Direct array access
grid.forEach((cell, x, y, i) => {
    grid.value[i] = newValue;  // Direct assignment
});
```

### Use indexForEach() When Possible

```typescript
// When you don't need coordinates:
grid.indexForEach((cell, i) => {
    if (cell === -1) {
        grid.indexSet(i, 0);
    }
});
```

---

## Storage Format

Internally stored as flat array in row-major order:

```
2D Grid:      Flat Array:
[0,0] [1,0]   [0,0] [1,0] [0,1] [1,1]
[0,1] [1,1]

Index = y * width + x
```

---

## Next Steps

- See [Array3D](array3d.md) for 3D arrays
- See [Vector2D](vector2d.md) for 2D coordinates
- Learn about [Data Layer](../components/data-layer.md) for component storage

---

**Source:** [src/math/index.ts:177-235](../../src/math/index.ts)
