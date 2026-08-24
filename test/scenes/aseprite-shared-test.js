/**
 * Aseprite Shared-Data Test — many entities, one copy of the shared data.
 *
 * Spawns a row of units that all import the SAME two-file art set, ingested
 * horizontally (sprites shared by layer name across the set, not per source —
 * see `aseprite-multi-test.js`'s doc comment for the full model). Each unit
 * shows ONE character variant (swordman or dryad) and has its OWN dropdown to
 * play any of that variant's animations independently. This demonstrates the
 * data-reuse optimization AND that instances stay independent:
 *   - texture-maps are created once per (art set, layer name) key, owned by the
 *     scene root, and shared across every entity of the same art set;
 *   - all controllers of the art set reference ONE `animation-map` by key;
 *   - the first unit pays the full import, the rest are built from a cached
 *     blueprint (no fetch/parse/composite);
 *   - yet each unit plays its own animation (independent per-instance state).
 *
 * Assets: test/assets/aseprite/{MiniSwordMan,MiniDryadDeer}.aseprite
 */

const Omosuen = window.Omosuen;

const ASE_BASE = './assets/aseprite/';
// Hard-coded world X per unit (all positive — the axonometric view clips negative
// x). Swordsmen (0-2) on the left, dryads (3-5) on the right.
const POSITIONS = [10, 54, 98, 150, 194, 238];
const UNIT_COUNT = POSITIONS.length;
const SCALE = 2;

// Shared two-file art set every unit imports.
const SOURCES = {
  swordman: ASE_BASE + 'MiniSwordMan.aseprite',
  dryad: ASE_BASE + 'MiniDryadDeer.aseprite',
};

// Which shared layers each source actually contributes to (known asset
// structure). Layers not listed for a source have no frame data for it and
// must be hidden while that source's animation plays.
const SOURCE_LAYERS = {
  swordman: ['main', 'hands', 'outline', 'slash'],
  dryad: ['main', 'hands', 'outline', 'hands extra', 'Layer 1'],
};

// units[i] = { nexus, loader, variantId }
const units = [];

// First half swordman, second half dryad — several of each, so same-variant
// units can be compared side by side.
function variantFor(i) {
  return i < UNIT_COUNT / 2 ? 'swordman' : 'dryad';
}

function status(text) {
  const el = document.getElementById('ash-status');
  if (el) el.innerHTML = text;
}

function controllerOf(nexus) {
  return nexus ? nexus.getComponentByType('animation-controller', false) : null;
}

// Hide any shared layer the given variant doesn't contribute to; leave the
// common ones (main/hands/outline) alone.
function applyVariant(nexus, variantId) {
  const ac = controllerOf(nexus);
  if (!ac) return;
  const owned = new Set(SOURCE_LAYERS[variantId] || []);
  for (const layer of ac.getLayers()) {
    ac.setLayerVisible(layer.name, owned.has(layer.name));
  }
}

// ── UI ────────────────────────────────────────────────────────────────────────

Omosuen.registerHtmlConstructor('asepriteSharedTest', () => {
  let rows = '';
  for (let i = 0; i < UNIT_COUNT; i++) {
    rows += `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
        <span style="color:#00ff00;font-family:monospace;width:120px;font-size:12px;">U${i} · ${variantFor(i)}</span>
        <select id="unit-select-${i}" class="unit-anim-select" data-unit="${i}"
                style="flex:1;background:#001100;color:#00ff00;border:1px solid #00ff00;font-family:monospace;padding:4px;">
          <option>loading…</option>
        </select>
      </div>`;
  }
  return `
    <div class="sidebar">
      <button id="btn-back" class="sidebar-back-button">← Back</button>
      <h1 class="sidebar-title">Aseprite Shared Data</h1>
      <div class="sidebar-section">
        <div id="ash-status" class="sidebar-status">Spawning…</div>
      </div>
      <div class="sidebar-section">
        <div style="text-align:center;color:#ff6600;font-size:13px;margin-bottom:8px;">PER-UNIT ANIMATION</div>
        ${rows}
      </div>
    </div>
  `;
});

Omosuen.registerBinding('ashBackToMenu', async () => {
  await Omosuen.switchScene('main-menu');
});

// Play the selected animation on ONE unit (independent per-instance playback).
Omosuen.registerBinding('ashSelectAnim', (event) => {
  const idx = parseInt(event.currentTarget.dataset.unit, 10);
  const name = event.currentTarget.value;
  const u = units[idx];
  if (!u) return;
  const ac = controllerOf(u.nexus);
  if (ac && ac.hasAnimation(name)) {
    ac.play(name, true);
    status(`Unit ${idx} → <strong>${name}</strong>`);
  }
});

// Fill one unit's dropdown with its variant's animation names, once ready.
function populateSelect(idx, variantId, animNames) {
  const sel = document.getElementById(`unit-select-${idx}`);
  if (!sel) return;
  const names = animNames
    .filter((n) => n.startsWith(`${variantId}-`))
    .sort();
  sel.innerHTML = names
    .map((n) => `<option value="${n}">${n.slice(variantId.length + 1)}</option>`)
    .join('');
}

// ── Spawning ────────────────────────────────────────────────────────────────────

async function spawnUnit(scene, name, x, y) {
  const nexus = await Omosuen.newComponent('nexus', { name });
  scene.addComponent(nexus);
  const transform = await Omosuen.newComponent('transform', {
    name: `${name} Transform`,
    position: new Omosuen.Vector3D(x, y, 0),
    rotation: new Omosuen.Vector3D(0, 0, 0),
    scale: new Omosuen.Vector3D(SCALE, SCALE, SCALE),
  });
  nexus.addComponent(transform);
  const loader = await Omosuen.newComponent('aseprite-loader', {
    name,
    sources: SOURCES,
    flatten: false,
    visibleOnly: true,
    anchorMode: 'bottom-center',
  });
  nexus.addComponent(loader);
  return { nexus, loader };
}

export async function createScene() {
  units.length = 0;

  const scene = await Omosuen.newComponent('nexus', {
    name: 'Aseprite Shared Scene',
  });

  const atlasManager = await Omosuen.newComponent('atlas-manager', {
    name: 'AtlasManager',
    config: { atlasSize: 2048, maxAtlases: 16, padding: 1, retainAtlas: true },
  });
  scene.addComponent(atlasManager);

  const VIEW_W = 760;
  const VIEW_H = 420;
  const viewport = await Omosuen.newComponent('viewport', {
    name: 'ASH Viewport',
    width: VIEW_W,
    height: VIEW_H,
    // Center the viewport in the area right of the sidebar (~400px wide).
    offsetX: 400 + (window.innerWidth - 400) / 2 - VIEW_W / 2,
    offsetY: window.innerHeight / 2 - VIEW_H / 2,
    backgroundColor: new Omosuen.Vector4D(0.1, 0.1, 0.15, 1.0),
  });
  scene.addComponent(viewport);

  const cameraNexus = await Omosuen.newComponent('nexus', { name: 'Camera Nexus' });
  scene.addComponent(cameraNexus);
  // Framed so the whole descending diagonal of 6 units fits, centered.
  const cameraTransform = await Omosuen.newComponent('transform', {
    name: 'Camera Transform',
    position: new Omosuen.Vector3D(120, 90, 0),
    rotation: new Omosuen.Vector3D(0, 0, 0),
    scale: new Omosuen.Vector3D(1, 1, 1),
  });
  cameraNexus.addComponent(cameraTransform);
  const camera = await Omosuen.newComponent('camera', {
    name: 'Main Camera',
    viewportRef: 'ASH Viewport',
    zoom: 0.85,
    axonometricAngle: 30,
  });
  cameraNexus.addComponent(camera);

  const bindings = [
    { selector: '#btn-back', onActions: ['click'], methodKey: 'ashBackToMenu' },
    { selector: '.unit-anim-select', onActions: ['change'], methodKey: 'ashSelectAnim' },
  ];
  const ui = await Omosuen.newComponent('ui-overlay', {
    name: 'Aseprite Shared UI',
    htmlConstructorKey: 'asepriteSharedTest',
    bindings,
  });
  scene.addComponent(ui);

  // Single row at hard-coded positive-x positions, so same-variant units sit
  // together with no front/back occlusion and nothing clips off-screen.
  const t0 = performance.now();
  for (let i = 0; i < UNIT_COUNT; i++) {
    const variantId = variantFor(i);
    const u = await spawnUnit(scene, `Unit ${i}`, POSITIONS[i], 0);
    u.variantId = variantId;
    units[i] = u;
  }

  const spawnMs = performance.now() - t0;
  console.log(
    `[Aseprite Shared] spawned ${UNIT_COUNT} units (shared art set) in ${spawnMs.toFixed(0)} ms`,
  );

  // Finalize asynchronously: the loaders init frame-budgeted and the UI overlay
  // renders on a later frame, so poll until each unit's controller has bound its
  // sprites AND its dropdown exists, then show the variant + fill the dropdown.
  finalizeSetup();

  return scene;
}

async function finalizeSetup() {
  const pending = new Set(units.map((_, i) => i));
  const start = performance.now();
  while (pending.size > 0 && performance.now() - start < 15000) {
    for (const i of Array.from(pending)) {
      const u = units[i];
      const ac = controllerOf(u.nexus);
      const sel = document.getElementById(`unit-select-${i}`);
      // Wait until the controller has resolved layers and the dropdown exists.
      if (ac && ac.getLayers().length > 0 && sel) {
        applyVariant(u.nexus, u.variantId);
        const names = [...ac.animations.keys()];
        populateSelect(i, u.variantId, names);
        if (ac.hasAnimation(`${u.variantId}-idle`)) {
          ac.play(`${u.variantId}-idle`, true);
        }
        pending.delete(i);
      }
    }
    if (pending.size > 0) await new Promise((r) => setTimeout(r, 50));
  }
  status(`${UNIT_COUNT} units sharing one art set — pick an animation each`);
}
