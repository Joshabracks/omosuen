export type ResolvedSource = {
    kind: 'constant';
    value: number;
} | {
    kind: 'pixels';
    data: Uint8ClampedArray;
    width: number;
    height: number;
} | {
    kind: 'image';
    image: CanvasImageSource;
    width: number;
    height: number;
};
export declare function sourceDimensions(src: CanvasImageSource): {
    width: number;
    height: number;
};
export declare function createPackCanvas(width: number, height: number, willReadFrequently?: boolean): HTMLCanvasElement;
export declare function get2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D;
export declare function resolveSource(source: unknown, label?: string): Promise<ResolvedSource>;
export declare function readPixels(ctx: CanvasRenderingContext2D, width: number, height: number, label: string): Uint8ClampedArray;
//# sourceMappingURL=image-source.d.ts.map