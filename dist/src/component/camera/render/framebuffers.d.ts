import { ViewportT } from '../../viewport';
import { CameraT } from '../data';
export interface SubPixelOffset {
    remainderX: number;
    remainderY: number;
}
export interface FboUvBridge {
    scaleX: number;
    scaleY: number;
    offsetX: number;
    offsetY: number;
}
export declare function computeBaseResolution(camera: CameraT, viewport: ViewportT): {
    width: number;
    height: number;
};
export declare function syncTargetResolutions(camera: CameraT, viewport: ViewportT): void;
export declare function allocateCameraTargets(gl: WebGL2RenderingContext, camera: CameraT, viewport: ViewportT): boolean;
export declare function disposeCameraTargets(gl: WebGL2RenderingContext | null, camera: CameraT): void;
export declare function computeFboUvBridge(camera: CameraT, subPixelOffset?: SubPixelOffset): FboUvBridge;
//# sourceMappingURL=framebuffers.d.ts.map