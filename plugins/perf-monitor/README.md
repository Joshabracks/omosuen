# omosuen-perf-monitor

Official Omosuen plugin: an on-screen frame profiler HUD, powered by the
engine's opt-in profiler (`setProfilingEnabled` / `getLastFrameProfile` /
`getFrameHistory`, in `src/loop/profile.ts`). Shows FPS, a rolling frame-time
graph, a per-phase breakdown (init/update/dispose/transforms/render/messages),
and a per-component-type table sorted by cost — so a framerate drop can be
diagnosed instead of just observed.

## Usage

Filepath (self-registering `.plugin.js`, matches `aseprite-loader` /
`browser-local-storage`):

```js
await Omosuen.init({
  plugins: ['./dev/perf-monitor.plugin.js'],
});

await Omosuen.newComponent('perf-monitor', { name: 'PerfMonitor' });
```

TS/bundler path:

```ts
import { perfMonitorDefinition } from 'omosuen-perf-monitor';

await Omosuen.init({ plugins: [perfMonitorDefinition] });
await Omosuen.newComponent('perf-monitor', { name: 'PerfMonitor' });
```

### Options

```ts
{
  name: string;
  toggleKey?: string;   // default '`' — KeyboardEvent.key that shows/hides the HUD
  startVisible?: boolean; // default true
}
```

### Toggling / removal

- **Runtime hide/show**: press the toggle key (default backtick), or call
  `component.visible = ...` via your own key binding — the HUD's `display` is
  toggled without disposing the component, so the underlying instrumentation
  stays warm.
- **Runtime fully off**: dispose the `perf-monitor` component. Its `dispose()`
  calls `setProfilingEnabled(false)`, which turns the engine's per-frame
  instrumentation back into a single boolean check everywhere it's wired in
  (`loop/manager.ts`, `loop/update.ts`) — effectively zero cost.
- **Removed from a production build entirely**: don't include
  `perf-monitor.plugin.js` in `config.plugins` (or its `<script>` tag). The
  file is never fetched, `setProfilingEnabled(true)` is never called, and the
  engine's instrumentation guards never flip on.

### Exporting a snapshot

```js
import { exportPerfSnapshot } from 'omosuen-perf-monitor';
// or, from the self-registering browser build:
// window.OmosuenPerfMonitor.exportPerfSnapshot();

exportPerfSnapshot();
```

Logs a `console.table` of per-component-type timing and triggers a browser
download of `perf-snapshot-<timestamp>.json` — the retained frame history plus
phase/type aggregates. No network calls; this is a static/browser-only engine,
so the snapshot is a local artifact you can attach to a bug report or diff
across engine versions, not telemetry sent anywhere.

## Hunting jitter: `spikeLog`

```js
// From the browser console, with the browser build loaded:
await spikeLog();        // watch 5 seconds, report the worst 10 frames
await spikeLog(15, 25);  // watch 15 seconds, report the worst 25

// Or imported:
import { spikeLog } from 'omosuen-perf-monitor';
// (also available as window.OmosuenPerfMonitor.spikeLog)
```

Watches the next `seconds` of frames and logs the slowest `size` of them, each
with its full phase and per-component-type breakdown.

This exists for intermittent stutter, which the other two tools here genuinely
can't catch. The HUD's tables refresh on a 1-second average, so a single 40ms
hitch is diluted into nothing. `exportPerfSnapshot` dumps the rolling history,
which only holds ~5 seconds at 60fps — by the time you feel a stutter and reach
for it, the frame that caused it has usually already been shifted out.
`spikeLog` watches *forward* and keeps only the outliers, so the workflow is:
start it, then reproduce the stutter while it runs.

Spikes are reported against the window's **median** frame, not its average — a
few large spikes drag an average toward themselves and make everything look
less anomalous than it is. Each row shows absolute time, the amount over
median, the multiple of median, and the top contributing component types; the
collapsed group under each row has the complete breakdown.

Requires profiling to be on, which the `perf-monitor` component does in its
`init()` — if the component isn't in the scene, `spikeLog` warns and returns
`null` rather than silently reporting nothing. The window is closed by a timer
rather than a frame count, so it still reports if the loop stalls or stops
outright, which is the case most worth seeing.

## Build

```
npm run build
```

Produces `dist/src/*.js` (ESM, for the TS/bundler path) and
`dist/perf-monitor.plugin.js` (a self-registering classic script, for the
filepath-string plugin path).
