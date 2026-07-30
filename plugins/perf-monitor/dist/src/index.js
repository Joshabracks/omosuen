// omosuen-perf-monitor — public ESM entry.
//
// Strict/bundler consumers: pass `perfMonitorDefinition` to the engine's
// `plugins` init option, or call `registerPerfMonitor()` once after the engine
// is initialized, then add a `perf-monitor` component to your scene. Call
// `exportPerfSnapshot()` (or the default backtick hotkey's HUD) to grab a
// point-in-time JSON report — no network calls, this is a static/browser-only
// engine, so the snapshot is a downloaded file plus a console.table, not
// telemetry sent anywhere.
import { registerPluginComponent, getFrameHistory } from 'omosuen';
import { perfMonitorDefinition } from './component.js';
export { perfMonitorDefinition } from './component.js';
/**
 * Convenience: register the `perf-monitor` component type with the engine.
 * Equivalent to passing `perfMonitorDefinition` in `Omosuen.init({ plugins })`.
 */
export function registerPerfMonitor() {
    registerPluginComponent(perfMonitorDefinition);
}
function buildSnapshot() {
    const frames = getFrameHistory();
    if (frames.length === 0)
        return null;
    const phaseTotals = {};
    const typeTotals = {};
    let fpsSum = 0;
    let frameTimeSum = 0;
    let maxFrameTime = 0;
    for (const frame of frames) {
        fpsSum += frame.fps;
        frameTimeSum += frame.frameTime;
        maxFrameTime = Math.max(maxFrameTime, frame.frameTime);
        for (const [phase, ms] of Object.entries(frame.phases)) {
            phaseTotals[phase] = (phaseTotals[phase] ?? 0) + ms;
        }
        for (const [type, timing] of Object.entries(frame.byType)) {
            const entry = typeTotals[type] ?? { totalMs: 0, count: 0 };
            entry.totalMs += timing.totalMs;
            entry.count += timing.count;
            typeTotals[type] = entry;
        }
    }
    const phaseAverages = {};
    for (const [phase, total] of Object.entries(phaseTotals)) {
        phaseAverages[phase] = total / frames.length;
    }
    const byType = {};
    for (const [type, entry] of Object.entries(typeTotals)) {
        byType[type] = {
            totalMs: entry.totalMs,
            count: entry.count,
            avgMsPerInstance: entry.count > 0 ? entry.totalMs / entry.count : 0,
        };
    }
    return {
        generatedAt: new Date().toISOString(),
        frameCount: frames.length,
        avgFps: fpsSum / frames.length,
        avgFrameTime: frameTimeSum / frames.length,
        maxFrameTime,
        phaseAverages,
        byType,
        frames,
    };
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
export function exportPerfSnapshot() {
    const snapshot = buildSnapshot();
    if (!snapshot) {
        console.warn('[perf-monitor] no profiling data yet — is the perf-monitor component added to the scene?');
        return null;
    }
    const tableRows = Object.entries(snapshot.byType)
        .sort((a, b) => b[1].totalMs - a[1].totalMs)
        .map(([type, t]) => ({ type, ...t }));
    console.table(tableRows);
    if (typeof document !== 'undefined') {
        const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
            type: 'application/json',
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `perf-snapshot-${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
    return snapshot;
}
