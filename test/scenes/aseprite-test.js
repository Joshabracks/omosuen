/**
 * Aseprite Test Scene — declarative, fully-static .aseprite ingestion.
 *
 * Demonstrates the `aseprite` component: it stores a `.aseprite` file URL +
 * config and, on init, statically fetches + parses it (no server/build step) and
 * builds the entity's layered sprites + animation-controller + texture-maps into
 * its own nexus. The sprites are stacked by renderOrder (bottom→top) sharing one
 * transform; the controller drives them in lockstep with the source's per-frame
 * durations. Buttons play tags, toggle individual layers (setLayerVisible), and
 * swap between the two sample files (flatten=false vs flatten=true).
 *
 * Assets: test/assets/aseprite/{MiniSwordMan,MiniDryadDeer}.aseprite
 */

const Omosuen = window.Omosuen;

const ASE_BASE = './assets/aseprite/';

// Tags we expose buttons for (only those present on the loaded file play).
const TAG_BUTTONS = ['idle', 'walk', 'jump', 'attack', 'attack2', 'hit', 'death'];

let currentEntity = null; // the entity nexus holding the aseprite component

function status(text) {
  const el = document.getElementById('ase-status');
  if (el) el.innerHTML = text;
}

function controllerOf(nexus) {
  return nexus ? nexus.getComponentByType('animation-controller', false) : null;
}

// ── UI ────────────────────────────────────────────────────────────────────────

Omosuen.registerHtmlConstructor('asepriteTest', () => {
  const tagBtns = TAG_BUTTONS.map(
    (t) =>
      `<button class="sidebar-button tag-btn" data-tag="${t}">${t}</button>`,
  ).join('\n');

  return `
    <div class="sidebar">
      <button id="btn-back" class="sidebar-back-button">← Back</button>
      <h1 class="sidebar-title">Aseprite Test</h1>
      <div class="sidebar-section">
        <div id="ase-status" class="sidebar-status">Loading…</div>
      </div>
      <div class="sidebar-section">
        <div class="sidebar-controls" style="display:flex;flex-direction:column;gap:4px;">
          <button class="sidebar-button file-btn" data-file="MiniSwordMan.aseprite" data-flatten="false">SwordMan (layered)</button>
          <button class="sidebar-button file-btn" data-file="MiniDryadDeer.aseprite" data-flatten="false">DryadDeer (layered)</button>
          <button class="sidebar-button file-btn" data-file="MiniSwordMan.aseprite" data-flatten="true">SwordMan (flattened)</button>
        </div>
      </div>
      <div class="sidebar-section">
        <div style="text-align:center;color:#ff6600;font-size:13px;margin-bottom:8px;">TAGS</div>
        <div class="sidebar-controls" style="display:flex;flex-direction:column;gap:4px;">${tagBtns}</div>
      </div>
      <div class="sidebar-section">
        <button id="btn-cycle-layers" class="sidebar-button">Toggle next layer</button>
      </div>
    </div>
  `;
});

Omosuen.registerBinding('aseBackToMenu', async () => {
  await Omosuen.switchScene('main-menu');
});

// Play a tag if the loaded controller has it.
Omosuen.registerBinding('asePlayTag', (event) => {
  const tag = event.currentTarget && event.currentTarget.dataset.tag;
  const ac = controllerOf(currentEntity);
  if (!ac || !tag) return;
  if (!ac.hasAnimation(tag)) {
    status(`'${tag}' not in this file`);
    return;
  }
  ac.play(tag, true);
  status(`Playing <strong>${tag}</strong>`);
});

// Swap the loaded file by replacing the entity's aseprite component.
Omosuen.registerBinding('aseLoadFile', async (event) => {
  const file = event.currentTarget && event.currentTarget.dataset.file;
  const flatten = event.currentTarget.dataset.flatten === 'true';
  if (!file) return;
  const scene = Omosuen.getActiveScene();
  if (!scene) return;
  await loadEntity(scene, file, flatten);
});

// Toggle layers one at a time so stacking/visibility is visible.
let layerCursor = 0;
Omosuen.registerBinding('aseCycleLayers', () => {
  const ac = controllerOf(currentEntity);
  if (!ac) return;
  const layers = ac.getLayers();
  if (!layers.length) return;
  const layer = layers[layerCursor % layers.length];
  layerCursor++;
  ac.setLayerVisible(layer.name, !layer.visible);
  status(
    `Layer <strong>${layer.name}</strong> → ${!layer.visible ? 'shown' : 'hidden'}`,
  );
});

// ── Entity load ────────────────────────────────────────────────────────────────

async function loadEntity(scene, file, flatten) {
  // Dispose the previous entity nexus, if any.
  if (currentEntity) {
    currentEntity.dispose();
    scene.components = scene.components.filter((c) => c !== currentEntity);
    currentEntity = null;
  }
  layerCursor = 0;

  const nexus = await Omosuen.newComponent('nexus', { name: `Ase ${file}` });
  scene.addComponent(nexus);

  // The entity's transform (the aseprite importer reuses it).
  const transform = await Omosuen.newComponent('transform', {
    name: 'Ase Transform',
    position: new Omosuen.Vector3D(0, 0, 0),
    rotation: new Omosuen.Vector3D(0, 0, 0),
    scale: new Omosuen.Vector3D(6, 6, 6), // 32px * 6 ≈ 192 world units
  });
  nexus.addComponent(transform);

  // Declarative source component (aseprite-loader plugin) — fetches + builds on init.
  const aseprite = await Omosuen.newComponent('aseprite-loader', {
    name: file.replace(/\.aseprite$/i, ''),
    filePath: ASE_BASE + file,
    flatten,
    visibleOnly: true,
  });
  nexus.addComponent(aseprite);
  currentEntity = nexus;

  // init runs via the scheduler; reflect a play once it's built.
  status(`Loaded <strong>${file}</strong> (${flatten ? 'flattened' : 'layered'})`);
  // Give init a beat, then start 'idle' if present.
  setTimeout(() => {
    const ac = controllerOf(currentEntity);
    if (ac && ac.hasAnimation('idle')) ac.play('idle', true);
  }, 200);
}

// ── Scene ───────────────────────────────────────────────────────────────────────

export async function createScene() {
  currentEntity = null;
  layerCursor = 0;

  const scene = await Omosuen.newComponent('nexus', { name: 'Aseprite Test Scene' });

  const atlasManager = await Omosuen.newComponent('atlas-manager', {
    name: 'AtlasManager',
    config: { atlasSize: 2048, maxAtlases: 16, padding: 1, retainAtlas: true },
  });
  scene.addComponent(atlasManager);

  const viewport = await Omosuen.newComponent('viewport', {
    name: 'Ase Viewport',
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
    viewportRef: 'Ase Viewport',
    zoom: 1.0,
    axonometricAngle: 30,
  });
  cameraNexus.addComponent(camera);

  const ui = await Omosuen.newComponent('ui-overlay', {
    name: 'Aseprite Test UI',
    htmlConstructorKey: 'asepriteTest',
    bindings: [
      { selector: '#btn-back', onActions: ['click'], methodKey: 'aseBackToMenu' },
      { selector: '.file-btn', onActions: ['click'], methodKey: 'aseLoadFile' },
      { selector: '.tag-btn', onActions: ['click'], methodKey: 'asePlayTag' },
      { selector: '#btn-cycle-layers', onActions: ['click'], methodKey: 'aseCycleLayers' },
    ],
  });
  scene.addComponent(ui);

  // Load the default (layered) entity.
  await loadEntity(scene, 'MiniSwordMan.aseprite', false);

  return scene;
}
