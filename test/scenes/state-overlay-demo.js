/**
 * State Overlay Demo Scene
 *
 * Demonstrates the `state-overlay` PLUGIN component (omosuen-state-overlay):
 * a reactive State Street UI, rendered on-demand by State Street's own v3.0.0+
 * scheduler. Clicking +1 mutates `state.data.count`; the {{count}} binding
 * patches in place — a mutation schedules exactly one coalesced render,
 * independent of the Omosuen engine loop; there's no per-frame driving at all.
 */

const Omosuen = window.Omosuen;

// Register the reactive UI bundle. `window.OmosuenStateOverlay` is exposed by the
// plugin's browser file, loaded via Omosuen.init({ plugins: [...] }) before this
// scene module is imported.
if (window.OmosuenStateOverlay) {
  window.OmosuenStateOverlay.registerStateBundle('counter', {
    template: `
      <div id="ss-demo" style="position:absolute;top:0;left:0;width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:system-ui,sans-serif;color:#e8e8e8;background:#10131a;gap:20px;">
        <h1 style="margin:0;font-size:48px;">Count: {{count}}</h1>
        <div style="display:flex;gap:12px;">
          <button id="ss-inc" :click=increment() style="padding:12px 24px;font-size:18px;cursor:pointer;">+1</button>
          <button id="ss-dec" :click=decrement() style="padding:12px 24px;font-size:18px;cursor:pointer;">-1</button>
          <button id="ss-reset" :click=reset() style="padding:12px 24px;font-size:18px;cursor:pointer;">reset</button>
        </div>
        <p style="opacity:0.6;max-width:480px;text-align:center;">
          Reactive State Street overlay, self-scheduled on mutation (autoRender:true).
          The heading patches in place on each mutation.
        </p>
      </div>
    `,
    data: { count: 0 },
    methods: {
      increment: ({ state }) => {
        state.data.count += 1;
      },
      decrement: ({ state }) => {
        state.data.count -= 1;
      },
      reset: ({ state }) => {
        state.data.count = 0;
      },
    },
  });
} else {
  console.error(
    '[state-overlay-demo] window.OmosuenStateOverlay not found — was the plugin loaded via Omosuen.init({ plugins })?',
  );
}

export async function createScene() {
  const scene = await Omosuen.newComponent('nexus', {
    name: 'State Overlay Demo',
  });

  const overlay = await Omosuen.newComponent('state-overlay', {
    name: 'Counter Overlay',
    bundleKey: 'counter',
  });
  scene.addComponent(overlay);

  return scene;
}
