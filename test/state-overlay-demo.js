/**
 * State Overlay Demo entry — loads the omosuen-state-overlay plugin via the
 * `plugins` init option (filepath path), then runs the reactive demo scene.
 */

const Omosuen = window.Omosuen;

if (!Omosuen) {
  throw new Error(
    'Omosuen UMD bundle not loaded. Ensure ./dev/omosuen.js is included before state-overlay-demo.js',
  );
}

async function main() {
  // Plugin loaded via filepath → the engine appends it as a <script>, and it
  // self-registers the `state-overlay` component type on the Omosuen global.
  await Omosuen.init({
    logSuppression: 5,
    plugins: ['./dev/state-overlay.plugin.js'],
  });

  Omosuen.registerSceneModule('state-overlay-demo', '/scenes/state-overlay-demo.js');
  await Omosuen.switchScene('state-overlay-demo');

  Omosuen.start(60);
  console.log('[state-overlay-demo] running');
}

window.addEventListener('load', () => {
  main().catch((error) => {
    console.error('[state-overlay-demo] failed to initialize:', error);
  });
});
