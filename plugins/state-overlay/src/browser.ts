// omosuen-state-overlay — self-registering browser entry (the "JS file" plugin
// path). Bundled into a single classic script (see webpack.config.cjs) that, when
// loaded after the Omosuen UMD bundle, registers the state-overlay component type
// on the global and exposes bundle registration to the host page.
//
// Usage: Omosuen.init({ plugins: ['./state-overlay.plugin.js'] }) — or load it via
// a <script> tag after omosuen.js.

import { stateOverlayDefinition, registerStateBundle } from './component.js';

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Omosuen?: { registerPluginComponent?: (def: any) => void };
    OmosuenStateOverlay?: { registerStateBundle: typeof registerStateBundle };
  }
}

if (typeof window !== 'undefined') {
  const omo = window.Omosuen;
  if (omo && typeof omo.registerPluginComponent === 'function') {
    omo.registerPluginComponent(stateOverlayDefinition);
  } else {
    console.warn(
      '[state-overlay] window.Omosuen.registerPluginComponent not found — ' +
        'load the Omosuen engine before this plugin file.',
    );
  }
  // Let the host page register UI bundles before loading a scene.
  window.OmosuenStateOverlay = { registerStateBundle };
}
