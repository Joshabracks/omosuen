import type { FogOfWarT } from '../../fog-of-war/data';
export declare function cacheFogUniformLocations(gl: WebGL2RenderingContext, program: WebGLProgram, cameraId: number): void;
export declare function clearFogUniformCache(cameraId: number): void;
export declare function fogUsesExploredHistory(fogOfWar: FogOfWarT | null): boolean;
export declare function setFogUniforms(gl: WebGL2RenderingContext, cameraId: number, fogOfWar: FogOfWarT | null): void;
//# sourceMappingURL=fog-uniforms.d.ts.map