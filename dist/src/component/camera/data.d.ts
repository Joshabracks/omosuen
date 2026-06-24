import { ComponentData, ComponentOptions, ComponentSerializer, ComponentUnique, ComponentInstanceMethods } from '../types';
import type { CameraMethods } from './methods';
type RGB = {
    x: number;
    y: number;
    z: number;
};
export interface DepthCues {
    outline: {
        weight: number;
        threshold: number;
        width: number;
        color: RGB;
    };
    ao: {
        weight: number;
        radius: number;
        scatter: number;
    };
    shadow: {
        weight: number;
        distance: number;
    };
    heightRamp: {
        weight: number;
        minY: number;
        maxY: number;
        lowColor: RGB;
        highColor: RGB;
    };
}
export interface DepthCuesOptions {
    outline?: {
        weight?: number;
        threshold?: number;
        width?: number;
        color?: Partial<RGB>;
    };
    ao?: {
        weight?: number;
        radius?: number;
        scatter?: number;
    };
    shadow?: {
        weight?: number;
        distance?: number;
    };
    heightRamp?: {
        weight?: number;
        minY?: number;
        maxY?: number;
        lowColor?: Partial<RGB>;
        highColor?: Partial<RGB>;
    };
}
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
    depthCues: DepthCues | null;
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
    depthCues?: DepthCuesOptions;
}
export declare function builder(options: CameraOptions): CameraT;
export declare const CameraSerializer: ComponentSerializer;
export declare const PROPERTY_ALLOWLIST: string[];
export {};
//# sourceMappingURL=data.d.ts.map