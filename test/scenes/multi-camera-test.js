/**
 * Multi-Camera Test Scene
 *
 * Exercises the on-screen signal (`transform.onScreen`, see
 * `src/component/transform/on-screen.ts`) under a real multi-camera scene —
 * the one case no other test fixture covers,
 * since every other scene has exactly one camera. Two cameras, each with its
 * own viewport, look at two far-apart world regions ("Camera A" / "Camera B").
 * Two entities sit at those two regions ("Entity A" near camera A, "Entity B"
 * near camera B) — each visible to exactly one camera and off-screen for the
 * other, so `onScreen`'s OR-across-cameras semantics can be observed directly:
 * both entities should read `onScreen === true` (each seen by its own camera),
 * even though neither is visible to *both* cameras.
 *
 * "Move Entity A" buttons let it be repositioned live: to camera A's region
 * (visible, onScreen true), to camera B's region (visible to B instead, still
 * true — OR semantics), or far from both (onScreen false).
 */

const Omosuen = window.Omosuen;

// objects.png frame map (same asset as screen-pick-test.js). Only frame 1
// (bush, 16x16) is used here.
const OBJECTS_FRAME_MAP = [
  new Omosuen.Vector4D(0, 0, 16, 32),   // 0: tree
  new Omosuen.Vector4D(16, 0, 16, 16),  // 1: bush
];
const BUSH_FRAME = 1;

// Two well-separated world regions -- far enough apart that a viewport-sized
// on-screen test around one region's camera cannot also reach the other, but
// still close enough to the world origin to stay within the sprite renderer's
// depth-bias window (render-sprites.ts centers its depth math near the origin
// when no cell-map exists to size the window against; positions much beyond
// ~1000 world units get clipped by the GPU regardless of on-screen status --
// an orthogonal renderer characteristic, not something this fixture is
// testing).
const REGION_A = new Omosuen.Vector3D(0, 0, 0);
const REGION_B = new Omosuen.Vector3D(600, 0, 600);
const FAR_AWAY = new Omosuen.Vector3D(600, 0, -600); // off-screen for both

let entityATransform = null;
let entityBTransform = null;

function status(text) {
  const el = document.getElementById('mc-status');
  if (el) el.innerHTML = text;
}

function refreshReadout() {
  if (!entityATransform || !entityBTransform) return;
  status(
    `Entity A: onScreen = <strong>${entityATransform.onScreen}</strong><br>` +
    `Entity B: onScreen = <strong>${entityBTransform.onScreen}</strong>`,
  );
}

Omosuen.registerHtmlConstructor('multiCameraTest', () => `
  <div class="sidebar">
    <button id="btn-back" class="sidebar-back-button">← Back</button>
    <h1 class="sidebar-title">Multi-Camera Test</h1>
    <div class="sidebar-section">
      <div class="sidebar-status" style="font-size:12px;line-height:1.5;">
        Two cameras, two viewports, two entities. Entity A starts in camera
        A's region (left viewport); Entity B stays in camera B's region
        (right viewport). Move Entity A to see onScreen flip.
      </div>
    </div>
    <div class="sidebar-section">
      <pre id="mc-status" style="font-size:12px;white-space:pre-wrap;">—</pre>
    </div>
    <div class="sidebar-section">
      <div class="sidebar-controls" style="display:flex;flex-direction:column;gap:4px;">
        <button id="btn-move-a-region-a" class="sidebar-button">Move Entity A → Region A</button>
        <button id="btn-move-a-region-b" class="sidebar-button">Move Entity A → Region B</button>
        <button id="btn-move-a-far" class="sidebar-button">Move Entity A → Off-screen (both)</button>
      </div>
    </div>
  </div>
`);

Omosuen.registerBinding('mcBackToMenu', async () => {
  await Omosuen.switchScene('main-menu');
});

Omosuen.registerBinding('mcMoveARegionA', () => {
  entityATransform.position.x = REGION_A.x;
  entityATransform.position.y = REGION_A.y;
  entityATransform.position.z = REGION_A.z;
});

Omosuen.registerBinding('mcMoveARegionB', () => {
  entityATransform.position.x = REGION_B.x;
  entityATransform.position.y = REGION_B.y;
  entityATransform.position.z = REGION_B.z;
});

Omosuen.registerBinding('mcMoveAFar', () => {
  entityATransform.position.x = FAR_AWAY.x;
  entityATransform.position.y = FAR_AWAY.y;
  entityATransform.position.z = FAR_AWAY.z;
});

async function makeCamera(scene, name, viewportName, offsetX, region) {
  await Omosuen.newComponent('viewport', {
    name: viewportName,
    width: 320,
    height: 320,
    offsetX,
    offsetY: window.innerHeight / 2 - 160,
    backgroundColor: new Omosuen.Vector4D(0.05, 0.05, 0.1, 1.0),
  }, scene);

  const cameraNexus = await Omosuen.newComponent('nexus', { name: `${name} Nexus` }, scene);
  await Omosuen.newComponent('transform', {
    name: `${name} Transform`,
    position: new Omosuen.Vector3D(region.x, region.y, region.z),
  }, cameraNexus);
  await Omosuen.newComponent('camera', {
    name,
    viewportRef: viewportName,
    zoom: 1.0,
    axonometricAngle: 30,
  }, cameraNexus);
}

async function makeEntity(scene, name, region) {
  const nexus = await Omosuen.newComponent('nexus', { name: `${name} Nexus` }, scene);
  const transform = await Omosuen.newComponent('transform', {
    name: `${name} Transform`,
    position: new Omosuen.Vector3D(region.x, region.y, region.z),
    scale: new Omosuen.Vector3D(3, 3, 3),
  }, nexus);
  await Omosuen.newComponent('sprite', {
    name,
    textureMapKeys: { albedo: 'objects', normal: '', material: '', emission: '' },
    frame: { albedo: BUSH_FRAME, normal: 0, material: 0, emission: 0 },
    anchor: new Omosuen.Vector2D(8, 16),
    tint: new Omosuen.Vector4D(1, 1, 1, 1),
    opacity: 1,
  }, nexus);
  return transform;
}

export async function createScene() {
  entityATransform = null;
  entityBTransform = null;

  const scene = await Omosuen.newComponent('nexus', { name: 'Multi-Camera Test Scene' });

  const atlasManager = await Omosuen.newComponent('atlas-manager', {
    name: 'AtlasManager',
    config: { atlasSize: 2048, maxAtlases: 4, padding: 1 },
  }, scene);

  await Omosuen.newComponent('texture-map', {
    textureMapKey: 'objects',
    name: 'Objects',
    filePath: './assets/objects.png',
    imageType: OBJECTS_FRAME_MAP,
    atlasManager,
  }, scene);
  await atlasManager.processTextureMaps();

  await makeCamera(scene, 'Camera A', 'Cam A Viewport', window.innerWidth / 2 - 340, REGION_A);
  await makeCamera(scene, 'Camera B', 'Cam B Viewport', window.innerWidth / 2 + 20, REGION_B);

  entityATransform = await makeEntity(scene, 'Entity A', REGION_A);
  entityBTransform = await makeEntity(scene, 'Entity B', REGION_B);

  const ui = await Omosuen.newComponent('ui-overlay', {
    name: 'Multi-Camera Test UI',
    htmlConstructorKey: 'multiCameraTest',
    bindings: [
      { selector: '#btn-back', onActions: ['click'], methodKey: 'mcBackToMenu' },
      { selector: '#btn-move-a-region-a', onActions: ['click'], methodKey: 'mcMoveARegionA' },
      { selector: '#btn-move-a-region-b', onActions: ['click'], methodKey: 'mcMoveARegionB' },
      { selector: '#btn-move-a-far', onActions: ['click'], methodKey: 'mcMoveAFar' },
    ],
  }, scene);
  scene.addComponent(ui);

  setInterval(refreshReadout, 200);

  console.log('[Multi-Camera Test] Scene created');
  return scene;
}
