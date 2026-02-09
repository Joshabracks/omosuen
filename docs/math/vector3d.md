# Vector3D

3D vector class for 3D positions, velocities, and RGB colors.

---

## Overview

`Vector3D` represents a 3-dimensional vector with x, y, and z components. All operations are **immutable**. Also provides color getters (r, g, b) for RGB color representation.

---

## Constructor

```typescript
new Vector3D(x: number, y: number, z: number)
```

**Example:**

```typescript
import { Vector3D } from 'omosuen';

const position = new Vector3D(10, 20, 30);
const velocity = new Vector3D(1, 0, -1);
const color = new Vector3D(255, 128, 64);  // RGB color
```

---

## Properties

```typescript
vector.x: number  // X component (or Red for colors)
vector.y: number  // Y component (or Green for colors)
vector.z: number  // Z component (or Blue for colors)
```

### Color Getters

```typescript
vector.r: number  // Alias for x (Red channel)
vector.g: number  // Alias for y (Green channel)
vector.b: number  // Alias for z (Blue channel)
```

**Example:**

```typescript
const color = new Vector3D(255, 128, 64);
console.log(color.r, color.g, color.b);  // 255, 128, 64
console.log(color.x, color.y, color.z);  // 255, 128, 64 (same values)
```

---

## Methods

### normalize()

Returns a unit vector (length = 1).

```typescript
normalize(): Vector3D
```

### add(other)

Vector addition.

```typescript
add(other: Vector3D): Vector3D
```

### subtract(other)

Vector subtraction.

```typescript
subtract(other: Vector3D): Vector3D
```

### multiply(scalar)

Scalar multiplication.

```typescript
multiply(scalar: number): Vector3D
```

### divide(scalar)

Scalar division.

```typescript
divide(scalar: number): Vector3D
```

**Throws:** Error if scalar is zero

---

## Common Patterns

### 3D Position

```typescript
let position = new Vector3D(0, 0, 0);
const velocity = new Vector3D(1, 0, 0);

// Update position
position = position.add(velocity.multiply(deltaTime / 1000));
```

### RGB Colors

```typescript
// Define colors
const red = new Vector3D(255, 0, 0);
const green = new Vector3D(0, 255, 0);
const blue = new Vector3D(0, 0, 255);

// Mix colors (average)
const purple = red.add(blue).divide(2);
console.log(purple.r, purple.g, purple.b);  // 127.5, 0, 127.5

// Darken color
const darkRed = red.multiply(0.5);
console.log(darkRed.r);  // 127.5
```

### Direction Vectors

```typescript
const from = new Vector3D(0, 0, 0);
const to = new Vector3D(10, 10, 10);

// Get normalized direction
const direction = to.subtract(from).normalize();

// Move in direction
const speed = 5;
const movement = direction.multiply(speed);
```

### Axonometric Positioning

```typescript
// Isometric tile position
const tileX = 5;
const tileY = 3;
const tileZ = 0;

// Convert to screen space (simplified isometric projection)
const screenX = (tileX - tileY) * 32;
const screenY = (tileX + tileY) * 16 - tileZ * 24;

const screenPos = new Vector3D(screenX, screenY, 0);
```

---

## Next Steps

- See [Vector2D](vector2d.md) for 2D vectors
- See [Vector4D](vector4d.md) for RGBA colors
- Learn about [Array3D](array3d.md) for voxel storage

---

**Source:** [src/math/index.ts:50-97](../../src/math/index.ts)
