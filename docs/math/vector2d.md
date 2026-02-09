# Vector2D

2D vector class for positions, velocities, and 2D mathematics.

---

## Overview

`Vector2D` represents a 2-dimensional vector with x and y components. All operations are **immutable** - they return new Vector2D instances rather than modifying the original.

---

## Constructor

```typescript
new Vector2D(x: number, y: number)
```

**Parameters:**
- `x` - X component
- `y` - Y component

**Example:**

```typescript
import { Vector2D } from 'omosuen';

const position = new Vector2D(10, 20);
const velocity = new Vector2D(1.5, -2.0);
const zero = new Vector2D(0, 0);
```

---

## Properties

### x

X component of the vector.

```typescript
vector.x: number
```

### y

Y component of the vector.

```typescript
vector.y: number
```

**Example:**

```typescript
const v = new Vector2D(10, 20);
console.log(v.x);  // 10
console.log(v.y);  // 20
```

---

## Methods

### normalize()

Returns a unit vector (length = 1) in the same direction.

```typescript
normalize(): Vector2D
```

**Returns:** New normalized vector

**Example:**

```typescript
const v = new Vector2D(3, 4);
const normalized = v.normalize();
console.log(normalized.x, normalized.y);  // 0.6, 0.8 (length = 1)
```

**Note:** Returns `(0, 0)` if original vector has zero length.

### add(other)

Vector addition.

```typescript
add(other: Vector2D): Vector2D
```

**Parameters:**
- `other` - Vector to add

**Returns:** New vector (this + other)

**Example:**

```typescript
const a = new Vector2D(10, 20);
const b = new Vector2D(5, 3);
const sum = a.add(b);
console.log(sum.x, sum.y);  // 15, 23
```

### subtract(other)

Vector subtraction.

```typescript
subtract(other: Vector2D): Vector2D
```

**Parameters:**
- `other` - Vector to subtract

**Returns:** New vector (this - other)

**Example:**

```typescript
const a = new Vector2D(10, 20);
const b = new Vector2D(5, 3);
const diff = a.subtract(b);
console.log(diff.x, diff.y);  // 5, 17
```

### multiply(scalar)

Scalar multiplication.

```typescript
multiply(scalar: number): Vector2D
```

**Parameters:**
- `scalar` - Number to multiply by

**Returns:** New vector (this * scalar)

**Example:**

```typescript
const v = new Vector2D(2, 3);
const scaled = v.multiply(5);
console.log(scaled.x, scaled.y);  // 10, 15
```

### divide(scalar)

Scalar division.

```typescript
divide(scalar: number): Vector2D
```

**Parameters:**
- `scalar` - Number to divide by (must be non-zero)

**Returns:** New vector (this / scalar)

**Throws:** Error if scalar is zero

**Example:**

```typescript
const v = new Vector2D(10, 20);
const half = v.divide(2);
console.log(half.x, half.y);  // 5, 10
```

### rotate(degrees)

Rotate vector by degrees (counter-clockwise).

```typescript
rotate(degrees: number): Vector2D
```

**Parameters:**
- `degrees` - Rotation angle in degrees

**Returns:** New rotated vector

**Example:**

```typescript
const v = new Vector2D(1, 0);
const rotated = v.rotate(90);
console.log(rotated.x, rotated.y);  // ~0, 1 (90° rotation)
```

### angleRadians()

Get the angle of the vector in radians.

```typescript
angleRadians(): number
```

**Returns:** Angle in radians (using Math.atan2)

**Example:**

```typescript
const v = new Vector2D(1, 1);
const angle = v.angleRadians();
console.log(angle);  // ~0.785 (45° in radians)
```

---

## Common Patterns

### Position and Movement

```typescript
let position = new Vector2D(0, 0);
const velocity = new Vector2D(5, 0);

// Update position every frame
function update(deltaTime) {
    const dt = deltaTime / 1000;
    position = position.add(velocity.multiply(dt));
}
```

### Direction Vectors

```typescript
const playerPos = new Vector2D(100, 100);
const enemyPos = new Vector2D(150, 120);

// Get direction from player to enemy
const direction = enemyPos.subtract(playerPos).normalize();

// Move toward enemy
const speed = 50;
playerPos = playerPos.add(direction.multiply(speed * deltaTime / 1000));
```

### Screen Coordinates

```typescript
// UI position
const buttonPos = new Vector2D(10, 10);

// Offset relative to button
const iconPos = buttonPos.add(new Vector2D(5, 5));
```

### Grid/Tile Positions

```typescript
const gridPos = new Vector2D(5, 3);  // Grid coordinates
const tileSize = 32;

// Convert to pixel position
const pixelPos = gridPos.multiply(tileSize);
console.log(pixelPos.x, pixelPos.y);  // 160, 96
```

---

## Performance Notes

- All methods return new instances (immutable)
- No allocations are made during method calls beyond the return value
- For hot loops, reuse variables:

```typescript
// GOOD - Reuses position variable
position = position.add(velocity);

// AVOID - Creates intermediate variables
const newPos = position.add(velocity);
position = newPos;  // Extra variable
```

---

## Next Steps

- See [Vector3D](vector3d.md) for 3D vectors
- Learn about [Array2D](array2d.md) for grid storage
- Explore [Data Layer](../components/data-layer.md) for storing vectors

---

**Source:** [src/math/index.ts:2-48](../../src/math/index.ts)
