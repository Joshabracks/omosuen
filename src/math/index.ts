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

export class Array3Di {
  size: Vector3D;
  data: Uint8Array | Uint16Array | Uint32Array;
  private bitWidth: 8 | 16 | 32;
  private bitPackingConfig: Array<1 | 2 | 4 | 8 | 16> | null;
  private overflow: 'mod' | 'clamp' | 'fail';

  get width(): number {
    return this.size.x;
  }
  get depth(): number {
    return this.size.y;
  }
  get height(): number {
    return this.size.z;
  }

  constructor(
    data: Array3D<number>,
    bitWidth: 8 | 16 | 32 = 8,
    bitPackingConfig?: Array<1 | 2 | 4 | 8 | 16>,
    overflow: 'mod' | 'clamp' | 'fail' = 'mod',
  ) {
    this.size = data.size;
    this.bitWidth = bitWidth;
    this.overflow = overflow;

    // Validate bit packing configuration
    if (bitPackingConfig && bitPackingConfig.length > 0) {
      const sum = bitPackingConfig.reduce((acc, val) => acc + val, 0);
      if (sum !== bitWidth) {
        throw new Error(
          `bitPackingConfig sum (${sum}) must equal bitWidth (${bitWidth})`,
        );
      }

      // Validate input array length is multiple of pattern length
      if (data.value.length % bitPackingConfig.length !== 0) {
        throw new Error(
          `Input array length (${data.value.length}) must be a multiple of bitPackingConfig length (${bitPackingConfig.length})`,
        );
      }

      this.bitPackingConfig = bitPackingConfig;

      // Calculate packed size - each pattern packs into one value
      const packRatio = bitPackingConfig.length;
      const packedLength = data.value.length / packRatio;

      // Create typed array for packed data
      this.data = this.createTypedArray(packedLength);

      // Pack the data
      for (let i = 0; i < packedLength; i++) {
        const values: number[] = [];
        for (let j = 0; j < packRatio; j++) {
          const idx = i * packRatio + j;
          values.push(data.value[idx]);
        }
        this.data[i] = this.packValues(values);
      }
    } else {
      // No bit packing - direct storage
      this.bitPackingConfig = null;

      // Create typed array
      this.data = this.createTypedArray(data.value.length);

      // Copy and validate values
      for (let i = 0; i < data.value.length; i++) {
        const maxValue = (1 << bitWidth) - 1;
        const processedValue = this.applyOverflow(data.value[i], maxValue);
        this.data[i] = processedValue;
      }
    }
  }

  private createTypedArray(
    length: number,
  ): Uint8Array | Uint16Array | Uint32Array {
    switch (this.bitWidth) {
      case 8:
        return new Uint8Array(length);
      case 16:
        return new Uint16Array(length);
      case 32:
        return new Uint32Array(length);
    }
  }

  private packValues(values: number[]): number {
    if (!this.bitPackingConfig) {
      throw new Error('Bit packing config not set');
    }

    let packed = 0;
    let offset = 0;

    for (let i = 0; i < values.length; i++) {
      const bits = this.bitPackingConfig[i];
      const maxValue = (1 << bits) - 1;
      const processedValue = this.applyOverflow(values[i], maxValue);

      packed |= processedValue << offset;
      offset += bits;
    }

    return packed;
  }

  private unpackValue(packed: number): number[] {
    if (!this.bitPackingConfig) {
      throw new Error('Bit packing config not set');
    }

    const values: number[] = [];
    let offset = 0;

    for (let i = 0; i < this.bitPackingConfig.length; i++) {
      const bits = this.bitPackingConfig[i];
      const mask = (1 << bits) - 1;
      const value = (packed >> offset) & mask;
      values.push(value);
      offset += bits;
    }

    return values;
  }

  private applyOverflow(value: number, maxValue: number): number {
    switch (this.overflow) {
      case 'mod':
        // Handle negative values correctly
        if (value < 0) {
          return ((value % (maxValue + 1)) + (maxValue + 1)) % (maxValue + 1);
        }
        return value % (maxValue + 1);

      case 'clamp':
        return Math.max(0, Math.min(value, maxValue));

      case 'fail':
        if (value < 0 || value > maxValue) {
          throw new Error(
            `Value ${value} out of range [0, ${maxValue}] (overflow mode: fail)`,
          );
        }
        return value;
    }
  }

  set = (coordinates: Vector3D, value: number): void => {
    if (this.bitPackingConfig) {
      throw new Error(
        'Cannot use set() with bit packing enabled. Use setPacked() instead.',
      );
    }

    const index =
      coordinates.z * this.size.y * this.size.x +
      coordinates.y * this.size.x +
      coordinates.x;

    const maxValue = (1 << this.bitWidth) - 1;
    const processedValue = this.applyOverflow(value, maxValue);
    this.data[index] = processedValue;
  };

  get = (coordinates: Vector3D): number => {
    if (this.bitPackingConfig) {
      throw new Error(
        'Cannot use get() with bit packing enabled. Use getUnpacked() instead.',
      );
    }

    const index =
      coordinates.z * this.size.y * this.size.x +
      coordinates.y * this.size.x +
      coordinates.x;

    return this.data[index];
  };

  indexSet = (index: number, value: number): void => {
    if (this.bitPackingConfig) {
      throw new Error(
        'Cannot use indexSet() with bit packing enabled. Use setPacked() with coordinates instead.',
      );
    }

    const maxValue = (1 << this.bitWidth) - 1;
    const processedValue = this.applyOverflow(value, maxValue);
    this.data[index] = processedValue;
  };

  indexGet = (index: number): number => {
    if (this.bitPackingConfig) {
      throw new Error(
        'Cannot use indexGet() with bit packing enabled. Use getUnpacked() with coordinates instead.',
      );
    }

    return this.data[index];
  };

  setPacked = (coordinates: Vector3D, values: number[]): void => {
    if (!this.bitPackingConfig) {
      throw new Error(
        'Bit packing not enabled. Use set() for direct value assignment.',
      );
    }

    if (values.length !== this.bitPackingConfig.length) {
      throw new Error(
        `Expected ${this.bitPackingConfig.length} values, got ${values.length}`,
      );
    }

    // Calculate which packed value this corresponds to
    const linearIndex =
      coordinates.z * this.size.y * this.size.x +
      coordinates.y * this.size.x +
      coordinates.x;

    const packRatio = this.bitPackingConfig.length;
    const packedIndex = Math.floor(linearIndex / packRatio);

    const packed = this.packValues(values);
    this.data[packedIndex] = packed;
  };

  getUnpacked = (coordinates: Vector3D): number[] => {
    if (!this.bitPackingConfig) {
      throw new Error(
        'Bit packing not enabled. Use get() for direct value retrieval.',
      );
    }

    // Calculate which packed value this corresponds to
    const linearIndex =
      coordinates.z * this.size.y * this.size.x +
      coordinates.y * this.size.x +
      coordinates.x;

    const packRatio = this.bitPackingConfig.length;
    const packedIndex = Math.floor(linearIndex / packRatio);

    const packed = this.data[packedIndex];
    return this.unpackValue(packed);
  };

  forEach = (
    callback: (
      cell: number,
      x: number,
      y: number,
      z: number,
      index: number,
    ) => void,
  ): void => {
    if (this.bitPackingConfig) {
      // For packed data, iterate through logical (unpacked) positions
      const width = this.size.x;
      const height = this.size.y;
      const packRatio = this.bitPackingConfig.length;

      let x = 0;
      let y = 0;
      let z = 0;
      let index = 0;

      while (index < this.size.x * this.size.y * this.size.z) {
        const packedIndex = Math.floor(index / packRatio);
        const packed = this.data[packedIndex];
        const unpacked = this.unpackValue(packed);
        const offsetInPack = index % packRatio;
        const value = unpacked[offsetInPack];

        callback(value, x, y, z, index);

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
    } else {
      // For unpacked data, direct iteration
      const width = this.size.x;
      const height = this.size.y;
      let x = 0;
      let y = 0;
      let z = 0;
      let i = 0;

      while (i < this.data.length) {
        callback(this.data[i], x, y, z, i);

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
    }
  };

  expand = (): Array3D<number> => {
    const result = new Array3D<number>(this.size);

    if (this.bitPackingConfig) {
      // Unpack all values
      let index = 0;

      for (let packedIndex = 0; packedIndex < this.data.length; packedIndex++) {
        const packed = this.data[packedIndex];
        const unpacked = this.unpackValue(packed);

        for (
          let i = 0;
          i < unpacked.length && index < result.value.length;
          i++
        ) {
          result.value[index] = unpacked[i];
          index += 1;
        }
      }
    } else {
      // Direct copy
      for (let i = 0; i < this.data.length; i++) {
        result.value[i] = this.data[i];
      }
    }

    return result;
  };
}

export class Array3Dic {
  size: Vector3D; // Bit-packed dimensions
  values: number[] = []; // RLE compressed packed integers
  counts: Uint32Array = new Uint32Array(0); // RLE counts
  private cumulativeCounts: Uint32Array = new Uint32Array(0); // For binary search
  private dirtyMap: Map<number, number> | null = null; // Stores packed integers
  private bitWidth: 8 | 16 | 32;
  private bitPackingConfig: Array<1 | 2 | 4 | 8 | 16> | null;
  private overflow: 'mod' | 'clamp' | 'fail';
  private maxMemoryThreshold: number;
  private totalCellCount: number; // Based on packed size
  private logicalSize: Vector3D; // Original logical dimensions
  private onFlushCallback: (() => void) | null = null;

  get width(): number {
    return this.size.x; // Packed width
  }
  get depth(): number {
    return this.size.y; // Packed depth
  }
  get height(): number {
    return this.size.z; // Packed height
  }
  get logicalWidth(): number {
    return this.logicalSize.x;
  }
  get logicalDepth(): number {
    return this.logicalSize.y;
  }
  get logicalHeight(): number {
    return this.logicalSize.z;
  }

  constructor(
    data: Array3D<number>,
    bitWidth: 8 | 16 | 32 = 8,
    bitPackingConfig?: Array<1 | 2 | 4 | 8 | 16>,
    overflow: 'mod' | 'clamp' | 'fail' = 'mod',
    maxMemoryThreshold: number = 0.05,
  ) {
    this.bitWidth = bitWidth;
    this.overflow = overflow;
    this.maxMemoryThreshold = maxMemoryThreshold;
    this.logicalSize = data.size;
    this.dirtyMap = null;

    // Validate bit packing configuration
    if (bitPackingConfig && bitPackingConfig.length > 0) {
      const sum = bitPackingConfig.reduce((acc, val) => acc + val, 0);
      if (sum !== bitWidth) {
        throw new Error(
          `bitPackingConfig sum (${sum}) must equal bitWidth (${bitWidth})`,
        );
      }

      // Validate input array length is multiple of pattern length
      if (data.value.length % bitPackingConfig.length !== 0) {
        throw new Error(
          `Input array length (${data.value.length}) must be a multiple of bitPackingConfig length (${bitPackingConfig.length})`,
        );
      }

      this.bitPackingConfig = bitPackingConfig;

      // Step 1: Bit pack the data
      const packRatio = bitPackingConfig.length;
      const packedLength = data.value.length / packRatio;

      // Create temporary array for packed integers
      const packedData: number[] = [];
      for (let i = 0; i < packedLength; i++) {
        const values: number[] = [];
        for (let j = 0; j < packRatio; j++) {
          const idx = i * packRatio + j;
          values.push(data.value[idx]);
        }
        packedData.push(this.packValues(values));
      }

      // Calculate packed dimensions
      this.size = new Vector3D(
        Math.ceil(this.logicalSize.x / packRatio),
        this.logicalSize.y,
        this.logicalSize.z,
      );

      // Step 2: RLE compress the packed integers
      this.compressPackedData(packedData);
    } else {
      // No bit packing - direct RLE compression
      this.bitPackingConfig = null;
      this.size = data.size;

      // Apply overflow and create packed array
      const maxValue = (1 << bitWidth) - 1;
      const packedData: number[] = [];
      for (let i = 0; i < data.value.length; i++) {
        packedData.push(this.applyOverflow(data.value[i], maxValue));
      }

      // RLE compress
      this.compressPackedData(packedData);
    }

    this.totalCellCount = this.size.x * this.size.y * this.size.z;
  }

  private compressPackedData(packedData: number[]): void {
    const tempValues: number[] = [];
    const tempCounts: number[] = [];

    if (packedData.length === 0) {
      this.values = [];
      this.counts = new Uint32Array(0);
      this.cumulativeCounts = new Uint32Array(1);
      this.cumulativeCounts[0] = 0;
      return;
    }

    let current = packedData[0];
    let count = 1;

    for (let i = 1; i < packedData.length; i++) {
      if (packedData[i] !== current) {
        tempValues.push(current);
        tempCounts.push(count);
        count = 1;
        current = packedData[i];
      } else {
        count += 1;
      }
    }

    // Push final value-count pair
    tempValues.push(current);
    tempCounts.push(count);

    // Store RLE data
    this.values = tempValues;
    this.counts = new Uint32Array(tempCounts);

    // Build cumulative counts for binary search
    this.cumulativeCounts = new Uint32Array(this.values.length + 1);
    this.cumulativeCounts[0] = 0;
    for (let i = 0; i < this.counts.length; i++) {
      this.cumulativeCounts[i + 1] = this.cumulativeCounts[i] + this.counts[i];
    }
  }

  private packValues(values: number[]): number {
    if (!this.bitPackingConfig) {
      throw new Error('Bit packing config not set');
    }

    let packed = 0;
    let offset = 0;

    for (let i = 0; i < values.length; i++) {
      const bits = this.bitPackingConfig[i];
      const maxValue = (1 << bits) - 1;
      const processedValue = this.applyOverflow(values[i], maxValue);

      packed |= processedValue << offset;
      offset += bits;
    }

    return packed;
  }

  private unpackValue(packed: number): number[] {
    if (!this.bitPackingConfig) {
      throw new Error('Bit packing config not set');
    }

    const values: number[] = [];
    let offset = 0;

    for (let i = 0; i < this.bitPackingConfig.length; i++) {
      const bits = this.bitPackingConfig[i];
      const mask = (1 << bits) - 1;
      const value = (packed >> offset) & mask;
      values.push(value);
      offset += bits;
    }

    return values;
  }

  private applyOverflow(value: number, maxValue: number): number {
    switch (this.overflow) {
      case 'mod':
        if (value < 0) {
          return ((value % (maxValue + 1)) + (maxValue + 1)) % (maxValue + 1);
        }
        return value % (maxValue + 1);

      case 'clamp':
        return Math.max(0, Math.min(value, maxValue));

      case 'fail':
        if (value < 0 || value > maxValue) {
          throw new Error(
            `Value ${value} out of range [0, ${maxValue}] (overflow mode: fail)`,
          );
        }
        return value;
    }
  }

  get = (coordinates: Vector3D): number => {
    // Get packed integer at packed coordinates
    const targetIndex =
      coordinates.z * this.size.y * this.size.x +
      coordinates.y * this.size.x +
      coordinates.x;

    // Check dirty map first
    if (this.dirtyMap !== null && this.dirtyMap.has(targetIndex)) {
      return this.dirtyMap.get(targetIndex)!;
    }

    // Binary search RLE
    let left = 0;
    let right = this.values.length - 1;

    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const rangeStart = this.cumulativeCounts[mid];
      const rangeEnd = this.cumulativeCounts[mid + 1];

      if (targetIndex >= rangeStart && targetIndex < rangeEnd) {
        return this.values[mid];
      } else if (targetIndex < rangeStart) {
        right = mid - 1;
      } else {
        left = mid + 1;
      }
    }

    throw new Error(`Index ${targetIndex} out of bounds`);
  };

  set = (coordinates: Vector3D, packedValue: number): void => {
    // Set packed integer at packed coordinates
    const targetIndex =
      coordinates.z * this.size.y * this.size.x +
      coordinates.y * this.size.x +
      coordinates.x;

    // Lazy initialize dirty map
    if (this.dirtyMap === null) {
      this.dirtyMap = new Map<number, number>();
    }

    // Apply overflow to packed value
    const maxValue = (1 << this.bitWidth) - 1;
    const processedValue = this.applyOverflow(packedValue, maxValue);

    // Store in dirty map
    this.dirtyMap.set(targetIndex, processedValue);

    // Check if we've exceeded memory threshold
    const dirtyRatio = this.dirtyMap.size / this.totalCellCount;
    if (dirtyRatio >= this.maxMemoryThreshold) {
      this.flush();
    }
  };

  getUnpacked = (coordinates: Vector3D): number[] => {
    if (!this.bitPackingConfig) {
      throw new Error(
        'Bit packing not enabled. Use get() for direct value retrieval.',
      );
    }

    // Convert logical coords to packed coords
    const packRatio = this.bitPackingConfig.length;
    const linearLogicalIndex =
      coordinates.z * this.logicalSize.y * this.logicalSize.x +
      coordinates.y * this.logicalSize.x +
      coordinates.x;

    const packedIndex = Math.floor(linearLogicalIndex / packRatio);

    // Convert packed index to packed coordinates
    const px = packedIndex % this.size.x;
    const py = Math.floor(packedIndex / this.size.x) % this.size.y;
    const pz = Math.floor(packedIndex / (this.size.x * this.size.y));

    const packedCoords = new Vector3D(px, py, pz);
    const packed = this.get(packedCoords);

    return this.unpackValue(packed);
  };

  setPacked = (coordinates: Vector3D, values: number[]): void => {
    if (!this.bitPackingConfig) {
      throw new Error(
        'Bit packing not enabled. Use set() for direct value assignment.',
      );
    }

    if (values.length !== this.bitPackingConfig.length) {
      throw new Error(
        `Expected ${this.bitPackingConfig.length} values, got ${values.length}`,
      );
    }

    // Convert logical coords to packed coords
    const packRatio = this.bitPackingConfig.length;
    const linearLogicalIndex =
      coordinates.z * this.logicalSize.y * this.logicalSize.x +
      coordinates.y * this.logicalSize.x +
      coordinates.x;

    const packedIndex = Math.floor(linearLogicalIndex / packRatio);

    // Convert packed index to packed coordinates
    const px = packedIndex % this.size.x;
    const py = Math.floor(packedIndex / this.size.x) % this.size.y;
    const pz = Math.floor(packedIndex / (this.size.x * this.size.y));

    const packedCoords = new Vector3D(px, py, pz);
    const packed = this.packValues(values);

    this.set(packedCoords, packed);
  };

  flush = (): void => {
    // Nothing to flush if no dirty values
    if (this.dirtyMap === null || this.dirtyMap.size === 0) {
      return;
    }

    // Expand RLE to packed array
    const packedData: number[] = [];

    for (let pairIndex = 0; pairIndex < this.values.length; pairIndex++) {
      const value = this.values[pairIndex];
      const count = this.counts[pairIndex];

      for (let r = 0; r < count; r++) {
        packedData.push(value);
      }
    }

    // Apply dirty map changes
    for (const [idx, value] of this.dirtyMap) {
      packedData[idx] = value;
    }

    // Recompress
    this.compressPackedData(packedData);

    // Clear dirty map
    this.dirtyMap.clear();
    this.dirtyMap = null;

    // Notify callback
    if (this.onFlushCallback) {
      this.onFlushCallback();
    }
  };

  expand = (): Array3D<number> => {
    // Return fully unpacked Array3D with logical dimensions
    const result = new Array3D<number>(this.logicalSize);

    if (this.bitPackingConfig) {
      // Expand RLE to packed array
      const packedData: number[] = [];
      for (let pairIndex = 0; pairIndex < this.values.length; pairIndex++) {
        const value = this.values[pairIndex];
        const count = this.counts[pairIndex];

        for (let r = 0; r < count; r++) {
          // Check dirty map
          const idx = packedData.length;
          if (this.dirtyMap !== null && this.dirtyMap.has(idx)) {
            packedData.push(this.dirtyMap.get(idx)!);
          } else {
            packedData.push(value);
          }
        }
      }

      // Unpack all integers
      let logicalIndex = 0;
      for (let i = 0; i < packedData.length; i++) {
        const unpacked = this.unpackValue(packedData[i]);
        for (
          let j = 0;
          j < unpacked.length && logicalIndex < result.value.length;
          j++
        ) {
          result.value[logicalIndex] = unpacked[j];
          logicalIndex += 1;
        }
      }
    } else {
      // Direct expansion
      let index = 0;
      for (let pairIndex = 0; pairIndex < this.values.length; pairIndex++) {
        const value = this.values[pairIndex];
        const count = this.counts[pairIndex];

        for (let r = 0; r < count; r++) {
          // Check dirty map
          if (this.dirtyMap !== null && this.dirtyMap.has(index)) {
            result.value[index] = this.dirtyMap.get(index)!;
          } else {
            result.value[index] = value;
          }
          index += 1;
        }
      }
    }

    return result;
  };

  forEach = (
    callback: (
      cell: number,
      x: number,
      y: number,
      z: number,
      index: number,
    ) => void,
  ): void => {
    // Iterate with logical coordinates and unpacked values
    if (this.bitPackingConfig) {
      const width = this.logicalSize.x;
      const height = this.logicalSize.y;

      let x = 0;
      let y = 0;
      let z = 0;
      let logicalIndex = 0;
      let packedIndex = 0;

      // Iterate through RLE pairs
      for (let pairIndex = 0; pairIndex < this.values.length; pairIndex++) {
        let packedValue = this.values[pairIndex];
        const count = this.counts[pairIndex];

        for (let r = 0; r < count; r++) {
          // Check dirty map
          if (this.dirtyMap !== null && this.dirtyMap.has(packedIndex)) {
            packedValue = this.dirtyMap.get(packedIndex)!;
          }

          // Unpack and iterate
          const unpacked = this.unpackValue(packedValue);
          for (
            let j = 0;
            j < unpacked.length &&
            logicalIndex <
              this.logicalSize.x * this.logicalSize.y * this.logicalSize.z;
            j++
          ) {
            callback(unpacked[j], x, y, z, logicalIndex);

            x += 1;
            if (x >= width) {
              y += 1;
              x = 0;
            }
            if (y >= height) {
              z += 1;
              y = 0;
            }
            logicalIndex += 1;
          }
          packedIndex += 1;
        }
      }
    } else {
      // Direct iteration
      const width = this.size.x;
      const height = this.size.y;
      let x = 0;
      let y = 0;
      let z = 0;
      let index = 0;

      for (let pairIndex = 0; pairIndex < this.values.length; pairIndex++) {
        const value = this.values[pairIndex];
        const count = this.counts[pairIndex];

        for (let r = 0; r < count; r++) {
          // Check dirty map
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
    }
  };

  setOnFlushCallback = (callback: (() => void) | null): void => {
    this.onFlushCallback = callback;
  };
}

export function lerp(a: number, b: number, t: number): number {
  return a + t * (b - a);
}
