import { CameraT } from '../data';
export declare function setZoom(camera: CameraT, zoom: number): void;
export declare function setZoomTarget(camera: CameraT, x: number, y: number): void;
export declare function resetZoomTarget(camera: CameraT): void;
export declare function setOrbitYaw(camera: CameraT, degrees: number): void;
export declare function orbitBy(camera: CameraT, deltaDegrees: number): void;
export declare function setPixelScale(camera: CameraT, pixelScale: number): void;
export declare function setRevealTarget(camera: CameraT, x: number, y: number, z: number): void;
export declare function clearRevealTarget(camera: CameraT): void;
export declare function setRevealVolume(camera: CameraT, min: {
    x: number;
    y: number;
    z: number;
}, max: {
    x: number;
    y: number;
    z: number;
}): void;
export declare function clearRevealVolume(camera: CameraT): void;
//# sourceMappingURL=index.d.ts.map