// package engine/Math
export class Vector2D {
  constructor(
    public x: number,
    public y: number,
  ) {}

  normalize(): Vector2D {
    const length = Math.sqrt(this.x * this.x + this.y * this.y);
    return new Vector2D(this.x / length || 0, this.y / length || 0);
  }

  add(other: Vector2D): Vector2D {
    return new Vector2D(this.x + other.x, this.y + other.y);
  }

  subtract(other: Vector2D): Vector2D {
    return new Vector2D(this.x - other.x, this.y - other.y);
  }

  multiply(scalar: number): Vector2D {
    return new Vector2D(this.x * scalar, this.y * scalar);
  }

  divide(scalar: number): Vector2D {
    if (scalar === 0) {
      throw new Error('Cannot divide by zero');
    }
    return new Vector2D(this.x / scalar, this.y / scalar);
  }

  rotate(degrees: number): Vector2D {
    // Convert degrees to radians
    const radians = (degrees * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);

    // Apply rotation matrix and return new vector
    const newX = this.x * cos - this.y * sin;
    const newY = this.x * sin + this.y * cos;

    return new Vector2D(newX, newY);
  }

  angleRadians(): number {
    return Math.atan2(this.x, this.y);
  }
}

export class Vector3D {
  constructor(
    public x: number,
    public y: number,
    public z: number,
  ) {}

  normalize(): Vector3D {
    const length = Math.sqrt(
      this.x * this.x + this.y * this.y + this.z * this.z,
    );
    return new Vector3D(
      this.x / length || 0,
      this.y / length || 0,
      this.z / length || 0,
    );
  }

  add(other: Vector3D): Vector3D {
    return new Vector3D(this.x + other.x, this.y + other.y, this.z + other.z);
  }

  subtract(other: Vector3D): Vector3D {
    return new Vector3D(this.x - other.x, this.y - other.y, this.z - other.z);
  }

  multiply(scalar: number): Vector3D {
    return new Vector3D(this.x * scalar, this.y * scalar, this.z * scalar);
  }

  divide(scalar: number): Vector3D {
    if (scalar === 0) {
      throw new Error('Cannot divide by zero');
    }
    return new Vector3D(this.x / scalar, this.y / scalar, this.z / scalar);
  }

  // Color getters
  get r(): number {
    return this.x;
  }
  get g(): number {
    return this.y;
  }
  get b(): number {
    return this.z;
  }
}

export class Vector4D {
  constructor(
    public x: number,
    public y: number,
    public z: number,
    public w: number,
  ) {}

  normalize(): Vector4D {
    const length = Math.sqrt(
      this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w,
    );
    return new Vector4D(
      this.x / length || 0,
      this.y / length || 0,
      this.z / length || 0,
      this.w / length || 0,
    );
  }

  add(other: Vector4D): Vector4D {
    return new Vector4D(
      this.x + other.x,
      this.y + other.y,
      this.z + other.z,
      this.w + other.w,
    );
  }

  subtract(other: Vector4D): Vector4D {
    return new Vector4D(
      this.x - other.x,
      this.y - other.y,
      this.z - other.z,
      this.w - other.w,
    );
  }

  multiply(scalar: number): Vector4D {
    return new Vector4D(
      this.x * scalar,
      this.y * scalar,
      this.z * scalar,
      this.w * scalar,
    );
  }

  divide(scalar: number): Vector4D {
    if (scalar === 0) {
      throw new Error('Cannot divide by zero');
    }
    return new Vector4D(
      this.x / scalar,
      this.y / scalar,
      this.z / scalar,
      this.w / scalar,
    );
  }

  toString(): string {
    return `${this.x},${this.y},${this.z},${this.w}`;
  }

  // Color getters
  get r(): number {
    return this.x;
  }
  get g(): number {
    return this.y;
  }
  get b(): number {
    return this.z;
  }
  get a(): number {
    return this.w;
  }
}

export class Array2D<T> {
  size: Vector2D;
  value: Array<T>;
  get width(): number {
    return this.size.x;
  }
  get height(): number {
    return this.size.y;
  }
  constructor(size: Vector2D, defaultValue?: T) {
    this.size = size;
    const length = size.x * size.y;
    // Fill array with default value to avoid undefined values
    // For numeric types, -1 is typically used to indicate empty/invalid cells
    this.value =
      defaultValue !== undefined
        ? Array<T>(length).fill(defaultValue)
        : Array<T>(length).fill(-1 as T);
  }
  set = (coordinates: Vector2D, v: T): void => {
    this.value[coordinates.y * this.size.x + coordinates.x] = v;
  };
  indexSet = (i: number, v: T): void => {
    this.value[i] = v;
  };
  get = (coordinates: Vector2D): T =>
    this.value[coordinates.y * this.size.x + coordinates.x];
  forEach = (
    callback: (cell: T, x: number, y: number, index: number) => void,
  ): void => {
    // Performance note: forEach with indexSet() is recommended for best performance.
    // Example: array2D.forEach((cell, x, y, i) => { array2D.indexSet(i, newValue); })
    // Direct array access is also fast: array2D.forEach((cell, x, y, i) => { array2D.value[i] = newValue; })
    // Avoid using set() inside forEach as it recalculates the index and creates Vector2D objects.

    const width = this.size.x;
    let x = 0;
    let y = 0;
    let i = 0;
    while (i < this.value.length) {
      callback(this.value[i], x, y, i);
      x += 1;
      if (x >= width) {
        y += 1;
        x = 0;
      }
      i += 1;
    }
  };
  indexForEach = (callback: (cell: T, index: number) => void): void => {
    // Performance note: indexForEach is optimized for when you don't need x, y coordinates.
    // Use this when working with index-based operations for potential performance gains.
    let i = 0;
    while (i < this.value.length) {
      callback(this.value[i], i);
      i += 1;
    }
  };
}

export class Array3D<T> {
  size: Vector3D;
  value: Array<T>;
  get width(): number {
    return this.size.x;
  }
  get depth(): number {
    return this.size.y;
  }
  get height(): number {
    return this.size.z;
  }
  constructor(size: Vector3D, defaultValue?: T) {
    this.size = size;
    const length = size.x * size.y * size.z;
    // Fill array with default value to avoid undefined values
    // For numeric types, -1 is typically used to indicate empty/invalid cells
    this.value =
      defaultValue !== undefined
        ? Array<T>(length).fill(defaultValue)
        : Array<T>(length).fill(-1 as T);
  }
  set = (coordinates: Vector3D, v: T): void => {
    this.value[
      coordinates.z * this.size.y * this.size.x +
        coordinates.y * this.size.x +
        coordinates.x
    ] = v;
  };
  indexSet = (i: number, v: T): void => {
    this.value[i] = v;
  };
  get = (coordinates: Vector3D): T =>
    this.value[
      coordinates.z * this.size.y * this.size.x +
        coordinates.y * this.size.x +
        coordinates.x
    ];
  forEach = (
    callback: (cell: T, x: number, y: number, z: number, index: number) => void,
  ): void => {
    // Performance note: forEach with indexSet() is the fastest approach across all array sizes.
    // Example: array3D.forEach((cell, x, y, z, i) => { array3D.indexSet(i, newValue); })
    // Direct array access is also fast: array3D.forEach((cell, x, y, z, i) => { array3D.value[i] = newValue; })
    // Avoid using set() inside forEach as it recalculates the index and creates Vector3D objects (2-3x slower).

    const width = this.size.x;
    const height = this.size.y;
    let x = 0;
    let y = 0;
    let z = 0;
    let i = 0;
    while (i < this.value.length) {
      callback(this.value[i], x, y, z, i);
      x += 1;
      if (x >= width) {
        y += 1;
        x = 0;
      }
      if (y >= height) {
        z += 1;
        y = 0;
      }
      i += 1;
    }
  };
  indexForEach = (callback: (cell: T, index: number) => void): void => {
    // Performance note: indexForEach is optimized for when you don't need x, y, z coordinates.
    // Use this when working with index-based operations for potential performance gains.
    let i = 0;
    while (i < this.value.length) {
      callback(this.value[i], i);
      i += 1;
    }
  };
}

export class Array3Dc<T> {
  size: Vector3D;
  values: T[];
  counts: Uint32Array;
  private cumulativeCounts: Uint32Array;
  private dirtyMap: Map<number, T> | null = null;
  private maxMemoryThreshold: number;
  private totalCellCount: number;
  private onFlushCallback: (() => void) | null = null;
  get width(): number {
    return this.size.x;
  }
  get depth(): number {
    return this.size.y;
  }
  get height(): number {
    return this.size.z;
  }
  constructor(a: Array3D<T>, maxMemoryThreshold: number = 0.05) {
    this.size = a.size;
    this.totalCellCount = this.size.x * this.size.y * this.size.z;
    this.maxMemoryThreshold = maxMemoryThreshold;
    this.dirtyMap = null;
    const tempValues: T[] = [];
    const tempCounts: number[] = [];

    let current = a.value[0];
    let count = 1;

    for (let i = 1; i < a.value.length; i++) {
      if (a.value[i] !== current) {
        tempValues.push(current);
        tempCounts.push(count);
        count = 1;
        current = a.value[i];
      } else {
        count += 1;
      }
    }

    // Push final value-count pair
    tempValues.push(current);
    tempCounts.push(count);

    // Store as typed arrays
    this.values = tempValues;
    this.counts = new Uint32Array(tempCounts);

    // Build cumulative counts array for O(log N) binary search in get()
    // cumulativeCounts[i] = sum of counts[0] to counts[i-1]
    // Example: counts=[5,3,2] → cumulativeCounts=[0,5,8,10]
    this.cumulativeCounts = new Uint32Array(this.values.length + 1);
    this.cumulativeCounts[0] = 0;
    for (let i = 0; i < this.counts.length; i++) {
      this.cumulativeCounts[i + 1] = this.cumulativeCounts[i] + this.counts[i];
    }
  }
  forEach = (
    callback: (cell: T, x: number, y: number, z: number, i: number) => void,
  ): void => {
    const width = this.size.x;
    const height = this.size.y;
    let x = 0;
    let y = 0;
    let z = 0;
    let index = 0;

    // Iterate through each RLE pair
    for (let pairIndex = 0; pairIndex < this.values.length; pairIndex++) {
      const value = this.values[pairIndex];
      const count = this.counts[pairIndex];

      // Expand this run
      for (let r = 0; r < count; r++) {
        // Check if this index has a dirty override
        const cellValue =
          this.dirtyMap !== null && this.dirtyMap.has(index)
            ? this.dirtyMap.get(index)!
            : value;

        callback(cellValue, x, y, z, index);

        x += 1;
        if (x >= width) {
          y += 1;
          x = 0;
        }
        if (y >= height) {
          z += 1;
          y = 0;
        }
        index += 1;
      }
    }
  };
  expand = (): Array3D<T> => {
    // Create new Array3D with same dimensions
    const result = new Array3D<T>(this.size);
    let index = 0;

    // Iterate through each RLE pair and expand
    for (let pairIndex = 0; pairIndex < this.values.length; pairIndex++) {
      const value = this.values[pairIndex];
      const count = this.counts[pairIndex];

      // Write this value 'count' times using indexSet for performance
      for (let r = 0; r < count; r++) {
        result.indexSet(index, value);
        index += 1;
      }
    }

    return result;
  };
  set = (coordinates: Vector3D, value: T): void => {
    const targetIndex =
      coordinates.z * this.size.y * this.size.x +
      coordinates.y * this.size.x +
      coordinates.x;

    // Lazy initialize dirty map
    if (this.dirtyMap === null) {
      this.dirtyMap = new Map<number, T>();
    }

    // Set the dirty value
    this.dirtyMap.set(targetIndex, value);

    // Check if we've exceeded memory threshold
    const dirtyRatio = this.dirtyMap.size / this.totalCellCount;
    if (dirtyRatio >= this.maxMemoryThreshold) {
      this.flush();
    }
  };
  flush = (): void => {
    // Nothing to flush if no dirty values
    if (this.dirtyMap === null || this.dirtyMap.size === 0) {
      return;
    }

    // Expand compressed data to full Array3D
    const expanded = this.expand();

    // Apply all dirty changes to expanded array
    for (const [index, value] of this.dirtyMap) {
      expanded.indexSet(index, value);
    }

    // Reconstruct RLE compression from modified array
    const tempValues: T[] = [];
    const tempCounts: number[] = [];

    let current = expanded.value[0];
    let count = 1;

    for (let i = 1; i < expanded.value.length; i++) {
      if (expanded.value[i] !== current) {
        tempValues.push(current);
        tempCounts.push(count);
        count = 1;
        current = expanded.value[i];
      } else {
        count += 1;
      }
    }

    // Push final value-count pair
    tempValues.push(current);
    tempCounts.push(count);

    // Replace internal state with recompressed data
    this.values = tempValues;
    this.counts = new Uint32Array(tempCounts);

    // Rebuild cumulative counts
    this.cumulativeCounts = new Uint32Array(this.values.length + 1);
    this.cumulativeCounts[0] = 0;
    for (let i = 0; i < this.counts.length; i++) {
      this.cumulativeCounts[i + 1] = this.cumulativeCounts[i] + this.counts[i];
    }

    // Clear dirty map and set to null
    this.dirtyMap.clear();
    this.dirtyMap = null;

    // Notify callback that data has changed
    if (this.onFlushCallback) {
      this.onFlushCallback();
    }
  };
  setOnFlushCallback = (callback: (() => void) | null): void => {
    this.onFlushCallback = callback;
  };
  get = (coordinates: Vector3D): T | undefined => {
    // Calculate linear index from 3D coordinates
    const targetIndex =
      coordinates.z * this.size.y * this.size.x +
      coordinates.y * this.size.x +
      coordinates.x;

    // Check dirty map first (O(1))
    if (this.dirtyMap !== null && this.dirtyMap.has(targetIndex)) {
      return this.dirtyMap.get(targetIndex);
    }

    // Binary search through cumulative counts to find which RLE pair contains targetIndex
    // cumulativeCounts[i] <= targetIndex < cumulativeCounts[i+1] means values[i] is the answer
    let left = 0;
    let right = this.values.length - 1;

    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const rangeStart = this.cumulativeCounts[mid];
      const rangeEnd = this.cumulativeCounts[mid + 1];

      if (targetIndex >= rangeStart && targetIndex < rangeEnd) {
        // Found the RLE pair that contains this index
        return this.values[mid];
      } else if (targetIndex < rangeStart) {
        // Target is in an earlier pair
        right = mid - 1;
      } else {
        // Target is in a later pair (targetIndex >= rangeEnd)
        left = mid + 1;
      }
    }

    // Index out of bounds
    return undefined;
  };
}

export function lerp(a: number, b: number, t: number): number {
  return a + t * (b - a);
}
