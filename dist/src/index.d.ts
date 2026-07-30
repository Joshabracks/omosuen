import type { FrameProfile } from 'omosuen';
export { perfMonitorDefinition } from './component.js';
export type { PerfMonitorT, PerfMonitorOptions } from './component.js';
/**
 * Convenience: register the `perf-monitor` component type with the engine.
 * Equivalent to passing `perfMonitorDefinition` in `Omosuen.init({ plugins })`.
 */
export declare function registerPerfMonitor(): void;
export interface PerfSnapshot {
    generatedAt: string;
    frameCount: number;
    avgFps: number;
    avgFrameTime: number;
    maxFrameTime: number;
    phaseAverages: Record<string, number>;
    byType: Record<string, {
        totalMs: number;
        count: number;
        avgMsPerInstance: number;
    }>;
    frames: FrameProfile[];
}
/**
 * Builds a JSON-serializable report from the retained frame history (recent
 * frame records + per-phase and per-component-type aggregates), logs a
 * `console.table` of the per-type breakdown, and triggers a browser download
 * of the full report (`perf-snapshot-<timestamp>.json`) — a shareable artifact
 * for a bug report or before/after engine-version comparison.
 *
 * Returns null (and warns) if no profiling data exists yet, e.g. the
 * `perf-monitor` component hasn't been added to the scene.
 */
export declare function exportPerfSnapshot(): PerfSnapshot | null;
