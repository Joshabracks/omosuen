# Math Utilities

Helper functions for common mathematical operations.

---

## Functions

### lerp()

Linear interpolation between two values.

```typescript
lerp(a: number, b: number, t: number): number
```

**Parameters:**
- `a` - Start value
- `b` - End value
- `t` - Interpolation factor (typically 0-1)

**Returns:** Interpolated value

**Formula:** `a + t * (b - a)`

**Example:**

```typescript
import { lerp } from 'omosuen';

// Basic interpolation
const result = lerp(0, 100, 0.5);
console.log(result);  // 50

// Animation
let progress = 0;
function animate() {
    progress += 0.01;
    const position = lerp(startPos, endPos, progress);

    if (progress >= 1) {
        progress = 0;  // Loop
    }
}

// Color blending
const startColor = 0;
const endColor = 255;
const blendedColor = lerp(startColor, endColor, 0.25);
console.log(blendedColor);  // 63.75
```

---

## Common Patterns

### Smooth Movement

```typescript
let currentX = 0;
const targetX = 100;
const speed = 0.1;  // 10% per frame

function update() {
    currentX = lerp(currentX, targetX, speed);
    // Smoothly moves toward target
}
```

### Easing

```typescript
// Ease-in (accelerate)
function easeIn(t) {
    return t * t;
}

// Ease-out (decelerate)
function easeOut(t) {
    return 1 - (1 - t) * (1 - t);
}

// Apply easing to lerp
const start = 0;
const end = 100;
const t = 0.5;
const easedValue = lerp(start, end, easeOut(t));
```

### Color Transitions

```typescript
import { Vector3D, lerp } from 'omosuen';

function lerpColor(colorA, colorB, t) {
    return new Vector3D(
        lerp(colorA.r, colorB.r, t),
        lerp(colorA.g, colorB.g, t),
        lerp(colorA.b, colorB.b, t)
    );
}

const red = new Vector3D(255, 0, 0);
const blue = new Vector3D(0, 0, 255);

const purple = lerpColor(red, blue, 0.5);
console.log(purple);  // Vector3D(127.5, 0, 127.5)
```

### Camera Smoothing

```typescript
let cameraX = 0;
let cameraY = 0;

function updateCamera(targetX, targetY, deltaTime) {
    const smoothness = 0.1;

    cameraX = lerp(cameraX, targetX, smoothness);
    cameraY = lerp(cameraY, targetY, smoothness);
}
```

### Spring Effect

```typescript
let position = 0;
let velocity = 0;
const target = 100;
const springStrength = 0.1;
const damping = 0.9;

function updateSpring() {
    const force = (target - position) * springStrength;
    velocity += force;
    velocity *= damping;
    position += velocity;
}
```

### Fade In/Out

```typescript
let alpha = 0;
let fadingIn = true;

function updateFade(deltaTime) {
    if (fadingIn) {
        alpha = lerp(alpha, 1, 0.05);
        if (alpha > 0.99) fadingIn = false;
    } else {
        alpha = lerp(alpha, 0, 0.05);
        if (alpha < 0.01) fadingIn = true;
    }

    element.style.opacity = alpha;
}
```

---

## Notes

### Interpolation Factor (t)

- `t = 0` returns `a`
- `t = 1` returns `b`
- `t = 0.5` returns midpoint
- `t < 0` or `t > 1` extrapolates beyond range

**Example:**

```typescript
lerp(0, 100, 0);     // 0
lerp(0, 100, 1);     // 100
lerp(0, 100, 0.5);   // 50
lerp(0, 100, 2);     // 200 (extrapolation)
lerp(0, 100, -0.5);  // -50 (extrapolation)
```

### Performance

- Very fast (single multiplication and addition)
- No allocations
- Safe to call in hot loops

---

## Future Utilities

The math utilities module may be expanded with additional functions:

- `clamp(value, min, max)` - Constrain value to range
- `map(value, inMin, inMax, outMin, outMax)` - Remap value between ranges
- `smoothstep(edge0, edge1, x)` - Smooth Hermite interpolation
- `distance(a, b)` - Euclidean distance
- `randomRange(min, max)` - Random number in range
- `degToRad(degrees)` / `radToDeg(radians)` - Angle conversion

---

## Next Steps

- See [Vector2D](vector2d.md) for 2D math
- See [Vector3D](vector3d.md) for 3D math
- Learn about [Data Layer](../components/data-layer.md) for storing numeric values

---

**Source:** [src/math/index.ts:546-548](../../src/math/index.ts)
