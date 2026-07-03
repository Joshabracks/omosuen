import type { ComponentData, ComponentMethods } from '../types';
import type { TextureMapT } from './data';
import type { OriginalFrame, PackedFrame } from './types';
export interface TextureMapMethods extends ComponentMethods {
    type: 'texture-map';
    getOriginalFrame: (tm: TextureMapT, frameIndex: number) => OriginalFrame | undefined;
    getPackedFrame: (tm: TextureMapT, frameIndex: number) => PackedFrame | undefined;
    isPacked: (tm: TextureMapT) => boolean;
    getFrameCount: (tm: TextureMapT) => number;
    clearPackedFrames: (tm: TextureMapT) => void;
    setPackedFrames: (tm: TextureMapT, packedFrames: PackedFrame[]) => void;
    dispose: (component: ComponentData) => void;
}
export declare const TextureMap: TextureMapMethods;
//# sourceMappingURL=methods.d.ts.map