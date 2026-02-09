# Array3D

3D voxel/array structure with optimized iteration.

---

## Overview

`Array3D<T>` provides a type-safe 3D array structure backed by a flat 1D array for performance. Ideal for voxel data, 3D grids, and volumetric storage.

---

## Constructor

```typescript
new Array3D<T>(size: Vector3D, defaultValue?: T)
```

**Parameters:**
- `size` - Dimensions of the 3D array (width, depth, height)
- `defaultValue` - Initial value for all cells (default: `-1 as T`)

**Example:**

```typescript
import { Array3D, Vector3D } from 'omosuen';

// 10x10x10 voxel grid
const voxels = new Array3D<number>(new Vector3D(10, 10, 10), 0);

// 5x5x5 grid with custom default
const chunks = new Array3D<string>(new Vector3D(5, 5, 5), "air");
```

---

## Properties

```typescript
array3d.size: Vector3D      // Dimensions
array3d.value: T[]          // Flat array storage
array3d.width: number       // Alias for size.x
array3d.depth: number       // Alias for size.y
array3d.height: number      // Alias for size.z
```

---

## Methods

### set(coordinates, value)

Set a cell by 3D coordinates.

```typescript
set(coordinates: Vector3D, v: T): void
```

**Example:**

```typescript
const voxels = new Array3D<number>(new Vector3D(10, 10, 10));
voxels.set(new Vector3D(5, 3, 2), 42);
```

**Performance:** O(1), but creates Vector3D and calculates index

### indexSet(index, value)

Set a cell by flat array index (fastest).

```typescript
indexSet(i: number, v: T): void
```

**Example:**

```typescript
voxels.indexSet(532, 42);  // Direct index access (fastest)
```

**Performance:** O(1), no overhead

### get(coordinates)

Get a cell by 3D coordinates.

```typescript
get(coordinates: Vector3D): T
```

**Example:**

```typescript
const value = voxels.get(new Vector3D(5, 3, 2));
```

### forEach(callback)

Iterate over all cells with coordinates.

```typescript
forEach(callback: (cell: T, x: number, y: number, z: number, index: number) => void): void
```

**Parameters:**
- `cell` - Current cell value
- `x` - X coordinate (width)
- `y` - Y coordinate (depth)
- `z` - Z coordinate (height)
- `index` - Flat array index

**Example:**

```typescript
voxels.forEach((cell, x, y, z, i) => {
    // FAST - Use indexSet with provided index
    if (cell === 0) {
        voxels.indexSet(i, 1);
    }
});
```

**Performance Note:** Use `indexSet(i, value)` inside forEach for best performance (2-3x faster than `set()`).

### indexForEach(callback)

Iterate over all cells (index-only, faster when coordinates not needed).

```typescript
indexForEach(callback: (cell: T, index: number) => void): void
```

**Example:**

```typescript
// Fastest iteration when coordinates not needed
voxels.indexForEach((cell, i) => {
    if (cell < 0) {
        voxels.indexSet(i, 0);
    }
});
```

---

## Common Patterns

### Voxel Terrain

```typescript
// Create 64x64x64 terrain
const terrain = new Array3D<number>(new Vector3D(64, 64, 64), 0);

// 0 = air, 1 = dirt, 2 = stone, 3 = grass
terrain.set(new Vector3D(32, 32, 0), 2);   // Stone at bottom
terrain.set(new Vector3D(32, 32, 1), 1);   // Dirt
terrain.set(new Vector3D(32, 32, 2), 3);   // Grass on top

// Check if solid
function isSolid(x, y, z) {
    const voxel = terrain.get(new Vector3D(x, y, z));
    return voxel > 0;
}
```

### 3D Pathfinding

```typescript
const grid = new Array3D<number>(new Vector3D(20, 20, 20), 0);

// Mark obstacles
grid.set(new Vector3D(10, 10, 5), -1);  // Wall

// Find walkable neighbors
function getNeighbors3D(x, y, z) {
    const neighbors = [];
    const offsets = [
        [-1,0,0], [1,0,0], [0,-1,0], [0,1,0], [0,0,-1], [0,0,1]
    ];

    offsets.forEach(([dx, dy, dz]) => {
        const pos = new Vector3D(x + dx, y + dy, z + dz);
        if (grid.get(pos) >= 0) {
            neighbors.push(pos);
        }
    });

    return neighbors;
}
```

### Chunk-Based World

```typescript
const CHUNK_SIZE = 16;
const world = new Array3D<number>(
    new Vector3D(CHUNK_SIZE, CHUNK_SIZE, CHUNK_SIZE)
);

// Generate chunk
world.forEach((cell, x, y, z, i) => {
    // Noise-based terrain generation
    const height = getNoiseHeight(x, y);
    world.indexSet(i, z < height ? 1 : 0);
});
```

### Fill Region

```typescript
// Fill rectangular region
function fillRegion(array, start, end, value) {
    for (let z = start.z; z <= end.z; z++) {
        for (let y = start.y; y <= end.y; y++) {
            for (let x = start.x; x <= end.x; x++) {
                array.set(new Vector3D(x, y, z), value);
            }
        }
    }
}

fillRegion(voxels, new Vector3D(0, 0, 0), new Vector3D(5, 5, 5), 1);
```

---

## Performance Optimization

### Use indexSet() in forEach()

```typescript
// SLOW - Recalculates index, creates Vector3D (2-3x slower)
voxels.forEach((cell, x, y, z, i) => {
    voxels.set(new Vector3D(x, y, z), newValue);
});

// FAST - Direct index access
voxels.forEach((cell, x, y, z, i) => {
    voxels.indexSet(i, newValue);
});

// FASTEST - Direct array access
voxels.forEach((cell, x, y, z, i) => {
    voxels.value[i] = newValue;
});
```

### Use indexForEach() When Possible

```typescript
// When you don't need coordinates:
voxels.indexForEach((cell, i) => {
    if (cell === 0) {
        voxels.indexSet(i, 1);
    }
});
```

### Batch Operations

```typescript
// Fill large regions efficiently
const size = new Vector3D(100, 100, 100);
const grid = new Array3D<number>(size);

// FAST - Single pass with indexSet
grid.forEach((cell, x, y, z, i) => {
    grid.indexSet(i, (x + y + z) % 2);  // Pattern fill
});
```

---

## Storage Format

Internally stored as flat array in Z-Y-X order:

```
Index = z * (depth * width) + y * width + x
```

Example for 2x2x2:

```
3D Positions:           Flat Array:
[0,0,0] [1,0,0]        [0,0,0] [1,0,0] [0,1,0] [1,1,0]
[0,1,0] [1,1,0]        [0,0,1] [1,0,1] [0,1,1] [1,1,1]

[0,0,1] [1,0,1]
[0,1,1] [1,1,1]
```

---

## Next Steps

- See [Array3Dc](array3dc.md) for RLE-compressed 3D arrays
- See [Array2D](array2d.md) for 2D grids
- See [Vector3D](vector3d.md) for 3D coordinates

---

**Source:** [src/math/index.ts:237-312](../../src/math/index.ts)
