/**
 * Aseprite Multi-Source Test Scene — one loader, many .aseprite files, ONE
 * animation-controller.
 *
 * Demonstrates the `sources` option on the `aseprite-loader` plugin: a single
 * loader on ONE entity nexus ingests multiple .aseprite files. Each source's
 * sprites/layers/tags are namespaced by its `id` (`swordman:...`, `dryad:...`,
 * animations `swordman-walk`, `dryad-walk`), and they all share a single merged
 * animation-controller and a single atlas pass — replacing the old
 * one-child-nexus-per-file workaround.
 *
 * Swapping a variant = show every layer whose name starts with `${id}:` and hide
 * the rest (NOT the engine `slot`, which stays reserved for per-source
 * `layerSlots`). The active source's animation is played in the SAME tick as the
 * reveal so no sprite ever renders a frame index from another source's timeline.
 *
 * Assets: test/assets/aseprite/{MiniSwordMan,MiniDryadDeer}.aseprite
 */

const Omosuen = window.Omosuen;

const ASE_BASE = './assets/aseprite/';

const SOURCES = [
  { id: 'swordman', file: 'MiniSwordMan.aseprite' },
  { id: 'dryad', file: 'MiniDryadDeer.aseprite' },
];

// Tags we expose buttons for (only those present on the active source play).
const TAG_BUTTONS = ['idle', 'walk', 'jump', 'attack', 'attack2', 'hit', 'death'];

let entity = null; // the single entity nexus holding the multi-source loader
let activeId = SOURCES[0].id;

function status(text) {
  const el = document.getElementById('asm-status');
  if (el) el.innerHTML = text;
}

function controllerOf(nexus) {
  return nexus ? nexus.getComponentByType('animation-controller', false) : null;
}

// ── Source-group visibility ─────────────────────────────────────────────────
// Show every layer whose name is prefixed `${id}:` (or exactly `${id}` for a
// flattened source), hide all others. Then play the source's idle in the SAME
// tick so freshly-revealed sprites don't hold a foreign source's frame index.
function applyActiveSource(id) {
  const ac = controllerOf(entity);
  if (!ac) return;
  for (const layer of ac.getLayers()) {
    const belongs = layer.name === id || layer.name.startsWith(`${id}:`);
    ac.setLayerVisible(layer.name, belongs);
  }
  activeId = id;
  const idle = `${id}-idle`;
  if (ac.hasAnimation(idle)) ac.play(idle, true);
  status(`Active source <strong>${id}</strong>`);
}

// ── UI ──────────────────────────────────────────────────────────────────────

Omosuen.registerHtmlConstructor('asepriteMultiTest', () => {
  const srcBtns = SOURCES.map(
    (s) =>
      `<button class="sidebar-button src-btn" data-id="${s.id}">Show ${s.id}</button>`,
  ).join('\n');
  const tagBtns = TAG_BUTTONS.map(
    (t) => `<button class="sidebar-button tag-btn" data-tag="${t}">${t}</button>`,
  ).join('\n');

  return `
    <div class="sidebar">
      <button id="btn-back" class="sidebar-back-button">← Back</button>
      <h1 class="sidebar-title">Aseprite Multi-Source</h1>
      <div class="sidebar-section">
        <div id="asm-status" class="sidebar-status">Loading…</div>
      </div>
      <div class="sidebar-section">
        <div style="text-align:center;color:#ff6600;font-size:13px;margin-bottom:8px;">SOURCE (one loader, one controller)</div>
        <div class="sidebar-controls" style="display:flex;flex-direction:column;gap:4px;">${srcBtns}</div>
      </div>
      <div class="sidebar-section">
        <div style="text-align:center;color:#ff6600;font-size:13px;margin-bottom:8px;">TAGS (active source)</div>
        <div class="sidebar-controls" style="display:flex;flex-direction:column;gap:4px;">${tagBtns}</div>
      </div>
    </div>
  `;
});

Omosuen.registerBinding('asmBackToMenu', async () => {
  await Omosuen.switchScene('main-menu');
});

Omosuen.registerBinding('asmShowSource', (event) => {
  const id = event.currentTarget && event.currentTarget.dataset.id;
  if (id) applyActiveSource(id);
});

Omosuen.registerBinding('asmPlayTag', (event) => {
  const tag = event.currentTarget && event.currentTarget.dataset.tag;
  const ac = controllerOf(entity);
  if (!ac || !tag) return;
  const name = `${activeId}-${tag}`;
  if (!ac.hasAnimation(name)) {
    status(`'${name}' not in this source`);
    return;
  }
  ac.play(name, true);
  status(`Playing <strong>${name}</strong>`);
});

// ── Scene ─────────────────────────────────────────────────────────────────────

export async function createScene() {
  entity = null;
  activeId = SOURCES[0].id;

  const scene = await Omosuen.newComponent('nexus', {
    name: 'Aseprite Multi-Source Scene',
  });

  const atlasManager = await Omosuen.newComponent('atlas-manager', {
    name: 'AtlasManager',
    // retainAtlas: incremental packing — the recommended mode for dynamically
    // spawned multi-source entities (avoids full-set recompiles per loader).
    config: { atlasSize: 2048, maxAtlases: 16, padding: 1, retainAtlas: true },
  });
  scene.addComponent(atlasManager);

  const viewport = await Omosuen.newComponent('viewport', {
    name: 'ASM Viewport',
    width: 480,
    height: 480,
    offsetX: window.innerWidth / 2 - 240,
    offsetY: window.innerHeight / 2 - 240,
    backgroundColor: new Omosuen.Vector4D(0.1, 0.1, 0.15, 1.0),
  });
  scene.addComponent(viewport);

  const cameraNexus = await Omosuen.newComponent('nexus', { name: 'Camera Nexus' });
  scene.addComponent(cameraNexus);
  const cameraTransform = await Omosuen.newComponent('transform', {
    name: 'Camera Transform',
    position: new Omosuen.Vector3D(-100, 60, 0),
    rotation: new Omosuen.Vector3D(0, 0, 0),
    scale: new Omosuen.Vector3D(1, 1, 1),
  });
  cameraNexus.addComponent(cameraTransform);
  const camera = await Omosuen.newComponent('camera', {
    name: 'Main Camera',
    viewportRef: 'ASM Viewport',
    zoom: 1.0,
    axonometricAngle: 30,
  });
  cameraNexus.addComponent(camera);

  const ui = await Omosuen.newComponent('ui-overlay', {
    name: 'Aseprite Multi UI',
    htmlConstructorKey: 'asepriteMultiTest',
    bindings: [
      { selector: '#btn-back', onActions: ['click'], methodKey: 'asmBackToMenu' },
      { selector: '.src-btn', onActions: ['click'], methodKey: 'asmShowSource' },
      { selector: '.tag-btn', onActions: ['click'], methodKey: 'asmPlayTag' },
    ],
  });
  scene.addComponent(ui);

  // The entity: ONE nexus, ONE loader, MANY files.
  const nexus = await Omosuen.newComponent('nexus', { name: 'Unit' });
  scene.addComponent(nexus);
  const transform = await Omosuen.newComponent('transform', {
    name: 'Unit Transform',
    position: new Omosuen.Vector3D(0, 0, 0),
    rotation: new Omosuen.Vector3D(0, 0, 0),
    scale: new Omosuen.Vector3D(6, 6, 6),
  });
  nexus.addComponent(transform);

  const loader = await Omosuen.newComponent('aseprite-loader', {
    name: 'unit',
    sources: SOURCES.map((s) => ({ filePath: ASE_BASE + s.file, id: s.id })),
    flatten: false,
    visibleOnly: true,
    anchorMode: 'bottom-center',
  });
  nexus.addComponent(loader);
  entity = nexus;

  // Await the loader's init (the engine `ready` promise), then verify the
  // multi-source invariants and select the first source.
  loader.ready.then(() => {
    const controllers = nexus.getComponentsByType('animation-controller');
    const ac = controllerOf(nexus);
    const animNames = ac ? [...ac.animations.keys()] : [];
    console.log(
      `[Aseprite Multi] controllers on unit nexus: ${controllers.length} (expect 1)`,
    );
    console.log(`[Aseprite Multi] merged animations: ${animNames.join(', ')}`);
    console.log(
      `[Aseprite Multi] layers: ${ac ? ac.getLayers().length : 0}, atlases: ${atlasManager.getAtlasCount()}`,
    );
    applyActiveSource(SOURCES[0].id);
  });

  status('Loading two sources into one controller…');
  return scene;
}
