import { Vector2D } from '../../math';
import { FrameMap } from './types';
import { ChannelSource } from './channel-pack';
export type FrameAlign = 'top' | 'bottom' | 'center';
export interface FrameStripOptions {
    cell?: Vector2D;
    align?: FrameAlign;
    label?: string;
}
export interface FrameStripResult {
    canvas: HTMLCanvasElement;
    frames: FrameMap;
    size: Vector2D;
}
export declare function packFrameStrip(frames: ChannelSource[], options?: FrameStripOptions): Promise<FrameStripResult>;
//# sourceMappingURL=frame-strip.d.ts.map