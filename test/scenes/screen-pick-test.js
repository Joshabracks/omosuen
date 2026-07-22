/**
 * Screen-Pick Test Scene
 *
 * Exercises camera.screenPick / screenToWorldRay. Distinct materials/sprites make
 * the scene readable: a grass ground, a brown 3×3 dirt pillar, two object sprites,
 * and box / sphere / event colliders. A TREE "pointer" sprite snaps to whatever
 * tile the cursor hovers — a live check of screen→map coordinates.
 *
 * Hover  = move the tree pointer to the hovered tile (status shows its cell).
 * Click  = log all hits at the point near→far.
 * Drag   = quad-select (logs everything inside the box).
 */

const Omosuen = window.Omosuen;

const CELL_W = 32, CELL_H = 16, CELL_D = 32;
const MAP_W = 16, MAP_DEPTH = 16, MAP_HEIGHT = 16;

// 16x16_tiles.png swatches (row 21) — same as the other test scenes.
const DIRT_FRAME = 21 * 25 + 8;  // 533
const GRASS_FRAME = 21 * 25 + 9; // 534
const CAP_FRAME = 21 * 25 + 10;  // 535

// objects.png frame map — frame 0 is the tall tree (16x32); the rest are 16x16.
const OBJECTS_FRAME_MAP = [
  new Omosuen.Vector4D(0, 0, 16, 32),   // 0: tree
  new Omosuen.Vector4D(16, 0, 16, 16),  // 1: bush
  new Omosuen.Vector4D(32, 0, 16, 16),  // 2
  new Omosuen.Vector4D(48, 0, 16, 16),  // 3
  new Omosuen.Vector4D(64, 0, 16, 16),  // 4
  new Omosuen.Vector4D(80, 0, 16, 16),  // 5
  new Omosuen.Vector4D(0, 16, 16, 16),  // 6
  new Omosuen.Vector4D(16, 16, 16, 16), // 7
];
const TREE_FRAME = 0;

const PILLAR_TOP = 5; // pillar occupies y = 1..PILLAR_TOP

// Reusable pick buffers (per-frame zero-GC: created once, reused every query).
const hoverBuffer = Omosuen.createPickBuffer();
const clickBuffer = Omosuen.createPickBuffer();

function getCamera() {
  const scene = Omosuen.getActiveScene();
  return scene ? scene.getComponentByType('camera', true) : null;
}

function describeHit(h) {
  if (h.kind === 'cell') {
    return `cell (${h.cellX},${h.cellY},${h.cellZ}) d=${h.depth.toFixed(1)}`;
  }
  const name = h.component && h.component.name ? h.component.name : '?';
  return `${h.kind} "${name}" d=${h.depth.toFixed(1)}`;
}

function setStatus(html) {
  const el = document.getElementById('pick-status');
  if (el) el.innerHTML = html;
}

Omosuen.registerHtmlConstructor('screenPickTest', () => `
  <div class="sidebar">
    <button id="btn-back" class="sidebar-back-button">← Back</button>
    <h1 class="sidebar-title">Screen Pick</h1>
    <div class="sidebar-section">
      <div class="sidebar-status" style="font-size:12px;line-height:1.5;">
        Hover = tree snaps to the hovered tile.
        Left-click = log all hits. Left-drag = quad select.<br>
        Right-drag = pan. Wheel = zoom (toward cursor).
        Q/E = orbit yaw ±15°. W/S = tilt ±5°.<br>
        Pan/zoom/orbit/tilt to confirm picking tracks the live camera.
      </div>
    </div>
    <div class="sidebar-section">
      <pre id="pick-status" style="font-size:12px;white-space:pre-wrap;">—</pre>
    </div>
  </div>
`);

Omosuen.registerBinding('screenPickBack', async () => {
  await Omosuen.switchScene('main-menu');
});

// Grass ground (material 0); brown dirt pillar (material 1) in the center.
function generateTerrain(width, depth) {
  const shapeMap = new Omosuen.Array3D(new Omosuen.Vector3D(width, MAP_HEIGHT, depth), 0);
  const materialMap = new Omosuen.Array3D(new Omosuen.Vector3D(width, MAP_HEIGHT, depth), 0);
  for (let x = 0; x < width; x++) {
    for (let z = 0; z < depth; z++) shapeMap.set(new Omosuen.Vector3D(x, 0, z), 1);
  }
  const cx = Math.floor(width / 2), cz = Math.floor(depth / 2);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let y = 1; y <= PILLAR_TOP; y++) {
        shapeMap.set(new Omosuen.Vector3D(cx + dx, y, cz + dz), 1);
        materialMap.set(new Omosuen.Vector3D(cx + dx, y, cz + dz), 1); // dirt
      }
    }
  }
  return { shapeMap, materialMap };
}

async function makeObjectSprite(scene, name, frame, gx, gz, anchorY) {
  const groundTop = 1 * CELL_H;
  const nexus = await Omosuen.newComponent('nexus', { name: `${name} Nexus` }, scene);
  await Omosuen.newComponent('transform', {
    name: `${name} Transform`,
    position: new Omosuen.Vector3D((gx + 0.5) * CELL_W, groundTop, (gz + 0.5) * CELL_D),
    scale: new Omosuen.Vector3D(3, 3, 3),
  }, nexus);
  await Omosuen.newComponent('sprite', {
    name,
    textureMapKeys: { albedo: 'objects', normal: '', material: '', emission: '' },
    frame: { albedo: frame, normal: 0, material: 0, emission: 0 },
    anchor: new Omosuen.Vector2D(8, anchorY),
    tint: new Omosuen.Vector4D(1, 1, 1, 1),
    opacity: 1,
  }, nexus);
}

async function makeCollider(scene, name, type, x, y, z, opts) {
  const nexus = await Omosuen.newComponent('nexus', { name: `${name} Nexus` }, scene);
  await Omosuen.newComponent('transform', {
    name: `${name} Transform`,
    position: new Omosuen.Vector3D(x, y, z),
  }, nexus);
  await Omosuen.newComponent(type, { name, ...opts }, nexus);
  return nexus;
}

export async function createScene() {
  const scene = await Omosuen.newComponent('nexus', { name: 'Screen Pick Test Scene' });

  const atlasManager = await Omosuen.newComponent('atlas-manager', {
    name: 'AtlasManager',
    config: { atlasSize: 2048, maxAtlases: 4, padding: 1 },
  }, scene);

  await Promise.all([
    Omosuen.newComponent('texture-map', {
      textureMapKey: 'tiles',
      name: '16x16 Tiles',
      filePath: './assets/16x16_tiles.png',
      imageType: { cellSize: new Omosuen.Vector2D(16, 16), gridSize: new Omosuen.Vector2D(25, 25) },
      atlasManager,
    }, scene),
    Omosuen.newComponent('texture-map', {
      textureMapKey: 'objects',
      name: 'Objects',
      filePath: './assets/objects.png',
      imageType: OBJECTS_FRAME_MAP,
      atlasManager,
    }, scene),
    Omosuen.newComponent('viewport', {
      name: 'Pick Viewport',
      width: 800,
      height: 600,
      offsetX: window.innerWidth / 2 - 400,
      offsetY: window.innerHeight / 2 - 300,
      backgroundColor: new Omosuen.Vector4D(0.05, 0.05, 0.1, 1.0),
    }, scene),
  ]);
  await atlasManager.processTextureMaps();

  // Camera focused on the map center.
  const cameraNexus = await Omosuen.newComponent('nexus', { name: 'Camera Nexus' }, scene);
  await Omosuen.newComponent('transform', {
    name: 'Camera Transform',
    position: new Omosuen.Vector3D((MAP_W * CELL_W) / 2, 4 * CELL_H, (MAP_DEPTH * CELL_D) / 2),
  }, cameraNexus);
  await Omosuen.newComponent('camera', {
    name: 'Main Camera',
    viewportRef: 'Pick Viewport',
    zoom: 0.7,
    axonometricAngle: 30,
    pixelScale: 1,
  }, cameraNexus);

  // Materials: grass-cap ground + dirt pillar (visually distinct).
  const grassMaterial = {
    albedoTextureKey: 'tiles', normalTextureKey: '', emissionTextureKey: '', materialTextureKey: '',
    albedoFrame: CAP_FRAME, sides: { up: { albedoFrame: GRASS_FRAME } },
  };
  const dirtMaterial = {
    albedoTextureKey: 'tiles', normalTextureKey: '', emissionTextureKey: '', materialTextureKey: '',
    albedoFrame: DIRT_FRAME,
  };
  const { shapeMap, materialMap } = generateTerrain(MAP_W, MAP_DEPTH);
  await Omosuen.newComponent('cell-map', {
    name: 'Terrain',
    materials: [grassMaterial, dirtMaterial],
    materialMap,
    shapeMap,
    cellSize: new Omosuen.Vector3D(CELL_W, CELL_H, CELL_D),
    mapSize: new Omosuen.Vector3D(MAP_W, MAP_HEIGHT, MAP_DEPTH),
    smoothing: 4,
    normalSmoothing: 0,
  }, scene);

  await Omosuen.newComponent('light', {
    name: 'Ambient Light', lightType: 'ambient',
    color: new Omosuen.Vector3D(1, 1, 1), brightness: 0.9,
  }, await Omosuen.newComponent('nexus', { name: 'Ambient Nexus' }, scene));

  // Two distinct object sprites (bush frames) at known cells.
  await makeObjectSprite(scene, 'SpriteA', 1, 4, 4, 16);
  await makeObjectSprite(scene, 'SpriteB', 6, 11, 11, 16);

  // Colliders at known world positions (geometry-only).
  const groundTop = 1 * CELL_H;
  await makeCollider(scene, 'BoxCollider', 'collider',
    (3 + 0.5) * CELL_W, groundTop + 24, (11 + 0.5) * CELL_D,
    { shape: 'box', size: new Omosuen.Vector3D(20, 20, 20) });
  await makeCollider(scene, 'SphereCollider', 'collider',
    (11 + 0.5) * CELL_W, groundTop + 24, (4 + 0.5) * CELL_D,
    { shape: 'sphere', radius: 24 });
  await makeCollider(scene, 'EventTrigger', 'event-collider',
    (8 + 0.5) * CELL_W, groundTop + 24, (8 + 0.5) * CELL_D,
    { shape: 'box', size: new Omosuen.Vector3D(24, 24, 24) });

  // TREE pointer: snaps to the hovered tile to verify screen→map coords.
  const treeNexus = await Omosuen.newComponent('nexus', { name: 'Tree Pointer Nexus' }, scene);
  const treeTransform = await Omosuen.newComponent('transform', {
    name: 'Tree Pointer Transform',
    position: new Omosuen.Vector3D((MAP_W / 2) * CELL_W, CELL_H, (MAP_DEPTH / 2) * CELL_D),
    scale: new Omosuen.Vector3D(2.5, 2.5, 2.5),
  }, treeNexus);
  await Omosuen.newComponent('sprite', {
    name: 'Tree Pointer',
    textureMapKeys: { albedo: 'objects', normal: '', material: '', emission: '' },
    frame: { albedo: TREE_FRAME, normal: 0, material: 0, emission: 0 },
    anchor: new Omosuen.Vector2D(8, 32), // bottom-center → tree stands on the tile
    tint: new Omosuen.Vector4D(1, 1, 1, 1),
    opacity: 1,
  }, treeNexus);

  // UI overlay.
  const ui = await Omosuen.newComponent('ui-overlay', {
    name: 'Screen Pick UI',
    htmlConstructorKey: 'screenPickTest',
    bindings: [{ selector: '#btn-back', onActions: ['click'], methodKey: 'screenPickBack' }],
  }, scene);
  scene.addComponent(ui);

  // Canvas interaction (viewport-local pixels via offsetX/Y).
  // Left button: hover (tree pointer), click (log hits), drag (quad select).
  // Right button: drag to pan. Wheel: zoom toward the cursor.
  const viewport = scene.getComponentByName('Pick Viewport', true);
  const canvas = viewport && viewport.canvas;
  if (canvas) {
    let dragStart = null; // left-button drag
    let panLast = null;   // right-button drag

    // Glow the hovered cell via per-cell emission (max intensity), restoring the
    // previously highlighted cell when the hover moves. setEmission re-meshes the
    // affected chunk; only mutate when the cell actually changes.
    const cellMap = scene.getComponentByName('Terrain', true);
    const emCoord = new Omosuen.Vector3D(0, 0, 0);
    let hiX = -1, hiY = -1, hiZ = -1;
    const setEmissionAt = (x, y, z, val) => {
      emCoord.x = x; emCoord.y = y; emCoord.z = z;
      cellMap.setEmission(emCoord, val);
    };
    const highlightCell = (x, y, z) => {
      if (x === hiX && y === hiY && z === hiZ) return;
      if (hiX >= 0) setEmissionAt(hiX, hiY, hiZ, 0);
      setEmissionAt(x, y, z, 31);
      hiX = x; hiY = y; hiZ = z;
    };
    const clearHighlight = () => {
      if (hiX >= 0) { setEmissionAt(hiX, hiY, hiZ, 0); hiX = hiY = hiZ = -1; }
    };

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // Wheel = zoom toward the cursor. The pick reads the live camera each call,
    // so accuracy must hold at any zoom (scale is zoom²).
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const cam = getCamera();
      if (!cam) return;
      const next = Math.max(0.15, Math.min(3, cam.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
      cam.setZoomTarget(e.offsetX, e.offsetY);
      cam.setZoom(next);
      cam.resetZoomTarget();
    }, { passive: false });

    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 2) panLast = { x: e.offsetX, y: e.offsetY };
      else if (e.button === 0) dragStart = { x: e.offsetX, y: e.offsetY };
    });

    canvas.addEventListener('mousemove', (e) => {
      const cam = getCamera();
      if (!cam) return;
      if (panLast) {
        // Grab-and-drag: move the camera so the map follows the cursor.
        cam.pan(panLast.x - e.offsetX, panLast.y - e.offsetY);
        panLast = { x: e.offsetX, y: e.offsetY };
        return;
      }
      if (dragStart) return; // left-drag → quad computed on mouseup
      // Cells-only, front-most: the tile under the cursor.
      const n = cam.screenPick([e.offsetX, e.offsetY], 1, hoverBuffer, {
        mode: 'first',
        types: { cells: true, colliders: false, eventColliders: false, sprites: false },
      });
      if (n > 0) {
        const h = hoverBuffer.hits[0];
        // Glow the hovered cell + stand the tree on its TOP face.
        highlightCell(h.cellX, h.cellY, h.cellZ);
        treeTransform.position.x = (h.cellX + 0.5) * CELL_W;
        treeTransform.position.y = (h.cellY + 1) * CELL_H;
        treeTransform.position.z = (h.cellZ + 0.5) * CELL_D;
        setStatus(
          `tile (${h.cellX}, ${h.cellY}, ${h.cellZ})<br>` +
          `world (${treeTransform.position.x.toFixed(0)}, ` +
          `${treeTransform.position.y.toFixed(0)}, ` +
          `${treeTransform.position.z.toFixed(0)})<br>` +
          `zoom ${cam.zoom.toFixed(2)}`,
        );
      } else {
        clearHighlight();
        setStatus('(off map)');
      }
    });

    canvas.addEventListener('mouseup', (e) => {
      if (e.button === 2) { panLast = null; return; }
      const cam = getCamera();
      if (!cam || !dragStart) { dragStart = null; return; }
      const dx = e.offsetX - dragStart.x, dy = e.offsetY - dragStart.y;
      if (Math.abs(dx) < 4 && Math.abs(dy) < 4) {
        const n = cam.screenPick([e.offsetX, e.offsetY], 1, clickBuffer, { mode: 'all' });
        const lines = [];
        for (let i = 0; i < n; i++) lines.push(describeHit(clickBuffer.hits[i]));
        console.log('[Pick] point all:', lines);
        setStatus(lines.join('<br>') || '(nothing)');
      } else {
        const x0 = dragStart.x, y0 = dragStart.y, x1 = e.offsetX, y1 = e.offsetY;
        const quad = [x0, y0, x1, y0, x1, y1, x0, y1];
        const n = cam.screenPick(quad, 4, clickBuffer, { mode: 'all' });
        const lines = [];
        for (let i = 0; i < n; i++) lines.push(describeHit(clickBuffer.hits[i]));
        console.log('[Pick] quad select:', lines);
        setStatus(`quad: ${n} hit(s)<br>` + lines.join('<br>'));
      }
      dragStart = null;
    });

    // Releasing the button off-canvas ends a pan/drag.
    window.addEventListener('mouseup', () => { panLast = null; dragStart = null; });

    // Q/E = orbit yaw ±15°, W/S = tilt (axonometricAngle) ±5°. Exercises the
    // yaw/pitch-aware pick/pan math directly — hover/click/drag should keep
    // landing on the right cells/sprites at any orbit/tilt.
    window.addEventListener('keydown', (e) => {
      const cam = getCamera();
      if (!cam) return;
      if (e.key === 'q' || e.key === 'Q') cam.orbitBy(-15);
      else if (e.key === 'e' || e.key === 'E') cam.orbitBy(15);
      else if (e.key === 'w' || e.key === 'W') cam.axonometricAngle = Math.min(90, cam.axonometricAngle + 5);
      else if (e.key === 's' || e.key === 'S') cam.axonometricAngle = Math.max(0, cam.axonometricAngle - 5);
      else return;
      setStatus(`orbitYaw ${cam.orbitYaw.toFixed(0)}°, tilt ${cam.axonometricAngle.toFixed(0)}°`);
    });
  }

  console.log('[Screen Pick Test] Scene created');
  return scene;
}
