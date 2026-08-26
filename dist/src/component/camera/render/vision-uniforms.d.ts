import { VisionSourceT } from '../../vision-source';
export declare const MAX_VISION_SOURCES = 8;
export declare function cacheVisionUniformLocations(gl: WebGL2RenderingContext, program: WebGLProgram, cameraId: number): void;
export declare function clearVisionUniformCache(cameraId: number): void;
export declare function setVisionUniforms(gl: WebGL2RenderingContext, cameraId: number, visionSources: VisionSourceT[]): void;
//# sourceMappingURL=vision-uniforms.d.ts.map