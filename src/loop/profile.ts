/**
 * Frame Profiler
 *
 * Opt-in instrumentation for the game loop. Disabled by default — every call
 * site in the hot path (manager.ts, update.ts) starts with an
 * `isProfilingEnabled()` check, so when nothing has turned profiling on the
 * cost is a single boolean read, not a `performance.now()` call or an
 * allocation. A profiler plugin (e.g. omosuen-perf-monitor) flips the flag on
 * via `setProfilingEnabled(true)` in its own `init()`/`dispose()`.
 */

/** The named phases of a single game loop iteration (see loop/manager.ts's gameLoop()). */
export type LoopPhase =
  | 'init'
  | 'update'
  | 'dispose'
  | 'transforms'
  | 'render'
  | 'messages';

/** Accumulated update time for one component type across a single frame. */
export interface ComponentTypeTiming {
  totalMs: number;
  count: number;
}

/** A complete record of one frame's timing, retained in the rolling history. */
export interface FrameProfile {
  /** performance.now() timestamp when this frame's record was finalized. */
  timestamp: number;
  /** Total frame time in ms (same value as loop/manager.ts's getFrameTime()). */
  frameTime: number;
  fps: number;
  phases: Record<LoopPhase, number>;
  byType: Record<string, ComponentTypeTiming>;
}

const HISTORY_SIZE = 300;

let profilingEnabled = false;

function emptyPhases(): Record<LoopPhase, number> {
  return {
    init: 0,
    update: 0,
    dispose: 0,
    transforms: 0,
    render: 0,
    messages: 0,
  };
}

let currentPhases: Record<LoopPhase, number> = emptyPhases();
const currentByType = new Map<string, ComponentTypeTiming>();

const history: FrameProfile[] = [];

/**
 * Enables or disables frame profiling. Disabling clears all retained state
 * (current-frame accumulators and history) so a later re-enable starts clean.
 */
export function setProfilingEnabled(enabled: boolean): void {
  profilingEnabled = enabled;
  if (!enabled) {
    currentPhases = emptyPhases();
    currentByType.clear();
    history.length = 0;
  }
}

export function isProfilingEnabled(): boolean {
  return profilingEnabled;
}

/** Resets the per-frame accumulators. Called once at the start of gameLoop(). */
export function beginFrame(): void {
  currentPhases = emptyPhases();
  currentByType.clear();
}

/** Records time spent in a named loop phase, called once per phase per frame. */
export function recordPhase(phase: LoopPhase, ms: number): void {
  currentPhases[phase] += ms;
}

/** Records time spent updating a single component, accumulated by component type. */
export function recordComponentUpdate(type: string, ms: number): void {
  let entry = currentByType.get(type);
  if (!entry) {
    entry = { totalMs: 0, count: 0 };
    currentByType.set(type, entry);
  }
  entry.totalMs += ms;
  entry.count += 1;
}

/**
 * Finalizes the current frame's accumulators into a FrameProfile and pushes it
 * into the rolling history (dropping the oldest entry past HISTORY_SIZE).
 * Called once at the end of gameLoop().
 */
export function endFrame(frameTime: number, fps: number): void {
  const byType: Record<string, ComponentTypeTiming> = {};
  currentByType.forEach((value, key) => {
    byType[key] = { totalMs: value.totalMs, count: value.count };
  });
  history.push({
    timestamp: performance.now(),
    frameTime,
    fps,
    phases: currentPhases,
    byType,
  });
  if (history.length > HISTORY_SIZE) {
    history.shift();
  }
}

/** Returns the most recently completed frame's profile, or null if none yet. */
export function getLastFrameProfile(): FrameProfile | null {
  return history.length > 0 ? history[history.length - 1] : null;
}

/**
 * Returns up to `count` of the most recent frame profiles, oldest first.
 * Omit `count` for the full retained history (up to HISTORY_SIZE frames).
 */
export function getFrameHistory(count?: number): FrameProfile[] {
  if (count === undefined || count >= history.length) return history.slice();
  return history.slice(history.length - count);
}
