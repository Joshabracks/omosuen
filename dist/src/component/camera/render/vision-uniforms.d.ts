import { VisionSourceT } from '../../vision-source';
import { Vector3D } from '../../../math';
export declare const MAX_VISION_SOURCES = 8;
export declare function cacheVisionUniformLocations(gl: WebGL2RenderingContext, program: WebGLProgram, cameraId: number): void;
export declare function getResolvedVisionSources(): readonly {
    source: VisionSourceT;
    pos: Vector3D;
}[];
export declare function clearVisionUniformCache(cameraId: number): void;
export declare function setVisionUniforms(gl: WebGL2RenderingContext, cameraId: number, visionSources: VisionSourceT[], useLineOfSight?: boolean): void;
//# sourceMappingURL=vision-uniforms.d.ts.map