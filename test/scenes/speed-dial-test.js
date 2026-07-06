/**
 * Speed-Dial Test Scene
 *
 * Demonstrates the `speed-dial` component: a dial dropped under a nexus scales the
 * `deltaTime` fed to that nexus's whole subtree (itself + siblings + descendants),
 * leaving up-tree nodes untouched. Nested dials compose multiplicatively.
 *
 * Three sprite/clock pairs are nested progressively deeper, each pair carrying its
 * own `speed-dial` at 0.5. So the effective time-scale is:
 *   Pair 1 (depth 1): 0.5x
 *   Pair 2 (depth 2): 0.5 * 0.5   = 0.25x
 *   Pair 3 (depth 3): 0.5^3       = 0.125x
 * Both the digital clocks (timer.time) AND the goblin walk animations advance at
 * those scaled rates, so each deeper goblin walks/counts half as fast as the one
 * before it. The clock display updater lives at the (unscaled) scene root, so it
 * polls at real time and simply reads each timer's already-scaled value.
 *
 * Tree:
 *   scene
 *   ├─ AtlasManager, TextureMap(goblin walk), Viewport, CameraNexus
 *   ├─ ClockUpdater (root, unscaled) — updateOverride reads the 3 timers → DOM
 *   ├─ ui-overlay (3 digital clocks)
 *   └─ Pair1 [speed-dial 0.5] { Timer1, Holder1{transform,sprite,anim},
 *      └─ Pair2 [speed-dial 0.5] { Timer2, Holder2{...},
 *         └─ Pair3 [speed-dial 0.5] { Timer3, Holder3{...} } } }
 * (Holders are separate sub-nexuses so each goblin's transform does NOT compose
 *  with the nesting — only the *time* nests, not the position/scale.)
 */

const Omosuen = window.Omosuen;

const ANIM_FILE = './assets/goblins/male/Front - Walking.png';
const FRAME_PX = 480;         // uniform cell size
const WALK_COLS = 4, WALK_ROWS = 5; // Front - Walking is a 4x5 grid (20 frames)
const WALK_FRAMES = WALK_COLS * WALK_ROWS;
const SPRITE_SCALE = 0.32;
const FRAME_RATE = 24;

// The three pairs' effective (composed) time-scales, for the clock labels.
const PAIR_SCALES = [0.5, 0.25, 0.125];
// Horizontal screen spread: placing a goblin at (d, 0, -d) keeps equal iso-height
// and spreads it along screen-X (isoX ∝ x - z).
const PAIR_SPREAD = [-190, 0, 190];

// Timers captured for the root-level clock updater (reset per scene load).
let clockTimers = [];

// ── UI ────────────────────────────────────────────────────────────────────────

Omosuen.registerHtmlConstructor('speedDialTest', () => {
  const clocks = PAIR_SCALES.map(
    (scale, i) => `
      <div class="sd-clock">
        <div class="sd-clock-time" id="clock-${i}">00:00.0</div>
        <div class="sd-clock-label">Pair ${i + 1} — ${scale}× speed</div>
      </div>`,
  ).join('');

  return `
    <style>
      #sd-back { position: fixed; top: 16px; left: 16px; z-index: 10; }
      #sd-bar {
        position: fixed; left: 0; right: 0; bottom: 0; z-index: 10;
        display: flex; justify-content: center; gap: 40px;
        padding: 14px 0 22px; background: rgba(0,0,0,0.55);
        font-family: 'Courier New', monospace;
      }
      .sd-clock { text-align: center; color: #ff6600; }
      .sd-clock-time { font-size: 40px; font-weight: bold; letter-spacing: 2px; }
      .sd-clock-label { font-size: 13px; opacity: 0.85; margin-top: 4px; text-transform: uppercase; }
      #sd-title {
        position: fixed; top: 16px; left: 0; right: 0; text-align: center; z-index: 10;
        color: #ff6600; font-family: 'Courier New', monospace; font-size: 18px;
        text-transform: uppercase; letter-spacing: 2px;
      }
    </style>
    <button id="sd-back" class="sidebar-back-button">← Back</button>
    <div id="sd-title">Speed-Dial Test — each deeper pair runs at half speed</div>
    <div id="sd-bar">${clocks}</div>
  `;
});

Omosuen.registerBinding('backFromSpeedDial', async () => {
  await Omosuen.switchScene('main-menu');
});

// Root-level (unscaled) updater: read each timer's already-scaled time → clock DOM.
Omosuen.registerMethod('nexus', 'updateSpeedDialClocks', () => {
  for (let i = 0; i < clockTimers.length; i++) {
    const el = document.getElementById(`clock-${i}`);
    if (!el) continue;
    const ms = clockTimers[i].time;
    const totalSec = ms / 1000;
    const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
    const ss = (totalSec % 60).toFixed(1).padStart(4, '0');
    el.textContent = `${mm}:${ss}`;
  }
});

// ── Scene ───────────────────────────────────────────────────────────────────────

/** Builds a Holder sub-nexus with transform + goblin walk sprite + animation. */
async function addGoblin(parentNexus, texKey, spread) {
  const holder = await Omosuen.newComponent('nexus', { name: 'Holder' }, parentNexus);

  await Omosuen.newComponent('transform', {
    name: 'GoblinTransform',
    position: new Omosuen.Vector3D(spread, 0, -spread),
    rotation: new Omosuen.Vector3D(0, 0, 0),
    scale: new Omosuen.Vector3D(SPRITE_SCALE, SPRITE_SCALE, SPRITE_SCALE),
  }, holder);

  await Omosuen.newComponent('sprite', {
    name: 'GoblinSprite',
    textureMapKeys: { albedo: texKey, normal: '', material: '', emission: '' },
    frame: { albedo: 0, normal: 0, material: 0, emission: 0 },
    anchor: new Omosuen.Vector2D(FRAME_PX / 2, FRAME_PX / 2),
    tint: new Omosuen.Vector4D(1, 1, 1, 1),
    opacity: 1,
  }, holder);

  const ac = await Omosuen.newComponent('animation-controller', {
    name: 'GoblinAnim',
    animations: [
      {
        name: 'walk',
        frames: Array.from({ length: WALK_FRAMES }, (_, i) => i),
        frameRate: FRAME_RATE,
        loop: true,
      },
    ],
    channels: ['albedo'],
  }, holder);
  ac.play('walk', true);
}

export async function createScene() {
  console.log('[Speed-Dial Test] Creating scene...');
  clockTimers = [];

  const scene = await Omosuen.newComponent('nexus', { name: 'Speed-Dial Test Scene' });

  // Atlas + the single shared goblin walk texture-map.
  const atlasManager = await Omosuen.newComponent('atlas-manager', {
    name: 'AtlasManager',
    config: { atlasSize: 4096, maxAtlases: 4, padding: 1 },
  }, scene);

  const texKey = 'goblin-walk';
  await Omosuen.newComponent('texture-map', {
    name: 'GoblinWalk',
    textureMapKey: texKey,
    filePath: ANIM_FILE,
    imageType: {
      cellSize: new Omosuen.Vector2D(FRAME_PX, FRAME_PX),
      gridSize: new Omosuen.Vector2D(WALK_COLS, WALK_ROWS),
      cellCount: WALK_FRAMES,
    },
    atlasManager,
  }, scene);
  await atlasManager.processTextureMaps();

  // Viewport + camera (wide enough for three goblins spread along screen-X).
  await Omosuen.newComponent('viewport', {
    name: 'SpeedDial Viewport',
    width: 900,
    height: 460,
    offsetX: window.innerWidth / 2 - 450,
    offsetY: window.innerHeight / 2 - 260,
    backgroundColor: new Omosuen.Vector4D(0.08, 0.09, 0.13, 1.0),
  }, scene);

  const cameraNexus = await Omosuen.newComponent('nexus', { name: 'Camera Nexus' }, scene);
  await Omosuen.newComponent('transform', {
    name: 'Camera Transform',
    position: new Omosuen.Vector3D(0, 120, 0),
    rotation: new Omosuen.Vector3D(0, 0, 0),
    scale: new Omosuen.Vector3D(1, 1, 1),
  }, cameraNexus);
  await Omosuen.newComponent('camera', {
    name: 'Main Camera',
    viewportRef: 'SpeedDial Viewport',
    zoom: 1.0,
    axonometricAngle: 30,
  }, cameraNexus);

  // Root-level clock updater (unscaled): drives the digital clock DOM each frame.
  await Omosuen.newComponent('nexus', {
    name: 'ClockUpdater',
    updateOverride: 'updateSpeedDialClocks',
  }, scene);

  // UI overlay (back button + 3 digital clocks).
  await Omosuen.newComponent('ui-overlay', {
    name: 'SpeedDial UI',
    htmlConstructorKey: 'speedDialTest',
    bindings: [
      { selector: '#sd-back', onActions: ['click'], methodKey: 'backFromSpeedDial' },
    ],
  }, scene);

  // Nested pairs: each Pair nexus carries a 0.5 speed-dial + a stopwatch timer + a
  // goblin, then nests the next Pair inside it → composed 0.5 / 0.25 / 0.125.
  let parent = scene;
  for (let i = 0; i < PAIR_SCALES.length; i++) {
    const pair = await Omosuen.newComponent('nexus', { name: `Pair${i + 1}` }, parent);
    await Omosuen.newComponent('speed-dial', { name: `Dial${i + 1}`, speed: 0.5 }, pair);

    const timer = await Omosuen.newComponent('timer', {
      name: `Timer${i + 1}`,
      duration: 1e12,   // never fires — used as a free-running stopwatch (time += dt*scale)
      repeat: true,
    }, pair);
    timer.start();
    clockTimers.push(timer);

    await addGoblin(pair, texKey, PAIR_SPREAD[i]);

    parent = pair; // next pair nests one level deeper
  }

  console.log('[Speed-Dial Test] Scene created successfully');
  return scene;
}
