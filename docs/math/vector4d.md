# Vector4D

4D vector class for 4D mathematics and RGBA colors.

---

## Overview

`Vector4D` represents a 4-dimensional vector with x, y, z, and w components. All operations are **immutable**. Provides color getters (r, g, b, a) for RGBA color representation.

---

## Constructor

```typescript
new Vector4D(x: number, y: number, z: number, w: number)
```

**Example:**

```typescript
import { Vector4D } from 'omosuen';

const quaternion = new Vector4D(0, 0, 0, 1);
const color = new Vector4D(255, 128, 64, 200);  // RGBA color
```

---

## Properties

```typescript
vector.x: number  // X component (or Red for colors)
vector.y: number  // Y component (or Green for colors)
vector.z: number  // Z component (or Blue for colors)
vector.w: number  // W component (or Alpha for colors)
```

### Color Getters

```typescript
vector.r: number  // Alias for x (Red channel)
vector.g: number  // Alias for y (Green channel)
vector.b: number  // Alias for z (Blue channel)
vector.a: number  // Alias for w (Alpha channel)
```

**Example:**

```typescript
const color = new Vector4D(255, 128, 64, 200);
console.log(color.r, color.g, color.b, color.a);  // 255, 128, 64, 200
console.log(color.x, color.y, color.z, color.w);  // Same values
```

---

## Methods

### normalize()

Returns a unit vector (length = 1).

```typescript
normalize(): Vector4D
```

### add(other)

Vector addition.

```typescript
add(other: Vector4D): Vector4D
```

### subtract(other)

Vector subtraction.

```typescript
subtract(other: Vector4D): Vector4D
```

### multiply(scalar)

Scalar multiplication.

```typescript
multiply(scalar: number): Vector4D
```

### divide(scalar)

Scalar division.

```typescript
divide(scalar: number): Vector4D
```

**Throws:** Error if scalar is zero

### toString()

Convert to comma-separated string.

```typescript
toString(): string
```

**Returns:** `"x,y,z,w"`

**Example:**

```typescript
const v = new Vector4D(1, 2, 3, 4);
console.log(v.toString());  // "1,2,3,4"
```

---

## Common Patterns

### RGBA Colors

```typescript
// Define colors with alpha
const red = new Vector4D(255, 0, 0, 255);        // Opaque red
const transRed = new Vector4D(255, 0, 0, 128);   // 50% transparent red
const invisible = new Vector4D(0, 0, 0, 0);      // Fully transparent

// Fade color
function fadeColor(color, alpha) {
    return new Vector4D(color.r, color.g, color.b, alpha);
}

const fadedRed = fadeColor(red, 64);  // 25% opacity
```

### CSS Color String

```typescript
const color = new Vector4D(255, 128, 64, 200);

// Convert to rgba() string
function toRGBA(color) {
    return `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a / 255})`;
}

const cssColor = toRGBA(color);
console.log(cssColor);  // "rgba(255, 128, 64, 0.784...)"
```

### Color Blending

```typescript
// Alpha blend two colors
function blendColors(bottom, top) {
    const alpha = top.a / 255;
    const invAlpha = 1 - alpha;

    return new Vector4D(
        bottom.r * invAlpha + top.r * alpha,
        bottom.g * invAlpha + top.g * alpha,
        bottom.b * invAlpha + top.b * alpha,
        255  // Result is opaque
    );
}

const background = new Vector4D(100, 100, 100, 255);
const overlay = new Vector4D(255, 0, 0, 128);  // 50% red

const blended = blendColors(background, overlay);
```

### Serialization

```typescript
// Store color as string
const color = new Vector4D(255, 128, 64, 200);
const serialized = color.toString();
localStorage.setItem('color', serialized);

// Parse color from string
const loaded = localStorage.getItem('color').split(',').map(Number);
const restoredColor = new Vector4D(loaded[0], loaded[1], loaded[2], loaded[3]);
```

---

## Next Steps

- See [Vector3D](vector3d.md) for RGB colors
- See [Vector2D](vector2d.md) for 2D vectors
- Learn about [Data Layer](../components/data-layer.md) for storing colors

---

**Source:** [src/math/index.ts:99-175](../../src/math/index.ts)
