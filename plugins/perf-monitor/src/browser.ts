// omosuen-perf-monitor — self-registering browser entry (the "JS file" plugin
// path). Bundled into a single classic script (see webpack.config.cjs) that,
// when loaded after the Omosuen UMD bundle, registers the `perf-monitor`
// component type on the global and exposes `exportPerfSnapshot` to the host
// page.
//
// Usage: Omosuen.init({ plugins: ['./perf-monitor.plugin.js'] }) — or load it
// via a <script> tag after omosuen.js.

import { perfMonitorDefinition } from './component.js';
import { exportPerfSnapshot, spikeLog } from './index.js';

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Omosuen?: { registerPluginComponent?: (def: any) => void };
    OmosuenPerfMonitor?: {
      exportPerfSnapshot: typeof exportPerfSnapshot;
      spikeLog: typeof spikeLog;
    };
  }
}

if (typeof window !== 'undefined') {
  const omo = window.Omosuen;
  if (omo && typeof omo.registerPluginComponent === 'function') {
    omo.registerPluginComponent(perfMonitorDefinition);
  } else {
    console.warn(
      '[perf-monitor] window.Omosuen.registerPluginComponent not found — ' +
        'load the Omosuen engine before this plugin file.',
    );
  }
  window.OmosuenPerfMonitor = { exportPerfSnapshot, spikeLog };
  // The bare `window.spikeLog` / `window.exportPerfSnapshot` console aliases
  // are NOT installed here. They're installed by the perf-monitor component's
  // init() instead (see console-helpers.ts), which covers this build and the
  // ESM one alike -- installing them here too would only cover the path that
  // was already covered, and would leave module consumers without them.
}
