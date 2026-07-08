import { LightT } from '../../light';
export declare const FBO_OVERSCAN_PX = 2;
export declare const MAX_POINT_LIGHTS = 64;
export declare function cacheLightUniformLocations(gl: WebGL2RenderingContext, program: WebGLProgram, cameraId: number): void;
export declare function clearLightUniformCache(cameraId: number): void;
export declare function setAngleUniform(gl: WebGL2RenderingContext, cameraId: number, angleDegrees: number): void;
export declare function setLightUniforms(gl: WebGL2RenderingContext, cameraId: number, lights: LightT[]): void;
//# sourceMappingURL=light-uniforms.d.ts.map