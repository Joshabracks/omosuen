export type LoopPhase = 'init' | 'update' | 'dispose' | 'transforms' | 'onscreen' | 'render' | 'messages';
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
    workTime: number;
    resultingInterval?: number;
    fps: number;
    phases: Record<LoopPhase, number>;
    byType: Record<string, ComponentTypeTiming>;
    byInstance: Record<number, ComponentInstanceTiming>;
}
export interface SpikeCaptureResult {
    durationSeconds: number;
    frameCount: number;
    avgWorkTime: number;
    medianWorkTime: number;
    p95WorkTime: number;
    maxWorkTime: number;
    worst: FrameProfile[];
}
export declare function setProfilingEnabled(enabled: boolean): void;
export declare function isProfilingEnabled(): boolean;
export declare function beginFrame(): void;
export declare function recordPhase(phase: LoopPhase, ms: number): void;
export declare function recordComponentUpdate(id: number, name: string, type: string, ms: number): void;
export declare function endFrame(frameTime: number, fps: number, frameStart: number): void;
export declare function startSpikeCapture(durationSeconds?: number, size?: number): Promise<SpikeCaptureResult>;
export declare function isSpikeCaptureActive(): boolean;
export declare function getLastFrameProfile(): FrameProfile | null;
export declare function getFrameHistory(count?: number): FrameProfile[];
//# sourceMappingURL=profile.d.ts.map