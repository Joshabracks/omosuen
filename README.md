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

## Build

```
npm run build
```

Produces `dist/src/*.js` (ESM, for the TS/bundler path) and
`dist/perf-monitor.plugin.js` (a self-registering classic script, for the
filepath-string plugin path).
