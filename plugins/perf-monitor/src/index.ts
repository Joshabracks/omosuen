// omosuen-perf-monitor — public ESM entry.
//
// Strict/bundler consumers: pass `perfMonitorDefinition` to the engine's
// `plugins` init option, or call `registerPerfMonitor()` once after the engine
// is initialized, then add a `perf-monitor` component to your scene. Call
// `exportPerfSnapshot()` (or the default backtick hotkey's HUD) to grab a
// point-in-time JSON report — no network calls, this is a static/browser-only
// engine, so the snapshot is a downloaded file plus a console.table, not
// telemetry sent anywhere.

import {
  registerPluginComponent,
  getFrameHistory,
  isProfilingEnabled,
  startSpikeCapture,
} from 'omosuen';
import type { FrameProfile, SpikeCaptureResult } from 'omosuen';
import { perfMonitorDefinition } from './component.js';
import { setConsoleHelpers } from './console-helpers.js';

export { perfMonitorDefinition } from './component.js';
export type { PerfMonitorT, PerfMonitorOptions } from './component.js';

/**
 * Convenience: register the `perf-monitor` component type with the engine.
 * Equivalent to passing `perfMonitorDefinition` in `Omosuen.init({ plugins })`.
 */
export function registerPerfMonitor(): void {
  registerPluginComponent(perfMonitorDefinition);
}

export interface PerfSnapshot {
  generatedAt: string;
  frameCount: number;
  avgFps: number;
  avgFrameTime: number;
  maxFrameTime: number;
  phaseAverages: Record<string, number>;
  byType: Record<
    string,
    { totalMs: number; count: number; avgMsPerInstance: number }
  >;
  frames: FrameProfile[];
}

function buildSnapshot(): PerfSnapshot | null {
  const frames = getFrameHistory();
  if (frames.length === 0) return null;

  const phaseTotals: Record<string, number> = {};
  const typeTotals: Record<string, { totalMs: number; count: number }> = {};
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

  const phaseAverages: Record<string, number> = {};
  for (const [phase, total] of Object.entries(phaseTotals)) {
    phaseAverages[phase] = total / frames.length;
  }

  const byType: PerfSnapshot['byType'] = {};
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
/** Formats a number of ms for the log, without dragging in float noise. */
function ms(n: number): string {
  return `${n.toFixed(2)}ms`;
}

/**
 * The component types that contributed most to one frame, as a compact inline
 * string -- enough to identify a spike's cause at a glance in the summary
 * table, with the full breakdown available in the per-frame groups below it.
 */
function topContributors(frame: FrameProfile, limit = 3): string {
  const rows = Object.entries(frame.byType)
    .filter(([, t]) => t.totalMs > 0.01)
    .sort((a, b) => b[1].totalMs - a[1].totalMs)
    .slice(0, limit);
  if (rows.length === 0) return '(nothing attributed)';
  return rows.map(([type, t]) => `${type} ${t.totalMs.toFixed(1)}`).join(', ');
}

/**
 * Watches the next `seconds` of frames and logs the `size` slowest ones, with
 * a full phase and component-type breakdown for each.
 *
 * This exists because intermittent jitter is genuinely hard to catch with the
 * other tools here: the HUD's tables refresh on a 1-second average, which
 * dilutes a single 40ms hitch into invisibility, and `exportPerfSnapshot`
 * dumps a rolling window that only holds ~5s at 60fps — by the time you feel a
 * stutter and reach for it, the frame that caused it has often already been
 * shifted out. This watches forward and keeps only the outliers, so you can
 * start it, pan until it stutters, and read back exactly what those frames
 * were doing.
 *
 * Frames are ranked by `workTime` -- the CPU time the frame itself spent --
 * NOT by `frameTime`. The two are a frame apart: `frameTime` is the interval
 * that elapsed BEFORE a record's work ran (see `FrameProfile.frameTime` in the
 * engine), so ranking by it surfaces the frames that FOLLOWED a stall rather
 * than the ones that caused it. Each row also reports `resultingInterval`, the
 * gap that frame's cost actually produced -- that is the stutter a player
 * feels, and pairing the two is what makes a spike's cause legible.
 *
 * Frames are judged against the window's own MEDIAN rather than its average,
 * since a handful of large spikes drag an average up toward themselves and
 * make everything look less anomalous than it is.
 *
 * ```js
 * await spikeLog();        // 5 seconds, worst 10 frames
 * await spikeLog(15, 25);  // 15 seconds, worst 25
 * ```
 *
 * Resolves with the raw result, so it can also be inspected or post-processed
 * rather than just read.
 */
export async function spikeLog(
  seconds = 5,
  size = 10,
): Promise<SpikeCaptureResult | null> {
  if (!isProfilingEnabled()) {
    console.warn(
      '[perf-monitor] profiling is off — add the perf-monitor component to ' +
        'the scene (or call setProfilingEnabled(true)) before spikeLog().',
    );
    return null;
  }

  console.info(
    `[perf-monitor] spikeLog: watching for ${seconds}s, keeping the worst ${size} frames…`,
  );
  const result = await startSpikeCapture(seconds, size);

  if (result.frameCount === 0) {
    console.warn(
      '[perf-monitor] spikeLog: no frames observed — is the game loop running?',
    );
    return result;
  }

  const { medianWorkTime: median } = result;
  console.group(
    `[perf-monitor] spikeLog — ${result.frameCount} frames over ` +
      `${result.durationSeconds.toFixed(1)}s`,
  );
  console.info(
    `baseline work/frame: median ${ms(median)} | avg ${ms(result.avgWorkTime)} | ` +
      `p95 ${ms(result.p95WorkTime)} | max ${ms(result.maxWorkTime)}`,
  );

  console.table(
    result.worst.map((frame, i) => ({
      '#': i + 1,
      workTime: +frame.workTime.toFixed(2),
      overMedian: +(frame.workTime - median).toFixed(2),
      xMedian: median > 0 ? +(frame.workTime / median).toFixed(2) : 0,
      // The interval this frame's cost produced — the stutter actually seen.
      causedInterval:
        frame.resultingInterval === undefined
          ? null
          : +frame.resultingInterval.toFixed(2),
      topContributors: topContributors(frame),
    })),
  );

  result.worst.forEach((frame, i) => {
    const caused =
      frame.resultingInterval === undefined
        ? ''
        : `, caused a ${ms(frame.resultingInterval)} interval`;
    console.groupCollapsed(
      `#${i + 1}  ${ms(frame.workTime)} of work  (+${ms(frame.workTime - median)} over median${caused})`,
    );
    const phases = Object.entries(frame.phases)
      .filter(([, v]) => v > 0.01)
      .sort((a, b) => b[1] - a[1])
      .map(([phase, v]) => ({ phase, ms: +v.toFixed(3) }));
    if (phases.length > 0) {
      console.info('phases');
      console.table(phases);
    }
    const types = Object.entries(frame.byType)
      .filter(([, t]) => t.totalMs > 0.001)
      .sort((a, b) => b[1].totalMs - a[1].totalMs)
      .map(([type, t]) => ({
        type,
        totalMs: +t.totalMs.toFixed(3),
        count: t.count,
      }));
    if (types.length > 0) {
      console.info('by component type');
      console.table(types);
    }
    console.groupEnd();
  });

  console.groupEnd();
  return result;
}

export function exportPerfSnapshot(): PerfSnapshot | null {
  const snapshot = buildSnapshot();
  if (!snapshot) {
    console.warn(
      '[perf-monitor] no profiling data yet — is the perf-monitor component added to the scene?',
    );
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

// Hands the console-facing helpers to the leaf module the component pulls
// install/uninstall from. Registration only — nothing touches `window` until
// a perf-monitor component actually initializes. See console-helpers.ts.
setConsoleHelpers({ spikeLog, exportPerfSnapshot });

export {
  installConsoleHelpers,
  uninstallConsoleHelpers,
} from './console-helpers.js';
