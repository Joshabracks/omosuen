export declare class Vector2D {
    x: number;
    y: number;
    constructor(x: number, y: number);
    normalize(): Vector2D;
    add(other: Vector2D): Vector2D;
    subtract(other: Vector2D): Vector2D;
    multiply(scalar: number): Vector2D;
    divide(scalar: number): Vector2D;
    rotate(degrees: number): Vector2D;
    angleRadians(): number;
}
export declare class Vector3D {
    x: number;
    y: number;
    z: number;
    constructor(x: number, y: number, z: number);
    normalize(): Vector3D;
    add(other: Vector3D): Vector3D;
    subtract(other: Vector3D): Vector3D;
    multiply(scalar: number): Vector3D;
    divide(scalar: number): Vector3D;
    get r(): number;
    get g(): number;
    get b(): number;
}
export declare class Vector4D {
    x: number;
    y: number;
    z: number;
    w: number;
    constructor(x: number, y: number, z: number, w: number);
    normalize(): Vector4D;
    add(other: Vector4D): Vector4D;
    subtract(other: Vector4D): Vector4D;
    multiply(scalar: number): Vector4D;
    divide(scalar: number): Vector4D;
    toString(): string;
    get r(): number;
    get g(): number;
    get b(): number;
    get a(): number;
}
export interface RayTriangleHit {
    t: number;
    u: number;
    v: number;
}
export declare function rayTriangle(orig: Vector3D, dir: Vector3D, a: Vector3D, b: Vector3D, c: Vector3D): RayTriangleHit | null;
export declare class Array2D<T> {
    size: Vector2D;
    value: Array<T>;
    get width(): number;
    get height(): number;
    constructor(size: Vector2D, defaultValue?: T);
    set: (coordinates: Vector2D, v: T) => void;
    indexSet: (i: number, v: T) => void;
    get: (coordinates: Vector2D) => T;
    forEach: (callback: (cell: T, x: number, y: number, index: number) => void) => void;
    indexForEach: (callback: (cell: T, index: number) => void) => void;
}
export declare class Array3D<T> {
    size: Vector3D;
    value: Array<T>;
    get width(): number;
    get depth(): number;
    get height(): number;
    constructor(size: Vector3D, defaultValue?: T);
    set: (coordinates: Vector3D, v: T) => void;
    indexSet: (i: number, v: T) => void;
    get: (coordinates: Vector3D) => T;
    forEach: (callback: (cell: T, x: number, y: number, z: number, index: number) => void) => void;
    indexForEach: (callback: (cell: T, index: number) => void) => void;
}
export declare class Array3Dc<T> {
    size: Vector3D;
    values: T[];
    counts: Uint32Array;
    private cumulativeCounts;
    private dirtyMap;
    private maxMemoryThreshold;
    private totalCellCount;
    private onFlushCallback;
    get width(): number;
    get depth(): number;
    get height(): number;
    constructor(a: Array3D<T>, maxMemoryThreshold?: number);
    forEach: (callback: (cell: T, x: number, y: number, z: number, i: number) => void) => void;
    expand: () => Array3D<T>;
    set: (coordinates: Vector3D, value: T) => void;
    flush: () => void;
    setOnFlushCallback: (callback: (() => void) | null) => void;
    get: (coordinates: Vector3D) => T | undefined;
}
export declare class Array3Di {
    size: Vector3D;
    data: Uint8Array | Uint16Array | Uint32Array;
    private bitWidth;
    private bitPackingConfig;
    private overflow;
    get width(): number;
    get depth(): number;
    get height(): number;
    constructor(data: Array3D<number>, bitWidth?: 8 | 16 | 32, bitPackingConfig?: Array<1 | 2 | 4 | 8 | 16>, overflow?: 'mod' | 'clamp' | 'fail');
    private createTypedArray;
    private packValues;
    private unpackValue;
    private applyOverflow;
    set: (coordinates: Vector3D, value: number) => void;
    get: (coordinates: Vector3D) => number;
    indexSet: (index: number, value: number) => void;
    indexGet: (index: number) => number;
    setPacked: (coordinates: Vector3D, values: number[]) => void;
    getUnpacked: (coordinates: Vector3D) => number[];
    forEach: (callback: (cell: number, x: number, y: number, z: number, index: number) => void) => void;
    expand: () => Array3D<number>;
}
export declare class Array3Dic {
    size: Vector3D;
    values: number[];
    counts: Uint32Array;
    private cumulativeCounts;
    private dirtyMap;
    private bitWidth;
    private bitPackingConfig;
    private overflow;
    private maxMemoryThreshold;
    private totalCellCount;
    private logicalSize;
    private onFlushCallback;
    get width(): number;
    get depth(): number;
    get height(): number;
    get logicalWidth(): number;
    get logicalDepth(): number;
    get logicalHeight(): number;
    constructor(data: Array3D<number>, bitWidth?: 8 | 16 | 32, bitPackingConfig?: Array<1 | 2 | 4 | 8 | 16>, overflow?: 'mod' | 'clamp' | 'fail', maxMemoryThreshold?: number);
    private compressPackedData;
    private packValues;
    private unpackValue;
    private applyOverflow;
    get: (coordinates: Vector3D) => number;
    set: (coordinates: Vector3D, packedValue: number) => void;
    getUnpacked: (coordinates: Vector3D) => number[];
    setPacked: (coordinates: Vector3D, values: number[]) => void;
    flush: () => void;
    expand: () => Array3D<number>;
    forEach: (callback: (cell: number, x: number, y: number, z: number, index: number) => void) => void;
    setOnFlushCallback: (callback: (() => void) | null) => void;
}
export declare function lerp(a: number, b: number, t: number): number;
//# sourceMappingURL=index.d.ts.map