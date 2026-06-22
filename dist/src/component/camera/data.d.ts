import { ComponentData, ComponentOptions, ComponentSerializer, ComponentUnique, ComponentInstanceMethods } from '../types';
import type { CameraMethods } from './methods';
export interface CameraT extends ComponentData, ComponentInstanceMethods<CameraMethods> {
    type: 'camera';
    unique: ComponentUnique.LOCAL;
    zoom: number;
    pixelScale: number;
    axonometricAngle: number;
    viewportRef: string;
    zoomTarget: {
        x: number;
        y: number;
    } | null;
    revealTarget: {
        x: number;
        y: number;
        z: number;
    } | null;
    revealYOffset: number;
    revealFadeHeight: number;
    revealRadius: number;
    revealVolume: {
        min: {
            x: number;
            y: number;
            z: number;
        };
        max: {
            x: number;
            y: number;
            z: number;
        };
    } | null;
    glResources: {
        unifiedProgram: WebGLProgram | null;
        renderModeLocation: WebGLUniformLocation | null;
        atlasTextures: (WebGLTexture | null)[];
        atlasVersion: number;
        quadVertexBuffer: WebGLBuffer | null;
        quadUVBuffer: WebGLBuffer | null;
        framebuffer: WebGLFramebuffer | null;
        renderTexture: WebGLTexture | null;
        depthTexture: WebGLTexture | null;
        postProcessProgram: WebGLProgram | null;
        fullscreenQuadBuffer: WebGLBuffer | null;
        baseResolution: {
            width: number;
            height: number;
        };
        visibilityTexture: WebGLTexture | null;
    };
}
export interface CameraOptions extends ComponentOptions {
    zoom?: number;
    pixelScale?: number;
    axonometricAngle?: number;
    viewportRef: string;
    revealYOffset?: number;
    revealFadeHeight?: number;
    revealRadius?: number;
}
export declare function builder(options: CameraOptions): CameraT;
export declare const CameraSerializer: ComponentSerializer;
export declare const PROPERTY_ALLOWLIST: string[];
//# sourceMappingURL=data.d.ts.map