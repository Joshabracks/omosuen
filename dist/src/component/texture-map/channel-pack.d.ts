import { Vector2D } from '../../math';
export type PackChannel = 'r' | 'g' | 'b' | 'a';
export type ChannelReadSource = PackChannel | 'luminance';
export type ChannelSource = CanvasImageSource | ImageData | Blob | string | number;
export interface ChannelSpec {
    source: ChannelSource;
    from?: ChannelReadSource;
    default?: number;
    quantize?: number;
}
export type ChannelFit = 'error' | 'scale' | 'top-left';
export interface ChannelPackOptions {
    size?: Vector2D;
    fit?: ChannelFit;
    alpha?: number;
    label?: string;
}
export interface ChannelPlane {
    data: Uint8ClampedArray | null;
    from: 0 | 1 | 2 | 3 | 'luminance';
    defaultByte: number;
    quantize?: number;
}
export declare function readOffset(from: ChannelReadSource): 0 | 1 | 2 | 3 | 'luminance';
export declare function unitToByte(value: number): number;
export declare function quantizeByte(byte: number, levels: number): number;
export declare function interleaveChannels(planes: Partial<Record<PackChannel, ChannelPlane>>, width: number, height: number, alpha?: number): Uint8ClampedArray;
export declare function packChannels(channels: Partial<Record<PackChannel, ChannelSource | ChannelSpec>>, options?: ChannelPackOptions): Promise<HTMLCanvasElement>;
export declare function packMaterial(maps: {
    metallic?: ChannelSource | ChannelSpec;
    roughness?: ChannelSource | ChannelSpec;
    mask?: ChannelSource | ChannelSpec;
}, options?: ChannelPackOptions): Promise<HTMLCanvasElement>;
//# sourceMappingURL=channel-pack.d.ts.map