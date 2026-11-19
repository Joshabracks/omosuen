import type { UnpackedFrame, AtlasSpace, PackerState } from './types';
export declare function createPackerState(atlasSize: number, maxAtlases: number, padding: number): PackerState;
export declare function packFramesInto(state: PackerState, frames: UnpackedFrame[]): UnpackedFrame[];
export declare function packFrames(frames: UnpackedFrame[], atlasSize: number, maxAtlases: number, padding: number): UnpackedFrame[];
export declare function freeFrameSlot(state: PackerState, slot: AtlasSpace): AtlasSpace | null;
//# sourceMappingURL=packer.d.ts.map