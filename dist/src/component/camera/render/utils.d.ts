import { CellMapT } from '../../cell-map';
import { LightT } from '../../light';
import { NexusT } from '../../nexus';
import { TextureMapT } from '../../texture-map';
import { TransformT } from '../../transform';
import { ViewportT } from '../../viewport';
import { CameraT } from '../data';
export declare const FBO_OVERSCAN_PX = 2;
export declare function cacheLightUniformLocations(gl: WebGL2RenderingContext, program: WebGLProgram, cameraId: number): void;
export declare function clearLightUniformCache(cameraId: number): void;
export declare function snapCameraPosition(camX: number, camY: number, pixelScale: number, zoom: number): {
    x: number;
    y: number;
    remainderX: number;
    remainderY: number;
};
export declare function renderPostProcess(camera: CameraT, viewport: ViewportT, gl: WebGL2RenderingContext, subPixelOffset?: {
    remainderX: number;
    remainderY: number;
}): void;
export declare function renderCellMaps(camera: CameraT, _viewport: ViewportT, cellMaps: CellMapT[], cameraTransform: TransformT, sceneRoot: NexusT, gl: WebGL2RenderingContext, textureMapCache: Map<string, TextureMapT>, lights: LightT[]): void;
export declare function setLightUniforms(gl: WebGL2RenderingContext, cameraId: number, lights: LightT[]): void;
//# sourceMappingURL=utils.d.ts.map