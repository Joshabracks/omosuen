/**
 * Omosuen site hero scene — full-bleed cell-map behind the State Street landing UI.
 */

const Omosuen = window.Omosuen;

const CELL = 32;
const MAP_SIZE = 10;
const MAP_W = MAP_SIZE;
const MAP_DEPTH = MAP_SIZE;
const MAP_HEIGHT = MAP_SIZE;

const TILE_SIZE = 32;
const AXONOMETRIC_ANGLE = 15;
/** Inset margin so the pyramid clears viewport edges. */
const ZOOM_PADDING = 0.88;
/** One visible cube per row (trailing x); 10 + 9 + … + 1. */
const HERO_VISIBLE_CELL_COUNT = (MAP_SIZE * (MAP_SIZE + 1)) / 2;

/** Curated dark lapis tiles — see hero-texture-ids.json / pick-blue-tiles.py. */
let heroTextureIds = [];

async function loadHeroTextureIds() {
  if (heroTextureIds.length > 0) return heroTextureIds;
  const res = await fetch(new URL('./hero-texture-ids.json', import.meta.url));
  if (!res.ok) {
    throw new Error(`Failed to load hero texture list (${res.status})`);
  }
  heroTextureIds = await res.json();
  if (heroTextureIds.length !== HERO_VISIBLE_CELL_COUNT) {
    throw new Error(
      `Expected ${HERO_VISIBLE_CELL_COUNT} hero textures, got ${heroTextureIds.length}`,
    );
  }
  return heroTextureIds;
}

function heroTopTextureKey(index) {
  return `hero-top-${heroTextureIds[index]}`;
}

function heroTopTexturePath(index) {
  return `./assets/tiles/texture${heroTextureIds[index]}.png`;
}

function forEachVisiblePyramidCell(mapSize, callback) {
  for (let y = 0; y < mapSize; y++) {
    for (let z = 0; z < mapSize - y; z++) {
      const x = mapSize - y - z - 1;
      callback(x, y, z);
    }
  }
}

function projectToIso(x, y, z, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  const sinA = Math.sin(rad);
  const heightScale = Math.cos(rad) * 1.1547005383792515;
  const isoH = 0.8660254037844386;
  return {
    x: x * isoH - z * isoH,
    y: x * sinA - y * heightScale + z * sinA,
  };
}

/** Iso-space bounds and world focus that centers the visible pyramid shell. */
function getPyramidFrame(mapSize, cell, angleDeg) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  forEachVisiblePyramidCell(mapSize, (x, y, z) => {
    for (const wx of [x * cell, (x + 1) * cell]) {
      for (const wy of [y * cell, (y + 1) * cell]) {
        for (const wz of [z * cell, (z + 1) * cell]) {
          const iso = projectToIso(wx, wy, wz, angleDeg);
          minX = Math.min(minX, iso.x);
          maxX = Math.max(maxX, iso.x);
          minY = Math.min(minY, iso.y);
          maxY = Math.max(maxY, iso.y);
        }
      }
    }
  });

  const isoCenterX = (minX + maxX) / 2;
  const isoCenterY = (minY + maxY) / 2;
  const rad = (angleDeg * Math.PI) / 180;
  const sinA = Math.sin(rad);
  const heightScale = Math.cos(rad) * 1.1547005383792515;
  const isoH = 0.8660254037844386;
  const plane = (mapSize / 2) * cell;
  const focusX = plane;
  const focusZ = plane - isoCenterX / isoH;
  const focusY = (sinA * (focusX + focusZ) - isoCenterY) / heightScale;

  return {
    focusX,
    focusY,
    focusZ,
    halfWidth: (maxX - minX) / 2,
    halfHeight: (maxY - minY) / 2,
  };
}

const PYRAMID_FRAME = getPyramidFrame(MAP_SIZE, CELL, AXONOMETRIC_ANGLE);

function computeHeroZoom(viewportWidth, viewportHeight) {
  if (viewportWidth <= 0 || viewportHeight <= 0) return 1;

  // Rendering uses projScale = zoom² (see camera/screen-pick/ray.ts), so iso extent
  // E lands at E * zoom² pixels from center. Fit both axes; use the tighter bound.
  const maxZoomSqByWidth =
    viewportWidth / (2 * PYRAMID_FRAME.halfWidth);
  const maxZoomSqByHeight =
    viewportHeight / (2 * PYRAMID_FRAME.halfHeight);
  const fitZoom = Math.sqrt(
    Math.min(maxZoomSqByWidth, maxZoomSqByHeight),
  );
  return fitZoom * ZOOM_PADDING;
}

function applyCameraZoom(scene, viewportWidth, viewportHeight) {
  const camera = scene.getComponentByType('camera', true);
  if (!camera) return;
  camera.setZoom(computeHeroZoom(viewportWidth, viewportHeight));
}

function styleViewportContainer(container, canvas) {
  container.style.position = 'fixed';
  container.style.inset = '0';
  container.style.width = '100%';
  container.style.height = '100%';
  container.style.zIndex = '0';
  container.style.pointerEvents = 'none';
  container.style.overflow = 'hidden';

  if (canvas) {
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
  }
}

function syncHeroViewport(scene, viewport) {
  const canvas = viewport.canvas;
  if (!canvas) return;

  const width = Math.round(canvas.clientWidth);
  const height = Math.round(canvas.clientHeight);
  if (width <= 0 || height <= 0) return;

  if (width !== viewport.width || height !== viewport.height) {
    viewport.resize(width, height);
  }
  applyCameraZoom(scene, width, height);
}

function installHeroViewportFit(scene, viewport) {
  const target = viewport.container ?? viewport.canvas;
  if (!target) return;

  const observer = new ResizeObserver(() => {
    syncHeroViewport(scene, viewport);
  });

  observer.observe(target);
  requestAnimationFrame(() => syncHeroViewport(scene, viewport));
}

/**
 * Q*bert quarter-pyramid shell — one cube per row at the trailing x edge.
 * Row z grows downward; layer y shrinks the footprint by one column each step up.
 * Only the rightmost cell in each (y, z) row is kept — interior cubes are hidden.
 */
function generateQbertPyramid(mapSize) {
  const materialMap = new Omosuen.Array3D(
    new Omosuen.Vector3D(mapSize, mapSize, mapSize),
    0,
  );
  const shapeMap = new Omosuen.Array3D(
    new Omosuen.Vector3D(mapSize, mapSize, mapSize),
    0,
  );

  let materialIndex = 0;
  forEachVisiblePyramidCell(mapSize, (x, y, z) => {
    const cell = new Omosuen.Vector3D(x, y, z);
    shapeMap.set(cell, 1);
    materialMap.set(cell, materialIndex);
    materialIndex += 1;
  });

  return { materialMap, shapeMap, cellCount: materialIndex };
}

function createHeroMaterial(topTextureKey) {
  return {
    albedoTextureKey: topTextureKey,
    normalTextureKey: '',
    emissionTextureKey: '',
    materialTextureKey: '',
    albedoFrame: 0,
    smoothness: 0,
  };
}

function buildHeroMaterials() {
  const materials = [];
  for (let i = 0; i < HERO_VISIBLE_CELL_COUNT; i++) {
    materials.push(createHeroMaterial(heroTopTextureKey(i)));
  }
  return materials;
}

function buildHeroTextureLoads(atlasManager, gridOne, scene) {
  const loads = [];

  for (let i = 0; i < HERO_VISIBLE_CELL_COUNT; i++) {
    loads.push(
      Omosuen.newComponent(
        'texture-map',
        {
          textureMapKey: heroTopTextureKey(i),
          name: `Hero Top Texture ${i + 1}`,
          filePath: heroTopTexturePath(i),
          imageType: gridOne,
          atlasManager,
        },
        scene,
      ),
    );
  }

  return loads;
}

export async function createScene() {
  await loadHeroTextureIds();

  const scene = await Omosuen.newComponent('nexus', {
    name: 'Omosuen Site',
  });

  const atlasManager = await Omosuen.newComponent(
    'atlas-manager',
    {
      name: 'Site Atlas Manager',
      config: { atlasSize: 2048, maxAtlases: 4, padding: 1 },
    },
    scene,
  );

  const gridOne = {
    cellSize: new Omosuen.Vector2D(TILE_SIZE, TILE_SIZE),
    gridSize: new Omosuen.Vector2D(1, 1),
  };

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  await Promise.all([
    ...buildHeroTextureLoads(atlasManager, gridOne, scene),
    Omosuen.newComponent(
      'viewport',
      {
        name: 'omosuen-viewport',
        width: viewportWidth,
        height: viewportHeight,
        offsetX: 0,
        offsetY: 0,
        backgroundColor: new Omosuen.Vector4D(0.039, 0.063, 0.157, 1.0),
      },
      scene,
    ),
  ]);

  const viewport = scene.getComponentByName('omosuen-viewport', true);
  if (viewport?.container) {
    styleViewportContainer(viewport.container, viewport.canvas);
  }

  const { materialMap, shapeMap } = generateQbertPyramid(MAP_SIZE);

  const cameraNexus = await Omosuen.newComponent(
    'nexus',
    { name: 'Site Camera Nexus' },
    scene,
  );
  await Omosuen.newComponent(
    'transform',
    {
      name: 'Site Camera Transform',
      position: new Omosuen.Vector3D(
        PYRAMID_FRAME.focusX,
        PYRAMID_FRAME.focusY,
        PYRAMID_FRAME.focusZ,
      ),
    },
    cameraNexus,
  );
  await Omosuen.newComponent(
    'camera',
    {
      name: 'Site Camera',
      viewportRef: 'omosuen-viewport',
      zoom: computeHeroZoom(viewportWidth, viewportHeight),
      axonometricAngle: AXONOMETRIC_ANGLE,
      pixelScale: 1,
    },
    cameraNexus,
  );

  if (viewport) {
    installHeroViewportFit(scene, viewport);
  }

  const cellMap = await Omosuen.newComponent(
    'cell-map',
    {
      name: 'Hero Terrain',
      materials: buildHeroMaterials(),
      materialMap,
      shapeMap,
      cellSize: new Omosuen.Vector3D(CELL, CELL, CELL),
      mapSize: new Omosuen.Vector3D(MAP_W, MAP_HEIGHT, MAP_DEPTH),
      smoothing: 0,
      normalSmoothing: 0,
    },
    scene,
  );

  const heroCharactersUrl = new URL(
    `./hero-characters.js?t=${Date.now()}`,
    import.meta.url,
  ).href;
  const { initHeroCharacters } = await import(heroCharactersUrl);
  await initHeroCharacters(scene, cellMap, {
    mapSize: MAP_SIZE,
    cellSize: CELL,
  });

  const ambientNexus = await Omosuen.newComponent(
    'nexus',
    { name: 'Ambient Light Nexus' },
    scene,
  );
  await Omosuen.newComponent(
    'light',
    {
      name: 'Global Ambient',
      lightType: 'ambient',
      // Lapis-tinted fill — keeps parchment tiles muted against the UI.
      color: new Omosuen.Vector3D(0.45, 0.52, 0.78),
      brightness: 0.5,
    },
    ambientNexus,
  );

  const dirLightNexus = await Omosuen.newComponent(
    'nexus',
    { name: 'Directional Light Nexus' },
    scene,
  );
  await Omosuen.newComponent(
    'light',
    {
      name: 'Key Light',
      lightType: 'directional',
      color: new Omosuen.Vector3D(0.7, 0.74, 0.9),
      brightness: 0.5,
      direction: new Omosuen.Vector3D(0.0, -0.25, 0.4),
    },
    dirLightNexus,
  );

  const overlay = await Omosuen.newComponent('state-overlay', {
    name: 'Site Chrome',
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
