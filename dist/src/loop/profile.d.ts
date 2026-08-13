export type LoopPhase = 'init' | 'update' | 'dispose' | 'transforms' | 'render' | 'messages';
export interface ComponentTypeTiming {
    totalMs: number;
    count: number;
}
export interface ComponentInstanceTiming {
    name: string;
    type: string;
    totalMs: number;
    count: number;
}
export interface FrameProfile {
    timestamp: number;
    frameTime: number;
    fps: number;
    phases: Record<LoopPhase, number>;
    byType: Record<string, ComponentTypeTiming>;
    byInstance: Record<number, ComponentInstanceTiming>;
}
export declare function setProfilingEnabled(enabled: boolean): void;
export declare function isProfilingEnabled(): boolean;
export declare function beginFrame(): void;
export declare function recordPhase(phase: LoopPhase, ms: number): void;
export declare function recordComponentUpdate(id: number, name: string, type: string, ms: number): void;
export declare function endFrame(frameTime: number, fps: number): void;
export declare function getLastFrameProfile(): FrameProfile | null;
export declare function getFrameHistory(count?: number): FrameProfile[];
//# sourceMappingURL=profile.d.ts.map