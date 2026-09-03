/**
 * Textris — the whole NES screen as a cell-map.
 *
 * A 256x1x240 cell-map, one cell per NES pixel, viewed straight down. The
 * projection is normally an isometric diamond; `orbitYaw: 45` +
 * `axonometricAngle: 90` collapses it to an axis-aligned grid where
 *
 *     screenX = 1.2247449 * worldX      screenY = 1.4142136 * worldZ
 *
 * and world Y drops out entirely. Cells come out square when
 * `cellSize.x / cellSize.z == 2 / sqrt(3)`, and land on exactly one framebuffer
 * texel each at the sizes chosen below — so a cell is a pixel, not an
 * approximation of one. See `screen.js` for how colour gets to the GPU.
 *
 * The canvas is a real 256x240 and is scaled up by CSS with
 * `image-rendering: pixelated`, so a window resize costs nothing: no
 * re-meshing, no camera maths, no re-created cell-map.
 */

import { createAudio } from './audio.js';
import { createGame, isInDangerZone, reset, step } from './game.js';
import { render } from './render.js';
import { H, W, attach, buildInitialEmissionColorMap, flush } from './screen.js';

const Omosuen = window.Omosuen;

/** Scene modules load from `<base>/scenes/textris/`, assets from `<base>/assets/`. */
const ASSETS = new URL('../../assets/textris/', import.meta.url).href;

/**
 * One cell must project to exactly one framebuffer texel. The projection
 * scales world X by 1.2247449 and world Z by 1.4142136, so these are their
 * reciprocals — the two axes end up the same size on screen despite the
 * different scale factors.
 */
const CELL_X = 0.8164965809277261; // 1 / 1.2247449
const CELL_Z = 0.7071067811865476; // 1 / 1.4142136

/**
 * The offscreen framebuffer is 2 texels larger than the viewport per axis
 * (`FBO_OVERSCAN_PX`), and the post-process shows the region anchored at its
 * TOP-LEFT — not its centre. Placing the camera half a padded-framebuffer away
 * from the map's origin therefore lands cell (0,0) exactly on the first
 * visible texel and cell (255,239) on the last.
 */
const FBO_OVERSCAN = 2;
const CAMERA_X = ((W + FBO_OVERSCAN) / 2) * CELL_X;
const CAMERA_Z = ((H + FBO_OVERSCAN) / 2) * CELL_Z;

/**
 * The cell shape: a single upward-facing quad, not a cube.
 *
 * A cube would render nothing here. The WASM mesher culls a face whose
 * neighbour lookup falls outside the resident store, and with a map one cell
 * tall on Y *every* cell's up-neighbour is outside it — so every top face,
 * which is the only face a straight-down camera can see, gets culled. Custom
 * shapes (shapeIndex >= 2) with no mesh UVs skip that test entirely and are
 * emitted verbatim, which is both correct here and half the geometry: one quad
 * per cell instead of a cube's top plus its never-seen underside.
 *
 * Vertex order and winding match the engine's own cube top face
 * (`generateDefaultCubeMesh`), so it is front-facing under the same
 * counter-clockwise rule. Unit coordinates, scaled by cellSize at mesh time.
 */

/**
 * Height of the quad in unit cell coordinates, and the one number here that is
 * not the obvious one.
 *
 * The shader decides which cell a fragment belongs to — and therefore which
 * emission colour it gets — with `floor(origPos / cellSize)`, then subtracts 1
 * on the axis the face points along. A cube's top face sits at exactly
 * `1.0 * cellSize.y`, landing precisely ON that floor boundary: interpolating a
 * constant across a triangle is only exact when the barycentric weights sum to
 * exactly 1, so one ULP low makes `floor` return 0, the subtraction makes it
 * -1, and the lookup falls outside the window and yields black. A map many
 * cells tall absorbs that — the fragment just reads a neighbour — but with
 * `windowSize.y == 1` there is no neighbour and the whole screen goes black.
 *
 * Putting the quad at 1.5 cells lands the division mid-interval instead of on
 * the boundary, where no rounding can dislodge it. Lifting it is free: at
 * `axonometricAngle: 90` the projection's `heightScale` is zero, so world Y
 * contributes to neither screen position nor depth.
 */
const QUAD_Y = 1.0;

const TOP_QUAD = {
  // prettier-ignore
  vertices: new Float32Array([
    -0.5, QUAD_Y,  0.5,
     0.5, QUAD_Y,  0.5,
     0.5, QUAD_Y, -0.5,
    -0.5, QUAD_Y, -0.5,
  ]),
  // Empty: triplanar sampling, and the mesher only face-culls custom shapes
  // that carry per-vertex UVs.
  uvs: new Float32Array(0),
  indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
};
const TOP_QUAD_SHAPE = 2;

const TICK_METHOD = 'textrisTick';
const FRAME_MS = 1000 / 60;
/** Catch-up cap: a backgrounded tab must not fast-forward the game on return. */
const MAX_CATCHUP_FRAMES = 4;

const KEY_ACTIONS = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowDown: 'down',
  ArrowUp: 'rotateCW',
  x: 'rotateCW',
  X: 'rotateCW',
  z: 'rotateCCW',
  Z: 'rotateCCW',
  ' ': 'rotateCCW',
};

/**
 * Fills the window with a black field and centres the 256x240 canvas at the
 * largest whole-number scale that fits, so every NES pixel stays a square
 * block of identical size.
 */
function installViewportFit(viewport) {
  const container = viewport.container;
  const canvas = viewport.canvas;
  if (!container || !canvas) return;

  container.style.position = 'fixed';
  container.style.inset = '0';
  container.style.display = 'flex';
  container.style.alignItems = 'center';
  container.style.justifyContent = 'center';
  container.style.background = '#000';
  container.style.zIndex = '0';
  container.style.pointerEvents = 'none';
  container.style.overflow = 'hidden';

  canvas.style.display = 'block';
  canvas.style.imageRendering = 'pixelated';

  const fit = () => {
    const scale = Math.max(
      1,
      Math.floor(Math.min(window.innerWidth / W, window.innerHeight / H)),
    );
    canvas.style.width = `${W * scale}px`;
    canvas.style.height = `${H * scale}px`;
  };

  new ResizeObserver(fit).observe(document.documentElement);
  fit();
}

function createInput(scene) {
  const held = { left: false, right: false, down: false };
  const edges = { rotateCW: false, rotateCCW: false, anyPress: false };
  const listeners = [];

  const controller = Omosuen.newComponent(
    'input-controller',
    { name: 'Textris Input', preventDefault: true },
    scene,
  );

  return controller.then((ic) => {
    for (const [key, action] of Object.entries(KEY_ACTIONS)) {
      ic.bindAction({ eventType: 'keydown', key, action: `${action}:down` });
      ic.bindAction({ eventType: 'keyup', key, action: `${action}:up` });
    }
    for (const action of new Set(Object.values(KEY_ACTIONS))) {
      ic.onAction(`${action}:down`, () => {
        edges.anyPress = true;
        for (const fn of listeners) fn();
        if (action in held) held[action] = true;
        else edges[action] = true;
      });
      ic.onAction(`${action}:up`, () => {
        if (action in held) held[action] = false;
      });
    }
    return {
      /** Runs on any keypress — used to resume the AudioContext. */
      onAnyPress(fn) {
        listeners.push(fn);
      },
      /** Snapshot for one game frame; edges are consumed by reading them. */
      take() {
        const snapshot = {
          left: held.left,
          right: held.right,
          down: held.down,
          rotateCW: edges.rotateCW,
          rotateCCW: edges.rotateCCW,
          anyPress: edges.anyPress,
        };
        edges.rotateCW = false;
        edges.rotateCCW = false;
        edges.anyPress = false;
        return snapshot;
      },
    };
  });
}

export async function createScene() {
  const scene = await Omosuen.newComponent('nexus', { name: 'textris' });

  const atlasManager = await Omosuen.newComponent(
    'atlas-manager',
    {
      name: 'Textris Atlas',
      config: { atlasSize: 1024, maxAtlases: 1, padding: 1 },
    },
    scene,
  );

  // The cell-map's single material. Its albedo is multiplied by a lighting
  // term this scene deliberately pins to zero, so it never reaches the screen —
  // but the draw loop skips any range whose texture map has no packed frames,
  // so a real, loaded texture still has to exist. The palette swatch is it.
  await Omosuen.newComponent(
    'texture-map',
    {
      textureMapKey: 'cell',
      name: 'NES Palette',
      filePath: `${ASSETS}blank.png`,
      imageType: {
        cellSize: new Omosuen.Vector2D(32, 32),
        gridSize: new Omosuen.Vector2D(1, 1),
      },
      atlasManager,
    },
    scene,
  );

  await Omosuen.newComponent(
    'viewport',
    {
      name: 'textris-viewport',
      width: W,
      height: H,
      offsetX: 0,
      offsetY: 0,
      // The drawing buffer stays at NES resolution and CSS scales it up. Left
      // on, the viewport's own update would resync the buffer to the canvas's
      // laid-out CSS size every frame and undo exactly that.
      autoResize: false,
      backgroundColor: new Omosuen.Vector4D(0, 0, 0, 1),
    },
    scene,
  );
  const viewport = scene.getComponentByName('textris-viewport', true);
  if (viewport) installViewportFit(viewport);

  const cameraNexus = await Omosuen.newComponent(
    'nexus',
    { name: 'Textris Camera' },
    scene,
  );
  await Omosuen.newComponent(
    'transform',
    {
      name: 'Textris Camera Transform',
      position: new Omosuen.Vector3D(CAMERA_X, 0, CAMERA_Z),
    },
    cameraNexus,
  );
  await Omosuen.newComponent(
    'camera',
    {
      name: 'Textris Camera',
      viewportRef: 'textris-viewport',
      // zoom 1 + pixelScale 1: the framebuffer is already at NES resolution, so
      // there is nothing to scale here and nothing for the camera's own
      // sub-pixel snapping to do (it is skipped entirely at pixelScale <= 1).
      zoom: 1,
      pixelScale: 1,
      axonometricAngle: 90,
      orbitYaw: 45,
    },
    cameraNexus,
  );

  // Exactly one light, at zero brightness. With NO light components the shader
  // falls back to a default ambient plus a directional light, which would tint
  // every pixel; one ambient light at brightness 0 pins the lighting term to
  // zero so a cell's colour is precisely its emission colour.
  const lightNexus = await Omosuen.newComponent(
    'nexus',
    { name: 'Textris Light' },
    scene,
  );
  await Omosuen.newComponent(
    'light',
    {
      name: 'Textris Null Light',
      lightType: 'ambient',
      color: new Omosuen.Vector3D(0, 0, 0),
      brightness: 0,
    },
    lightNexus,
  );

  const size = new Omosuen.Vector3D(W, 1, H);
  const cellMap = await Omosuen.newComponent(
    'cell-map',
    {
      name: 'Textris Screen',
      materials: [
        {
          albedoTextureKey: 'cell',
          normalTextureKey: 'cell',
          emissionTextureKey: '',
          materialTextureKey: '',
          albedoFrame: 0,
          normalFrame: 0,
        },
      ],
      materialMap: new Omosuen.Array3D(size, 0),
      shapeMap: new Omosuen.Array3D(size, TOP_QUAD_SHAPE),
      meshes: [null, null, TOP_QUAD],
      emissionColorMap: buildInitialEmissionColorMap(),
      cellSize: new Omosuen.Vector3D(CELL_X, CELL_Z, CELL_Z),
      mapSize: size,
      chunkSize: new Omosuen.Vector3D(16, 1, 16),
      smoothing: 0,
      normalSmoothing: 0,
      autoFocusFromCamera: false,
      autoResizeFromZoom: false,
      revealExempt: true,
      // The draw cull volume is renderDistance (in CHUNKS) times chunk size
      // times cell size, centred on the camera — it is NOT derived from the
      // viewport. At the default of 1 it is a fraction of the board's width and
      // nothing renders at all. 9 chunks covers half the board on both axes.
      renderDistance: { x: 9, y: 1, z: 9 },
      frustumPadding: { x: 64, y: 512, z: 64 },
    },
    scene,
  );
  attach(cellMap);

  const audio = await createAudio(scene);
  const input = await createInput(scene);
  input.onAnyPress(() => audio.unlock());

  const game = createGame();
  reset(game);

  const fx = {
    move: () => audio.sfx('move'),
    rotate: () => audio.sfx('rotate'),
    lock: () => audio.sfx('lock'),
    lineClear: (count) => audio.sfx(count >= 4 ? 'tetris' : 'lineClear'),
    levelUp: () => audio.sfx('levelUp'),
    topOut: () => audio.gameOver(),
    restart: () => audio.restart(),
  };

  let accumulator = 0;
  Omosuen.registerMethod('nexus', TICK_METHOD, (_component, deltaTime) => {
    audio.startMusic();

    accumulator += Math.min(deltaTime, 250);
    let stepped = 0;
    while (accumulator >= FRAME_MS && stepped < MAX_CATCHUP_FRAMES) {
      accumulator -= FRAME_MS;
      // Edges belong to the frame that consumed them; later catch-up frames in
      // the same tick see held keys only.
      step(game, input.take(), fx);
      stepped++;
    }
    if (accumulator >= FRAME_MS) accumulator = 0;
    if (stepped === 0) return;

    audio.setDanger(game.phase !== 'gameover' && isInDangerZone(game));
    render(game);
    flush();
  });
  await Omosuen.newComponent(
    'nexus',
    { name: 'Textris Tick', updateOverride: TICK_METHOD },
    scene,
  );

  const overlay = await Omosuen.newComponent('state-overlay', {
    name: 'Textris Chrome',
    bundleKey: 'site-chrome',
    cssOverrides: {
      position: 'relative',
      width: '100%',
      minHeight: '100vh',
      background: 'transparent',
    },
  });
  scene.addComponent(overlay);

  return scene;
}
