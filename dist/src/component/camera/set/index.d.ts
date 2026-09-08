import { CameraT, PostEffectOptions, PostEffectUniformValue } from '../data';
export declare function setZoom(camera: CameraT, zoom: number): void;
export declare function setZoomTarget(camera: CameraT, x: number, y: number): void;
export declare function resetZoomTarget(camera: CameraT): void;
export declare function setOrbitYaw(camera: CameraT, degrees: number): void;
export declare function orbitBy(camera: CameraT, deltaDegrees: number): void;
export declare function setPixelScale(camera: CameraT, pixelScale: number): void;
export declare function resize(camera: CameraT): void;
export declare function setPostEffects(camera: CameraT, effects: PostEffectOptions[] | null): void;
export declare function setPostEffectEnabled(camera: CameraT, name: string, enabled: boolean): void;
export declare function setPostEffectUniform(camera: CameraT, name: string, key: string, value: PostEffectUniformValue): void;
//# sourceMappingURL=index.d.ts.map