/**
 * Sprite Test Scene — procedural atlas flow.
 *
 * Demonstrates runtime atlas growth (the Phase-1 re-upload fix): on load ONLY
 * "Front - Walking" is compiled into the atlas. Each animation button, on first
 * click, creates a new texture-map for that sprite sheet, recompiles the atlas
 * (atlasManager.processTextureMaps), and spawns a sprite + animation-controller
 * to display it. Recompiling bumps the atlas version, so cameras re-upload the
 * (now larger) atlas to the GPU on their next frame and the new sprite renders.
 * Re-selecting an already-loaded animation just switches the visible sprite.
 *
 * Goblin sheets (test/assets/goblins/male) are uniform 480x480 grids:
 *   Attacking/Hurt/Dying  -> 5x2 (10)   Idle/Idle Blinking -> 4x4 (16)
 *   Running               -> 4x3 (12)   Walking            -> 4x5 (20)
 */

const Omosuen = window.Omosuen;

// ── Animation catalog ───────────────────────────────────────────────────────

const ANIM_BASE = './assets/goblins/male/';
const DEFAULT_FILE = 'Front - Walking.png';
const FRAME_PX = 480; // uniform cell size of every sheet
const SPRITE_SCALE = 0.5; // 480px * 0.5 = 240 world units (fits the 480 viewport)
const FRAME_RATE = 24; // animation FPS

// One file per animation. Grid (cols x rows) is determined by the action.
const ANIMATION_FILES = [
  'Front - Walking.png',
  'Front - Running.png',
  'Front - Idle.png',
  'Front - Idle Blinking.png',
  'Front - Attacking.png',
  'Front - Hurt.png',
  'Back - Walking.png',
  'Back - Running.png',
  'Back - Idle.png',
  'Back - Attacking.png',
  'Back - Hurt.png',
  'Left - Walking.png',
  'Left - Running.png',
  'Left - Idle.png',
  'Left - Idle Blinking.png',
  'Left - Attacking.png',
  'Left - Hurt.png',
  'Right - Walking.png',
  'Right - Running.png',
  'Right - Idle.png',
  'Right - Idle Blinking.png',
  'Right - Attacking.png',
  'Right - Hurt.png',
  'Dying.png',
];

// cols x rows per action (all cells are valid frames, row-major).
const GRID_BY_ACTION = {
  Attacking: [5, 2],
  Hurt: [5, 2],
  Dying: [5, 2],
  Idle: [4, 4],
  'Idle Blinking': [4, 4],
  Running: [4, 3],
  Walking: [4, 5],
};

function actionOf(file) {
  const base = file.replace(/\.png$/i, '');
  const dash = base.indexOf(' - ');
  return dash === -1 ? base : base.slice(dash + 3);
}

function gridFor(file) {
  return GRID_BY_ACTION[actionOf(file)] || [1, 1];
}

function labelFor(file) {
  return file.replace(/\.png$/i, '').replace(' - ', ' · ');
}

// ── Procedural state (reset per scene load) ─────────────────────────────────

let createdAnims = new Map(); // file -> { sprite, ac }
let currentAnimKey = null;

function updateActiveStatus(text) {
  const el = document.getElementById('active-anim');
  if (el) el.innerHTML = text;
}

// ── UI ───────────────────────────────────────────────────────────────────────

Omosuen.registerHtmlConstructor('spriteTest', () => {
  const buttons = ANIMATION_FILES.map(
    (file) =>
      `<button class="sidebar-button anim-btn" data-file="${file}">${labelFor(file)}</button>`,
  ).join('\n');

  return `
        <div class="sidebar">
            <button id="btn-back" class="sidebar-back-button">← Back</button>
            <h1 class="sidebar-title">Sprite Test</h1>

            <div class="sidebar-section">
                <div id="active-anim" class="sidebar-status">Loading…</div>
            </div>

            <div class="sidebar-section">
                <div style="text-align:center;color:#ff6600;font-size:13px;margin-bottom:8px;text-transform:uppercase;">
                    Animations (click to load + show)
                </div>
                <div class="sidebar-controls" style="display:flex;flex-direction:column;gap:4px;">
                    ${buttons}
                </div>
            </div>
        </div>
    `;
});

Omosuen.registerBinding('backToMenuFromSprite', async () => {
  await Omosuen.switchScene('main-menu');
});

// One handler for all animation buttons; the clicked button carries its file.
Omosuen.registerBinding('selectAnim', async (event) => {
  const file = event.currentTarget && event.currentTarget.dataset.file;
  if (!file) return;
  const scene = Omosuen.getActiveScene();
  if (!scene) {
    console.error('[Sprite Test] No active scene');
    return;
  }
  await selectAnimation(scene, file);
});

// ── Procedural add / switch ──────────────────────────────────────────────────

/**
 * Shows `file`'s animation. On first selection it creates the texture-map,
 * recompiles the atlas (growing it at runtime), and spawns a sprite +
 * animation-controller. On later selections it just switches the visible sprite.
 */
async function selectAnimation(scene, file) {
  // Hide whatever is currently shown.
  if (currentAnimKey && createdAnims.has(currentAnimKey)) {
    createdAnims.get(currentAnimKey).sprite.setOpacity(0);
  }

  if (!createdAnims.has(file)) {
    const atlasManager = scene.getComponentByType('atlas-manager', true);
    if (!atlasManager) {
      console.error('[Sprite Test] AtlasManager not found');
      return;
    }

    const [cols, rows] = gridFor(file);
    const frameCount = cols * rows;
    const texKey = `goblin:${file}`;

    // 1. New texture-map (auto-registers with the atlas manager → compiled=false).
    const tm = await Omosuen.newComponent('texture-map', {
      name: `TextureMap ${file}`,
      textureMapKey: texKey,
      filePath: ANIM_BASE + file,
      imageType: {
        cellSize: new Omosuen.Vector2D(FRAME_PX, FRAME_PX),
        gridSize: new Omosuen.Vector2D(cols, rows),
        cellCount: frameCount,
      },
      atlasManager,
    });
    scene.addComponent(tm);

    // 2. Recompile the atlas to include the new frames. This bumps
    //    atlasManager.atlasVersion, so cameras re-upload on their next frame
    //    (the Phase-1 fix) — that's what makes runtime-added sprites render.
    const t0 = performance.now();
    try {
      await atlasManager.processTextureMaps();
    } catch (e) {
      console.error('[Sprite Test] Atlas recompile failed (out of atlas space?)', e);
      updateActiveStatus(`⚠ ${labelFor(file)} did not fit in the atlas`);
      return;
    }
    console.log(
      `[Sprite Test] Compiled '${file}' (${frameCount} frames) in ` +
        `${(performance.now() - t0).toFixed(0)} ms — ${atlasManager.getAtlasCount()} atlas(es)`,
    );

    // 3. Display nexus: transform + sprite (hidden) + animation-controller.
    const nexus = await Omosuen.newComponent('nexus', { name: `Goblin ${file}` });
    scene.addComponent(nexus);

    const transform = await Omosuen.newComponent('transform', {
      name: `Transform ${file}`,
      position: new Omosuen.Vector3D(0, 0, 0),
      rotation: new Omosuen.Vector3D(0, 0, 0),
      scale: new Omosuen.Vector3D(SPRITE_SCALE, SPRITE_SCALE, SPRITE_SCALE),
    });
    nexus.addComponent(transform);

    const sprite = await Omosuen.newComponent('sprite', {
      name: `Sprite ${file}`,
      textureMapKeys: { albedo: texKey, normal: '', material: '', emission: '' },
      frame: { albedo: 0, normal: 0, material: 0, emission: 0 },
      anchor: new Omosuen.Vector2D(FRAME_PX / 2, FRAME_PX / 2),
      tint: new Omosuen.Vector4D(1, 1, 1, 1),
      opacity: 0,
    });
    nexus.addComponent(sprite);

    const ac = await Omosuen.newComponent('animation-controller', {
      name: `Anim ${file}`,
      animations: [
        {
          name: 'play',
          frames: Array.from({ length: frameCount }, (_, i) => i),
          frameRate: FRAME_RATE,
          loop: true,
        },
      ],
      channels: ['albedo'],
    });
    nexus.addComponent(ac);

    createdAnims.set(file, { sprite, ac });
  }

  // Show + (re)start the selected animation.
  const entry = createdAnims.get(file);
  entry.sprite.setOpacity(1);
  entry.ac.play('play', true);
  currentAnimKey = file;
  updateActiveStatus(
    `<strong>${labelFor(file)}</strong><br>${createdAnims.size} animation(s) in atlas`,
  );
}

// ── Scene ─────────────────────────────────────────────────────────────────────

export async function createScene() {
  console.log('[Sprite Test] Creating scene...');

  // Reset procedural state (scene may be re-entered).
  createdAnims = new Map();
  currentAnimKey = null;

  const scene = await Omosuen.newComponent('nexus', { name: 'Sprite Test Scene' });

  // AtlasManager — 4096 fits a 20-frame 480px sheet in a single atlas; grows as
  // animations are added. maxAtlases 16 leaves headroom for many selections.
  // retainAtlas: true → procedural/incremental mode: each animation added at
  // runtime packs + blits only its NEW frames into the retained atlas canvas
  // (no full re-pack/re-blit), and cameras re-upload straight from the canvas.
  const atlasManager = await Omosuen.newComponent('atlas-manager', {
    name: 'AtlasManager',
    config: { atlasSize: 4096, maxAtlases: 16, padding: 1, retainAtlas: true },
  });
  scene.addComponent(atlasManager);

  // Viewport (480x480, centered on screen).
  const viewport = await Omosuen.newComponent('viewport', {
    name: 'Sprite Viewport',
    width: 480,
    height: 480,
    offsetX: window.innerWidth / 2 - 240,
    offsetY: window.innerHeight / 2 - 240,
    backgroundColor: new Omosuen.Vector4D(0.1, 0.1, 0.15, 1.0),
  });
  scene.addComponent(viewport);

  // Camera at the origin; sprites display at the origin → screen-centered.
  const cameraNexus = await Omosuen.newComponent('nexus', { name: 'Camera Nexus' });
  scene.addComponent(cameraNexus);
  const cameraTransform = await Omosuen.newComponent('transform', {
    name: 'Camera Transform',
    position: new Omosuen.Vector3D(-250, 150, 0),
    rotation: new Omosuen.Vector3D(0, 0, 0),
    scale: new Omosuen.Vector3D(1, 1, 1),
  });
  cameraNexus.addComponent(cameraTransform);
  const camera = await Omosuen.newComponent('camera', {
    name: 'Main Camera',
    viewportRef: 'Sprite Viewport',
    zoom: 1.0,
    axonometricAngle: 30,
  });
  cameraNexus.addComponent(camera);

  // UI overlay — one binding for all animation buttons (class selector).
  const ui = await Omosuen.newComponent('ui-overlay', {
    name: 'Sprite Test UI',
    htmlConstructorKey: 'spriteTest',
    bindings: [
      { selector: '#btn-back', onActions: ['click'], methodKey: 'backToMenuFromSprite' },
      { selector: '.anim-btn', onActions: ['click'], methodKey: 'selectAnim' },
    ],
  });
  scene.addComponent(ui);

  // Load ONLY the default animation into the atlas initially.
  await selectAnimation(scene, DEFAULT_FILE);

  console.log('[Sprite Test] Scene created successfully');
  return scene;
}
