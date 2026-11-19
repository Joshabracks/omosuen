import { CameraT } from '../data';
import { SubPixelOffset } from './framebuffers';
export declare function renderPostChain(gl: WebGL2RenderingContext, camera: CameraT, cameraWorldPos: {
    x: number;
    y: number;
    z: number;
}, cellSize: {
    x: number;
    y: number;
    z: number;
}, subPixelOffset?: SubPixelOffset): WebGLTexture | null;
export declare function clearPostChainCache(gl: WebGL2RenderingContext | null, cameraId: number): void;
//# sourceMappingURL=post-chain.d.ts.map