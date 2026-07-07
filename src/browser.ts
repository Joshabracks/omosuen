// omosuen-aseprite-loader — self-registering browser entry (the "JS file" plugin
// path). Bundled into a single classic script (see webpack.config.cjs) that, when
// loaded after the Omosuen UMD bundle, registers the `aseprite-loader` component
// type on the global.
//
// Usage: Omosuen.init({ plugins: ['./aseprite-loader.plugin.js'] }) — or load it
// via a <script> tag after omosuen.js.

import { asepriteLoaderDefinition } from './component.js';

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Omosuen?: { registerPluginComponent?: (def: any) => void };
  }
}

if (typeof window !== 'undefined') {
  const omo = window.Omosuen;
  if (omo && typeof omo.registerPluginComponent === 'function') {
    omo.registerPluginComponent(asepriteLoaderDefinition);
  } else {
    console.warn(
      '[aseprite-loader] window.Omosuen.registerPluginComponent not found — ' +
        'load the Omosuen engine before this plugin file.',
    );
  }
}
