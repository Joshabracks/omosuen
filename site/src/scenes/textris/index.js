/**
 * Textris — the whole NES screen as a cell-map.
 *
 * One cell per NES pixel, viewed straight down. The projection is normally an
 * isometric diamond; `orbitYaw: 45` + `axonometricAngle: 90` collapses it to an
 * axis-aligned grid where
 *
 *     screenX = 1.2247449 * worldX      screenY = 1.4142136 * worldZ
 *
 * and world Y drops out entirely. Cells come out square when
 * `cellSize.x / cellSize.z == 2 / sqrt(3)`. See `screen.js` for how colour gets
 * to the GPU.
 *
 * Because world Y is invisible from straight overhead, the screen is free to be
 * secretly three-dimensional: each pixel's cell sits on its own Y layer (see
 * `layers.js`), and pausing tilts the camera to reveal it.
 *
 * The viewport is FIXED — same size and same camera scale whether playing or
 * paused — so the offscreen framebuffer is allocated exactly once and a
 * transition frame writes three properties and nothing else. It is sized for the
 * tilted view and supersampled (`SUPERSAMPLE`), which costs some margin around
 * the screen during play and gives up pixel-exactness there, deliberately: the
 * alternative was resizing the framebuffer every frame of the transition.
 */

import { createAudio } from './audio.js';
import { createGame, isInDangerZone, reset, step } from './game.js';
import { LAYERS, buildLayerMap } from './layers.js';
import { render } from './render.js';
import {
  H,
  W,
  attach,
  buildInitialEmissionColorMap,
  cellIndex,
  flush,
} from './screen.js';

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
 * Cell height. Unlike X and Z this one is free — at `axonometricAngle: 90` the
 * projection's `heightScale` is zero, so world Y reaches neither screen
 * position nor depth while the game is being played. It only becomes visible
 * when the pause view tilts the camera over.
 *
 * It must nonetheless be a power of two. The shader picks the cell a fragment
 * belongs to — and so the emission colour it gets — with
 * `floor(origPos / cellSize)`, then subtracts 1 along the face normal. A cube's
 * top face sits at exactly `(layer + 1) * cellSize.y`, i.e. precisely ON a
 * floor boundary, so the answer is only right if that division is exact. With
 * an awkward cellSize.y it is not, and the lookup lands a layer low: cells read
 * the emission colour of the empty cell beneath them and the screen goes black.
 * Integers divide exactly in float32, so a power of two is correct at every
 * layer. Beyond that it is a look: taller cells push the layers further apart
 * in the tilted view, which is the whole point of the reveal.
 */
const CELL_Y = 2.0;

/** Default cube. Index 0 is air, 1 is the engine's own cube; 2+ are custom shapes. */
const CUBE_SHAPE = 1;

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
  Enter: 'pause',
  Escape: 'pause',
  p: 'pause',
  P: 'pause',
};

/**
 * The pause reveal: the camera tilts off the straight-down view so the layers
 * separate, then tilts back.
 *
 * The angle LEADS and the yaw TRAILS, which is not a stylistic choice. Swinging
 * the yaw round while the camera is still overhead throws the projected image
 * to roughly 379 units tall — far outside the framebuffer. Dropping the angle
 * first keeps the vertical extent at or under 240 for the whole path, and the
 * widest the image ever gets is 328, at the very end.
 */
const PAUSE_MS = 700;
const PLAY_ANGLE = 90;
const PAUSE_ANGLE = 30;
const PLAY_YAW = 45;
const PAUSE_YAW = 0;
/** Fractions of the transition each parameter occupies; they overlap. */
const ANGLE_SPAN = [0, 0.6];
const YAW_SPAN = [0.4, 1];

/**
 * How much of the world is on screen, in cells — FIXED, the same while playing
 * and while paused.
 *
 * Play alone would need exactly the 256x240 screen, and the tilt swings the
 * image out to about 328 x 240, so a view sized for the tilt carries margin
 * during play. That margin is the price of never resizing: growing the viewport
 * through the transition meant reallocating the offscreen framebuffer every
 * single frame, which is what the jerkiness was. Pixel-exactness during play
 * goes with it, which is a trade we are making deliberately.
 */
const VIEW_W = 344;
const VIEW_H = 248;

/**
 * Framebuffer texels per cell.
 *
 * At 1:1 a cell is a single texel — exactly right for the flat NES screen, and
 * far too coarse once the image is on the diagonal, where every silhouette and
 * every cube side gets quantised to whole cells. Three texels per cell resolves
 * those edges properly.
 *
 * Getting there needs BOTH camera knobs, because they pull in opposite
 * directions. Texels per cell is `zoom / pixelScale`, while the framebuffer
 * itself is `viewport / (zoom * pixelScale)` — so raising zoom alone shrinks the
 * visible world, and lowering pixelScale alone (the obvious move) enlarges the
 * framebuffer only to have the post-process resample it back down onto an
 * unchanged canvas, which looks no better. Holding `zoom * pixelScale` at 1
 * keeps the framebuffer matched to the canvas 1:1, and the pair below is the
 * solution of `zoom / pixelScale = SUPERSAMPLE` under that constraint.
 */
const SUPERSAMPLE = 3;
const VIEW_ZOOM = Math.sqrt(SUPERSAMPLE);
const VIEW_PIXEL_SCALE = 1 / Math.sqrt(SUPERSAMPLE);
/** Drawing-buffer size. Constant, so the framebuffer is allocated exactly once. */
const CANVAS_W = VIEW_W * SUPERSAMPLE;
const CANVAS_H = VIEW_H * SUPERSAMPLE;

/**
 * Where to stand so the NES screen is centred in the view.
 *
 * The offscreen framebuffer is 2 texels larger than the viewport per axis
 * (`FBO_OVERSCAN_PX`) and the post-process shows the region anchored at its
 * TOP-LEFT, not its centre — so the visible window sits one texel off the
 * camera, which is `1 / SUPERSAMPLE` of a cell. Correcting for that puts the
 * middle of the 256x240 screen in the middle of the view.
 */
const CAMERA_X = (W / 2 + 1 / SUPERSAMPLE) * CELL_X;
const CAMERA_Z = (H / 2 + 1 / SUPERSAMPLE) * CELL_Z;

/**
 * A directional key light, off during play and faded up for the reveal.
 *
 * Lighting is ADDITIVE here, not modulating: the shader computes
 * `albedo * lighting + highlight`, and a cell's colour arrives as the highlight
 * term, so the light cannot shade a cell's own colour — it lifts each face by an
 * amount that depends on which way the face points. That is precisely what the
 * flat-shaded tilted view was missing, and it also rescues the black cells,
 * whose geometry was previously invisible against the background.
 *
 * `direction` points away from the light, and the shader uses
 * `dot(normal, normalize(-direction))` — so this lights the tops most, the two
 * visible sides progressively less, and separates all three.
 */
const PAUSE_LIGHT_BRIGHTNESS = 0.45;
const LIGHT_SPAN = [0.15, 1];
const KEY_LIGHT_DIRECTION = { x: -0.35, y: -0.8, z: -0.45 };

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** Progress of one sub-span of the overall transition, eased, clamped to 0..1. */
function spanProgress(t, [from, to]) {
  return easeInOut(Math.min(Math.max((t - from) / (to - from), 0), 1));
}

const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Fills the window with a black field and centres the canvas at the largest
 * whole-number scale that fits, so every NES pixel stays a square block of
 * identical size, or down to fit when the supersampled canvas is larger than
 * the window. The canvas size itself never changes, so this only runs on a
 * genuine window resize.
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
    const w = viewport.width;
    const h = viewport.height;
    // Measured against the CONTAINER, not the window: the site stylesheet insets
    // it clear of the header and the controls strip (see `#textris-viewport`),
    // so the board is never hidden behind the page chrome.
    const raw = Math.min(container.clientWidth / w, container.clientHeight / h);
    // Upscaling is snapped to whole numbers and left un-smoothed, so an NES
    // pixel stays a square block of identical size. Downscaling — which is what
    // the supersampled pause view needs, being larger than the window — is
    // taken as-is and smoothed, since resolving a supersampled image down is
    // exactly what makes the tilted edges clean rather than stair-stepped.
    const upscaling = raw >= 1;
    const scale = upscaling ? Math.floor(raw) : raw;
    canvas.style.imageRendering = upscaling ? 'pixelated' : 'auto';
    canvas.style.width = `${Math.round(w * scale)}px`;
    canvas.style.height = `${Math.round(h * scale)}px`;
  };

  new ResizeObserver(fit).observe(container);
  fit();
}

/**
 * Drives the pause reveal: `playing -> entering -> paused -> exiting -> playing`.
 * Returns a controller the tick advances each frame.
 */
function createPauseView(camera, keyLight) {
  let phase = 'playing';
  let t = 0;

  // Only the camera's orientation and the key light move. The viewport, the
  // framebuffer and both camera scale factors are fixed for the life of the
  // scene, so a transition frame costs three property writes and no allocation.
  const apply = () => {
    camera.axonometricAngle = lerp(
      PLAY_ANGLE,
      PAUSE_ANGLE,
      spanProgress(t, ANGLE_SPAN),
    );
    camera.orbitYaw = lerp(PLAY_YAW, PAUSE_YAW, spanProgress(t, YAW_SPAN));
    keyLight.brightness = PAUSE_LIGHT_BRIGHTNESS * spanProgress(t, LIGHT_SPAN);
  };

  return {
    get frozen() {
      return phase !== 'playing';
    },
    toggle() {
      // Reversible mid-transition: pressing pause again while the camera is
      // still on its way out turns it straight back round.
      phase =
        phase === 'paused' || phase === 'entering' ? 'exiting' : 'entering';
    },
    /** Advances the transition. Returns true on the frame play resumes. */
    advance(deltaTime) {
      if (phase === 'playing' || phase === 'paused') return false;
      const direction = phase === 'entering' ? 1 : -1;
      t = Math.min(Math.max(t + (direction * deltaTime) / PAUSE_MS, 0), 1);
      apply();
      if (phase === 'entering' && t === 1) phase = 'paused';
      if (phase === 'exiting' && t === 0) {
        phase = 'playing';
        return true;
      }
      return false;
    },
  };
}

function createInput(scene) {
  const held = { left: false, right: false, down: false };
  const edges = {
    rotateCW: false,
    rotateCCW: false,
    pause: false,
    anyPress: false,
  };
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
        for (const fn of listeners) fn();
        // Pause is deliberately not an `anyPress`: it must not double as the
        // keypress that restarts a finished game.
        if (action !== 'pause') edges.anyPress = true;
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
      /**
       * Consumes the pause edge. Read separately from `take()` because it has
       * to keep working while the game is frozen and `take()` is not running.
       */
      takePause() {
        const pressed = edges.pause;
        edges.pause = false;
        return pressed;
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
      width: CANVAS_W,
      height: CANVAS_H,
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
      // Y sits mid-stack so the tilted pause view stays centred on the layers.
      // Free during play: `heightScale` is zero at axonometricAngle 90, so the
      // camera's own Y drops out of the projection along with everything else's.
      position: new Omosuen.Vector3D(CAMERA_X, (LAYERS * CELL_Y) / 2, CAMERA_Z),
    },
    cameraNexus,
  );
  const camera = await Omosuen.newComponent(
    'camera',
    {
      name: 'Textris Camera',
      viewportRef: 'textris-viewport',
      // zoom 1 + pixelScale 1 puts the framebuffer at exactly NES resolution:
      // one cell per texel, nothing to scale, and the camera's own sub-pixel
      // snapping skipped entirely (it is, at pixelScale <= 1). The pause reveal
      // moves both together to supersample — see PAUSE_SUPERSAMPLE.
      zoom: VIEW_ZOOM,
      pixelScale: VIEW_PIXEL_SCALE,
      axonometricAngle: PLAY_ANGLE,
      orbitYaw: PLAY_YAW,
    },
    cameraNexus,
  );

  // Two lights, both contributing nothing while the game is being played. With
  // NO light components at all the shader falls back to a default ambient plus
  // a directional light, which would tint every pixel; an ambient light at zero
  // brightness pins the lighting term to zero instead, so a cell's colour is
  // precisely its emission colour and the palette survives intact.
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
  // Dark until the reveal fades it up; see PAUSE_LIGHT_BRIGHTNESS.
  const keyLight = await Omosuen.newComponent(
    'light',
    {
      name: 'Textris Pause Key Light',
      lightType: 'directional',
      color: new Omosuen.Vector3D(1, 1, 1),
      brightness: 0,
      direction: new Omosuen.Vector3D(
        KEY_LIGHT_DIRECTION.x,
        KEY_LIGHT_DIRECTION.y,
        KEY_LIGHT_DIRECTION.z,
      ),
    },
    lightNexus,
  );

  // One solid cube per screen pixel, sitting on that pixel's own layer; every
  // other cell in the column is air. The layer map is static for the life of
  // the scene, so this is built once and never touched again.
  const layerMap = buildLayerMap();
  const size = new Omosuen.Vector3D(W, LAYERS, H);
  const shapeMap = new Omosuen.Array3D(size, 0);
  for (let i = 0; i < layerMap.length; i++) {
    shapeMap.value[cellIndex(i, layerMap[i], LAYERS)] = CUBE_SHAPE;
  }

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
      shapeMap,
      emissionColorMap: buildInitialEmissionColorMap(layerMap, LAYERS),
      cellSize: new Omosuen.Vector3D(CELL_X, CELL_Y, CELL_Z),
      mapSize: size,
      // One chunk tall, so the chunk grid stays 17x1x15 = 255 chunks however
      // many layers there are.
      chunkSize: new Omosuen.Vector3D(16, LAYERS, 16),
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
  attach(cellMap, layerMap);

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

  const pauseView = createPauseView(camera, keyLight);

  let accumulator = 0;
  Omosuen.registerMethod('nexus', TICK_METHOD, (_component, deltaTime) => {
    audio.startMusic();

    if (input.takePause()) pauseView.toggle();
    const resumed = pauseView.advance(deltaTime);
    if (pauseView.frozen) {
      // Frozen: the camera is still moving but the game is not. Drop the
      // elapsed time on the floor so play does not fast-forward on resume, and
      // drain the input so keys pressed while paused do not all fire at once
      // the moment it un-freezes.
      input.take();
      accumulator = 0;
      return;
    }
    if (resumed) accumulator = 0;

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
