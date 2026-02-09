# Array3Dc

RLE-compressed 3D array for large static datasets.

---

## Overview

`Array3Dc<T>` (Array3D Compressed) is a Run-Length Encoded (RLE) 3D array optimized for large, mostly-static datasets with repeating values. It provides:

- **Massive memory savings** for uniform regions
- **Dirty map** for sparse modifications
- **O(log N) lookups** via binary search
- **Automatic flushing** when modifications exceed threshold

Use this for large terrain, static voxel worlds, or any 3D data with long runs of identical values.

---

## Constructor

```typescript
new Array3Dc<T>(source: Array3D<T>, maxMemoryThreshold?: number)
```

**Parameters:**
- `source` - Source Array3D to compress
- `maxMemoryThreshold` - Dirty ratio before auto-flush (default: 0.05 = 5%)

**Example:**

```typescript
import { Array3D, Array3Dc, Vector3D } from 'omosuen';

// Create large terrain
const terrain = new Array3D<number>(new Vector3D(256, 256, 64));
terrain.forEach((cell, x, y, z, i) => {
    terrain.indexSet(i, z < 32 ? 1 : 0);  // Solid below y=32
});

// Compress (massive memory savings!)
const compressed = new Array3Dc(terrain);
console.log('Compressed size:', compressed.values.length);
// Original: 256 * 256 * 64 = 4,194,304 values
// Compressed: ~2 RLE pairs (one for solid, one for air)
```

---

## Properties

```typescript
array3dc.size: Vector3D         // Dimensions
array3dc.values: T[]            // RLE values
array3dc.counts: Uint32Array    // RLE run lengths
array3dc.width: number          // Alias for size.x
array3dc.depth: number          // Alias for size.y
array3dc.height: number         // Alias for size.z
```

---

## Methods

### get(coordinates)

Get a cell value (O(log N) via binary search).

```typescript
get(coordinates: Vector3D): T | undefined
```

**Example:**

```typescript
const value = compressed.get(new Vector3D(10, 20, 5));
if (value !== undefined) {
    console.log('Found:', value);
}
```

**Performance:** O(log N) where N is number of RLE pairs (not total cells!)

### set(coordinates, value)

Set a cell value (writes to dirty map).

```typescript
set(coordinates: Vector3D, value: T): void
```

**Example:**

```typescript
compressed.set(new Vector3D(100, 100, 10), 5);
```

**Behavior:**
1. Writes to dirty map (not compressed data)
2. When dirty ratio exceeds `maxMemoryThreshold`, automatically flushes
3. Flush recompresses entire array with dirty changes applied

**Auto-Flush Example:**

```typescript
const compressed = new Array3Dc(terrain, 0.05);  // 5% threshold

// Make many changes
for (let i = 0; i < 1000; i++) {
    compressed.set(randomPos(), newValue);
}
// Automatically flushes when dirty map hits 5% of total cells
```

### forEach(callback)

Iterate over all cells, including dirty overrides.

```typescript
forEach(callback: (cell: T, x: number, y: number, z: number, i: number) => void): void
```

**Example:**

```typescript
compressed.forEach((cell, x, y, z, i) => {
    console.log(`Cell at (${x},${y},${z}): ${cell}`);
});
```

**Note:** Expands RLE pairs during iteration. Checks dirty map for each cell.

### expand()

Expand to full Array3D.

```typescript
expand(): Array3D<T>
```

**Returns:** New Array3D with all values expanded

**Example:**

```typescript
const expanded = compressed.expand();
// Now have full uncompressed Array3D
```

**Use when:** You need to make many modifications (cheaper than repeated set/flush cycles)

### flush()

Manually flush dirty changes and recompress.

```typescript
flush(): void
```

**Example:**

```typescript
// Make modifications
compressed.set(new Vector3D(0, 0, 0), 10);
compressed.set(new Vector3D(1, 1, 1), 20);

// Manually flush
compressed.flush();
// Dirty map cleared, data recompressed
```

**Behavior:**
1. Expands compressed data to Array3D
2. Applies all dirty changes
3. Recompresses with RLE
4. Clears dirty map
5. Calls `onFlushCallback` if set

### setOnFlushCallback(callback)

Register callback to run after flush.

```typescript
setOnFlushCallback(callback: (() => void) | null): void
```

**Example:**

```typescript
compressed.setOnFlushCallback(() => {
    console.log('Data was flushed and recompressed!');
    saveToFile(compressed);
});
```

---

## Common Patterns

### Large Static Terrain

```typescript
// Generate 512x512x128 terrain
const terrain = new Array3D<number>(new Vector3D(512, 512, 128), 0);

// Fill with mostly uniform data
terrain.forEach((cell, x, y, z, i) => {
    const height = getNoiseHeight(x, y);
    terrain.indexSet(i, z < height ? 1 : 0);
});

// Compress (huge memory savings for mostly-air or mostly-solid regions)
const compressed = new Array3Dc(terrain);

// Make sparse edits
compressed.set(new Vector3D(100, 100, 50), 5);  // Player placed block
```

### Chunk System

```typescript
class TerrainChunk {
    data: Array3Dc<number>;

    constructor(chunkPos) {
        const chunk = generateChunk(chunkPos);  // Returns Array3D
        this.data = new Array3Dc(chunk, 0.1);  // 10% dirty threshold
    }

    setBlock(localPos, blockType) {
        this.data.set(localPos, blockType);
        // Auto-flushes when too many edits
    }
}
```

### Periodic Flushing

```typescript
const compressed = new Array3Dc(terrain, 1.0);  // Never auto-flush

// Manual flush every N seconds
setInterval(() => {
    compressed.flush();
    console.log('Flushed terrain data');
}, 30000);  // Every 30 seconds
```

### Serialize Compressed Data

```typescript
// Compressed data is much smaller to save
function serializeChunk(compressed) {
    return {
        size: { x: compressed.size.x, y: compressed.size.y, z: compressed.size.z },
        values: Array.from(compressed.values),
        counts: Array.from(compressed.counts)
    };
}

function deserializeChunk(data) {
    // Reconstruct Array3Dc
    const tempArray = new Array3D(new Vector3D(data.size.x, data.size.y, data.size.z));
    // ... reconstruct from RLE data ...
    return new Array3Dc(tempArray);
}
```

---

## Performance Characteristics

### Memory Usage

```
Uncompressed: width * depth * height * sizeof(T)
Compressed: N_pairs * (sizeof(T) + 4)
    where N_pairs = number of distinct runs

Example:
256x256x64 filled with single value
- Uncompressed: 4,194,304 values
- Compressed: 1 value + 1 count = ~8 bytes total
- Savings: ~99.9999%!
```

### Access Performance

- **get()**: O(log N) where N = number of RLE pairs
- **set()**: O(1) to dirty map, O(M * log M) on flush where M = total cells
- **forEach()**: O(M) where M = total cells (expands during iteration)

### Best Use Cases

✓ Large, mostly-uniform data (terrain, voxel worlds)
✓ Static or rarely-modified data
✓ Memory-constrained environments

✗ Frequently-modified data (use Array3D instead)
✗ Highly varied data (little compression benefit)

---

## Flush Strategies

### Auto-Flush (Default)

```typescript
const compressed = new Array3Dc(terrain, 0.05);  // Flush at 5% dirty

// Automatically manages flush
for (let i = 0; i < 10000; i++) {
    compressed.set(randomPos(), randomValue());
    // Flushes automatically when dirty ratio hits 5%
}
```

### Manual Flush

```typescript
const compressed = new Array3Dc(terrain, 1.0);  // Never auto-flush

// Batch modifications
for (let i = 0; i < 1000; i++) {
    compressed.set(pos, value);
}

// Manual flush when done
compressed.flush();
```

### Callback-Based

```typescript
compressed.setOnFlushCallback(() => {
    console.log('Recompressed! Saving to disk...');
    saveToDisk(compressed);
});

// Flush triggers save
compressed.flush();
```

---

## RLE Format Example

```
Original data: [1, 1, 1, 2, 2, 3, 3, 3, 3]

RLE Compression:
values: [1, 2, 3]
counts: [3, 2, 4]

Meaning:
- 3 consecutive 1's
- 2 consecutive 2's
- 4 consecutive 3's
```

Binary search uses cumulative counts for O(log N) lookups:

```
cumulativeCounts: [0, 3, 5, 9]

To find index 6:
- Binary search finds: 3 <= 6 < 9
- Value at that range: values[2] = 3
```

---

## Next Steps

- See [Array3D](array3d.md) for uncompressed 3D arrays
- See [Array2D](array2d.md) for 2D grids
- See [Vector3D](vector3d.md) for 3D coordinates

---

**Source:** [src/math/index.ts:314-544](../../src/math/index.ts)
