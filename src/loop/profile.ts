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
  | 'onscreen'
  | 'render'
  | 'messages';

/** Accumulated update time for one component type across a single frame. */
export interface ComponentTypeTiming {
  totalMs: number;
  count: number;
}

/** Accumulated update time for one component instance across a single frame. */
export interface ComponentInstanceTiming {
  name: string;
  type: string;
  totalMs: number;
  count: number;
}

/** A complete record of one frame's timing, retained in the rolling history. */
export interface FrameProfile {
  /** performance.now() timestamp when this frame's record was finalized. */
  timestamp: number;
  /**
   * The frame interval in ms (same value as loop/manager.ts's getFrameTime()).
   *
   * CAUTION -- this is the interval that elapsed BEFORE this record's work ran,
   * not the cost of that work. `deltaTime` is derived at the top of `gameLoop`
   * from the requestAnimationFrame timestamp (the gap since the previous
   * callback) and only reaches `endFrame` at the bottom, so it describes the
   * frame *preceding* the breakdown it is stored alongside. A record can
   * legitimately show 16ms here while its `byType` totals 24ms.
   *
   * Use `workTime` to ask "what did this frame cost", and `resultingInterval`
   * to ask "what did that cost produce". Ranking frames by `frameTime` finds
   * the frames that FOLLOWED a stall, not the ones that caused it.
   */
  frameTime: number;
  /**
   * CPU time in ms actually spent inside `gameLoop` for this frame -- the
   * causal quantity, and what `byType`/`phases` below add up to. Unlike
   * `frameTime` this is measured over the same span as the breakdown.
   */
  workTime: number;
  /**
   * The frame interval that FOLLOWED this record's work, back-filled once the
   * next frame reports it -- i.e. the stutter this frame's cost produced.
   * `undefined` on the most recent record, which has no successor yet.
   */
  resultingInterval?: number;
  fps: number;
  phases: Record<LoopPhase, number>;
  byType: Record<string, ComponentTypeTiming>;
  /** Keyed by component id. */
  byInstance: Record<number, ComponentInstanceTiming>;
}

/**
 * Summary of one spike capture window — see `startSpikeCapture`.
 *
 * Every statistic here is over `workTime` (what each frame cost), NOT
 * `frameTime` (the interval preceding it) — see `FrameProfile.frameTime` for
 * why the two must not be confused.
 */
export interface SpikeCaptureResult {
  /** How long the capture actually ran, in seconds. */
  durationSeconds: number;
  /** Frames observed during the window. */
  frameCount: number;
  avgWorkTime: number;
  /** Typical frame — the number a spike should be judged against, not the average. */
  medianWorkTime: number;
  p95WorkTime: number;
  maxWorkTime: number;
  /** The most expensive frames, costliest first, at most `size` of them. */
  worst: FrameProfile[];
}

interface ActiveSpikeCapture {
  size: number;
  startedAt: number;
  workTimes: number[];
  /** Ascending by workTime, capped at `size`, so index 0 is the one to beat. */
  worst: FrameProfile[];
  timer: ReturnType<typeof setTimeout> | null;
  resolve: (result: SpikeCaptureResult) => void;
}

const HISTORY_SIZE = 300;

let profilingEnabled = false;
let activeCapture: ActiveSpikeCapture | null = null;

function emptyPhases(): Record<LoopPhase, number> {
  return {
    init: 0,
    update: 0,
    dispose: 0,
    transforms: 0,
    onscreen: 0,
    render: 0,
    messages: 0,
  };
}

let currentPhases: Record<LoopPhase, number> = emptyPhases();
const currentByType = new Map<string, ComponentTypeTiming>();
const currentByInstance = new Map<number, ComponentInstanceTiming>();

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
    currentByInstance.clear();
    history.length = 0;
    // No more frames will be recorded, so close any capture out now with what
    // it has rather than leaving its caller awaiting a promise forever.
    if (activeCapture) finishSpikeCapture();
  }
}

export function isProfilingEnabled(): boolean {
  return profilingEnabled;
}

/** Resets the per-frame accumulators. Called once at the start of gameLoop(). */
export function beginFrame(): void {
  currentPhases = emptyPhases();
  currentByType.clear();
  currentByInstance.clear();
}

/** Records time spent in a named loop phase, called once per phase per frame. */
export function recordPhase(phase: LoopPhase, ms: number): void {
  currentPhases[phase] += ms;
}

/**
 * Records time spent updating a single component, accumulated both by
 * component type (for the type-level breakdown) and by component id (for the
 * per-instance breakdown, so a specific slow sprite/nexus/etc. can be
 * identified rather than just its type).
 */
export function recordComponentUpdate(
  id: number,
  name: string,
  type: string,
  ms: number,
): void {
  let typeEntry = currentByType.get(type);
  if (!typeEntry) {
    typeEntry = { totalMs: 0, count: 0 };
    currentByType.set(type, typeEntry);
  }
  typeEntry.totalMs += ms;
  typeEntry.count += 1;

  let instanceEntry = currentByInstance.get(id);
  if (!instanceEntry) {
    instanceEntry = { name, type, totalMs: 0, count: 0 };
    currentByInstance.set(id, instanceEntry);
  }
  instanceEntry.totalMs += ms;
  instanceEntry.count += 1;
}

/**
 * Finalizes the current frame's accumulators into a FrameProfile and pushes it
 * into the rolling history (dropping the oldest entry past HISTORY_SIZE).
 * Called once at the end of gameLoop().
 *
 * `frameStart` is `performance.now()` from the top of this tick, so the
 * frame's own CPU cost can be measured over exactly the span the accumulators
 * cover. `frameTime` cannot serve that purpose -- see `FrameProfile.frameTime`.
 */
export function endFrame(
  frameTime: number,
  fps: number,
  frameStart: number,
): void {
  const byType: Record<string, ComponentTypeTiming> = {};
  currentByType.forEach((value, key) => {
    byType[key] = { totalMs: value.totalMs, count: value.count };
  });
  const byInstance: Record<number, ComponentInstanceTiming> = {};
  currentByInstance.forEach((value, key) => {
    byInstance[key] = {
      name: value.name,
      type: value.type,
      totalMs: value.totalMs,
      count: value.count,
    };
  });
  const now = performance.now();
  // `frameTime` is the interval that preceded THIS frame's work, so it is the
  // interval the PREVIOUS record's work produced -- back-fill it there, where
  // it means "the stutter my cost caused". Costs one field write.
  const previous = history[history.length - 1];
  if (previous !== undefined) previous.resultingInterval = frameTime;

  const profile: FrameProfile = {
    timestamp: now,
    frameTime,
    workTime: now - frameStart,
    fps,
    phases: currentPhases,
    byType,
    byInstance,
  };
  history.push(profile);
  if (history.length > HISTORY_SIZE) {
    history.shift();
  }
  // Retained by the capture independently of `history`, so a spike frame
  // survives being shifted out of the rolling window.
  if (activeCapture) captureSpikeFrame(profile);
}

/**
 * Feeds one finalized frame into an in-flight spike capture, keeping only the
 * `size` slowest frames seen so far. `worst` is kept ascending by frameTime and
 * capped, so the comparison against the current window is a single check
 * against its first element -- the capture stays O(size) in memory and near-
 * zero cost per frame no matter how long the window runs.
 */
function captureSpikeFrame(profile: FrameProfile): void {
  const capture = activeCapture;
  if (!capture) return;
  capture.workTimes.push(profile.workTime);

  const { worst, size } = capture;
  if (worst.length >= size && profile.workTime <= worst[0].workTime) {
    return; // not expensive enough to displace anything
  }
  let i = worst.length;
  while (i > 0 && worst[i - 1].workTime > profile.workTime) i--;
  worst.splice(i, 0, profile);
  if (worst.length > size) worst.shift();
}

/** Finalizes an in-flight capture and resolves its promise. */
function finishSpikeCapture(): void {
  const capture = activeCapture;
  if (!capture) return;
  activeCapture = null;
  if (capture.timer !== null) clearTimeout(capture.timer);

  const times = capture.workTimes;
  const sorted = times.slice().sort((a, b) => a - b);
  const pick = (q: number): number =>
    sorted.length === 0
      ? 0
      : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
  const sum = times.reduce((acc, t) => acc + t, 0);

  capture.resolve({
    durationSeconds: (performance.now() - capture.startedAt) / 1000,
    frameCount: times.length,
    avgWorkTime: times.length > 0 ? sum / times.length : 0,
    medianWorkTime: pick(0.5),
    p95WorkTime: pick(0.95),
    maxWorkTime: sorted.length > 0 ? sorted[sorted.length - 1] : 0,
    // Costliest first, which is the order a reader wants.
    worst: capture.worst.slice().reverse(),
  });
}

/**
 * Records the slowest `size` frames over the next `durationSeconds`, resolving
 * with them plus the baseline distribution to compare them against.
 *
 * Built for hunting intermittent jitter, which the rolling history and the
 * HUD's 1-second averages both hide: a single 40ms hitch every few seconds
 * disappears into an average, and `HISTORY_SIZE` only retains ~5s at 60fps, so
 * by the time you notice a stutter and go looking, the frame is often already
 * gone. This watches forward instead of backward, and keeps only the outliers.
 *
 * Requires profiling to be enabled (`setProfilingEnabled`); frames are only
 * recorded while it is. Starting a capture while one is already running
 * abandons the earlier one -- its promise resolves immediately with whatever it
 * had collected, rather than being left dangling.
 *
 * The window is closed by a timer, not by frame count, so it still finishes and
 * reports if the loop stalls or stops entirely -- which is exactly the case
 * worth seeing.
 */
export function startSpikeCapture(
  durationSeconds = 5,
  size = 10,
): Promise<SpikeCaptureResult> {
  if (activeCapture) finishSpikeCapture();

  const safeDuration = Math.max(0.1, durationSeconds);
  const safeSize = Math.max(1, Math.floor(size));

  return new Promise<SpikeCaptureResult>((resolve) => {
    activeCapture = {
      size: safeSize,
      startedAt: performance.now(),
      workTimes: [],
      worst: [],
      timer: null,
      resolve,
    };
    activeCapture.timer = setTimeout(finishSpikeCapture, safeDuration * 1000);
  });
}

/** Whether a spike capture is currently running. */
export function isSpikeCaptureActive(): boolean {
  return activeCapture !== null;
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
