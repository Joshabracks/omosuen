/**
 * Animated demon sprites that spawn on the pyramid apex and hop down its shell.
 */

const Omosuen = window.Omosuen;

const ASE_BASE = './assets/characters/';
/** 32px art × (4/3) ≈ one cell wide on the 32-unit grid (see colony-forever). */
const SPRITE_SCALE = 4 / 3;
const VISUALS_NEXUS = 'visuals';
const SPAWN_INTERVAL_MS = 5000;
const IDLE_MIN_MS = 3000;
const IDLE_MAX_MS = 8000;
const FALL_MS = 550;
const JUMP_MS = 420;
const JUMP_ARC = 12;
const DEATH_FLICKER_MS = 2000;
const FLICKER_INTERVAL_MS = 90;
const FALL_HEIGHT = 48;

/** Scales cell-map highlight color (0–1 channels passed to setEmissionColor). */
const EMISSION_COLOR_SCALE = 0.25;
const CELL_LIGHT_BRIGHTNESS = 0.45;
const CELL_LIGHT_RADIUS = 40;
const CELL_LIGHT_HARDNESS = 0.4;
/** Lift above cellToWorldCoordinates top-face Y (fraction of cell height). */
const CELL_LIGHT_HEIGHT = 0.25;

const TICK_METHOD = 'heroCharactersTick';

const CHARACTER_SPRITES = [
  { id: 'MiniSuccubus', file: 'MiniSuccubus.aseprite' },
  { id: 'MiniHighDemon', file: 'MiniHighDemon.aseprite' },
  { id: 'MiniDemonFireKeeper', file: 'MiniDemonFireKeeper.aseprite' },
  { id: 'MiniImp', file: 'MiniImp.aseprite' },
  { id: 'MiniFireImp', file: 'MiniFireImp.aseprite' },
  { id: 'MiniDemonTormentor', file: 'MiniDemonTormentor.aseprite' },
  { id: 'MiniDemonFireThrower', file: 'MiniDemonFireThrower.aseprite' },
  { id: 'MiniClawedDemon', file: 'MiniClawedDemon.aseprite' },
  { id: 'MiniDemoness', file: 'MiniDemoness.aseprite' },
  { id: 'MiniDemonLord', file: 'MiniDemonLord.aseprite' },
];

/** MiniImp and MiniFireImp have no jump tag — use walk while moving between cells. */
const IMP_SPRITES = new Set(['MiniImp', 'MiniFireImp']);

const IDLE_TAGS = ['idle', 'Idle'];
const DEATH_TAGS = ['death', 'Death'];

/** @typedef {{ x: number, y: number, z: number }} Cell */

let mapSize = 10;
let cellSize = 32;
/** @type {import('omosuen').nexus | null} */
let sceneRef = null;
/** @type {import('omosuen').cell_map | null} */
let cellMapRef = null;
/** @type {Character[]} */
const characters = [];
/** @type {Map<string, number>} */
const occupancy = new Map();
/** @type {Map<string, import('omosuen').light>} */
const cellLights = new Map();
let spawnTimer = 0;
let nextCharId = 0;
let tickRegistered = false;

/**
 * @typedef {Object} Character
 * @property {number} id
 * @property {import('omosuen').nexus} nexus
 * @property {import('omosuen').transform} transform
 * @property {string} spriteId
 * @property {import('omosuen').Vector3D} emissionColor
 * @property {Cell} cell
 * @property {Cell} targetCell
 * @property {{ x: number, y: number, z: number } | null} fromWorld
 * @property {{ x: number, y: number, z: number } | null} toWorld
 * @property {number} moveElapsed
 * @property {'falling' | 'idle' | 'jumping' | 'grounded' | 'dying'} state
 * @property {number} idleRemaining
 * @property {string} currentAnim
 * @property {import('omosuen').animation_controller | null} controller
 * @property {number} flickerRemaining
 * @property {number} flickerPhase
 * @property {boolean} flickerVisible
 */

function forEachShellCell(callback) {
  for (let y = 0; y < mapSize; y++) {
    for (let z = 0; z < mapSize - y; z++) {
      const x = mapSize - y - z - 1;
      callback(x, y, z);
    }
  }
}

function scaledEmissionColor(color) {
  return new Omosuen.Vector3D(
    color.x * EMISSION_COLOR_SCALE,
    color.y * EMISSION_COLOR_SCALE,
    color.z * EMISSION_COLOR_SCALE,
  );
}

/** World position for a per-cell point light (top-face center + small lift). */
function cellLightPosition(x, y, z) {
  const w = cellWorld(cellMapRef, x, y, z);
  return new Omosuen.Vector3D(
    w.x,
    w.y + cellSize * CELL_LIGHT_HEIGHT,
    w.z,
  );
}

function activateCellLight(cell, color) {
  const light = cellLights.get(cellKey(cell.x, cell.y, cell.z));
  if (!light) return;
  light.setColor(color);
  light.setBrightness(CELL_LIGHT_BRIGHTNESS);
}

function cellKey(x, y, z) {
  return `${x},${y},${z}`;
}

function isShellCell(x, y, z) {
  if (y < 0 || y >= mapSize || z < 0 || z >= mapSize - y) return false;
  return x === mapSize - y - z - 1;
}

/** @returns {Cell[]} */
function getDownNeighbors(x, y, z) {
  if (y <= 0) return [];
  const neighbors = [];
  const right = { x: x + 1, y: y - 1, z };
  const left = { x, y: y - 1, z: z + 1 };
  if (isShellCell(right.x, right.y, right.z)) neighbors.push(right);
  if (isShellCell(left.x, left.y, left.z)) neighbors.push(left);
  return neighbors;
}

function apexCell() {
  return { x: 0, y: mapSize - 1, z: 0 };
}

function cellWorld(cellMap, x, y, z) {
  const w = cellMap.cellToWorldCoordinates(new Omosuen.Vector3D(x, y, z));
  return { x: w.x, y: w.y, z: w.z };
}

function lerp3(a, b, t) {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

function randomEmissionColor() {
  const hue = Math.random();
  const sat = 0.65 + Math.random() * 0.35;
  const light = 0.45 + Math.random() * 0.25;

  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((hue * 6) % 2) - 1));
  const m = light - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  const h6 = hue * 6;
  if (h6 < 1) {
    r = c;
    g = x;
  } else if (h6 < 2) {
    r = x;
    g = c;
  } else if (h6 < 3) {
    g = c;
    b = x;
  } else if (h6 < 4) {
    g = x;
    b = c;
  } else if (h6 < 5) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  return new Omosuen.Vector3D(r + m, g + m, b + m);
}

function motionTags(spriteId) {
  if (IMP_SPRITES.has(spriteId)) {
    return ['walk', 'Walk', 'Walking', 'walking'];
  }
  return ['jump', 'Jump', 'walk', 'Walk'];
}

function visualsNexusOf(char) {
  return char.nexus.getComponentByName(VISUALS_NEXUS, false);
}

function controllerOf(char) {
  if (char.controller) return char.controller;
  const visuals = visualsNexusOf(char);
  if (!visuals) return null;
  char.controller = visuals.getComponentByType('animation-controller', false);
  return char.controller;
}

/** Namespaced tag ids from aseprite-loader `sources` import (`${spriteId}-${tag}`). */
function animationTagCandidates(spriteId, tags) {
  const out = [];
  for (let i = 0; i < tags.length; i++) {
    out.push(`${spriteId}-${tags[i]}`);
  }
  for (let i = 0; i < tags.length; i++) {
    out.push(tags[i]);
  }
  return out;
}

function playAnim(char, candidates, restart = false) {
  const controller = controllerOf(char);
  if (!controller) return false;
  for (const tag of animationTagCandidates(char.spriteId, candidates)) {
    if (controller.hasAnimation(tag)) {
      if (restart || char.currentAnim !== tag) {
        controller.play(tag, restart);
        char.currentAnim = tag;
      }
      return true;
    }
  }
  return false;
}

function forEachCharacterSprite(char, fn) {
  const visuals = visualsNexusOf(char);
  if (!visuals) return;
  const sprites = visuals.getComponentsByType('sprite', false);
  for (let i = 0; i < sprites.length; i++) fn(sprites[i]);
}

function configureCharacterSprites(char) {
  forEachCharacterSprite(char, (sprite) => {
    sprite.setTint(1, 1, 1, 1);
    sprite.setOpacity(1);
    sprite.setVisible(true);
  });
}

function setSpritesVisible(char, visible) {
  forEachCharacterSprite(char, (sprite) => {
    sprite.setVisible(visible);
  });
}

/** Root transform carries facing (±1 on X); sprite size lives on the visuals child. */
function setFacingForJump(rootTransform, fromCell, toCell) {
  const dx = toCell.x - fromCell.x;
  const dz = toCell.z - fromCell.z;
  const faceRight = dx - dz >= 0;
  rootTransform.setScale(faceRight ? 1 : -1, 1, 1);
}

function applyVisualScale(visualsTransform) {
  visualsTransform.setScale(SPRITE_SCALE, SPRITE_SCALE, SPRITE_SCALE);
}

function removeCharacter(char) {
  const idx = characters.indexOf(char);
  if (idx >= 0) characters.splice(idx, 1);
  const key = cellKey(char.cell.x, char.cell.y, char.cell.z);
  if (occupancy.get(key) === char.id) occupancy.delete(key);
  char.nexus.dispose();
}

function startDeath(char) {
  if (char.state === 'dying') return;
  char.state = 'dying';
  char.flickerRemaining = DEATH_FLICKER_MS;
  char.flickerPhase = 0;
  char.flickerVisible = true;
  const key = cellKey(char.cell.x, char.cell.y, char.cell.z);
  if (occupancy.get(key) === char.id) occupancy.delete(key);
  playAnim(char, DEATH_TAGS, true);
}

function landCharacter(char, cell) {
  const key = cellKey(cell.x, cell.y, cell.z);
  const existingId = occupancy.get(key);
  if (existingId !== undefined && existingId !== char.id) {
    const victim = characters.find((c) => c.id === existingId);
    if (victim) startDeath(victim);
  }

  char.cell = { x: cell.x, y: cell.y, z: cell.z };
  occupancy.set(key, char.id);

  const world = cellWorld(cellMapRef, cell.x, cell.y, cell.z);
  char.transform.setPosition(world.x, world.y, world.z);

  const coord = new Omosuen.Vector3D(cell.x, cell.y, cell.z);
  // cellMapRef.setEmissionColor(coord, scaledEmissionColor(char.emissionColor));
  activateCellLight(cell, char.emissionColor);

  if (cell.y === 0) {
    char.state = 'grounded';
    playAnim(char, IDLE_TAGS);
    return;
  }

  char.state = 'idle';
  char.idleRemaining =
    IDLE_MIN_MS + Math.random() * (IDLE_MAX_MS - IDLE_MIN_MS);
  playAnim(char, IDLE_TAGS);
}

function beginJump(char, targetCell) {
  char.state = 'jumping';
  char.targetCell = { x: targetCell.x, y: targetCell.y, z: targetCell.z };
  char.fromWorld = cellWorld(cellMapRef, char.cell.x, char.cell.y, char.cell.z);
  char.toWorld = cellWorld(
    cellMapRef,
    targetCell.x,
    targetCell.y,
    targetCell.z,
  );
  char.moveElapsed = 0;
  occupancy.delete(cellKey(char.cell.x, char.cell.y, char.cell.z));
  setFacingForJump(char.transform, char.cell, targetCell);
  playAnim(char, motionTags(char.spriteId), true);
}

function updateMovement(char, dt) {
  char.moveElapsed += dt;
  const duration = char.state === 'falling' ? FALL_MS : JUMP_MS;
  const t = Math.min(1, char.moveElapsed / duration);
  if (!char.fromWorld || !char.toWorld) return;

  const pos = lerp3(char.fromWorld, char.toWorld, t);
  if (char.state === 'jumping') {
    pos.y += Math.sin(t * Math.PI) * JUMP_ARC;
  }
  char.transform.setPosition(pos.x, pos.y, pos.z);

  if (t >= 1) {
    landCharacter(char, char.targetCell);
  }
}

function updateCharacter(char, dt) {
  if (char.state === 'dying') {
    char.flickerRemaining -= dt;
    char.flickerPhase += dt;
    if (char.flickerPhase >= FLICKER_INTERVAL_MS) {
      char.flickerPhase = 0;
      char.flickerVisible = !char.flickerVisible;
      setSpritesVisible(char, char.flickerVisible);
    }
    if (char.flickerRemaining <= 0) removeCharacter(char);
    return;
  }

  if (char.state === 'falling' || char.state === 'jumping') {
    updateMovement(char, dt);
    return;
  }

  if (char.state === 'grounded') return;

  if (char.state === 'idle') {
    char.idleRemaining -= dt;
    if (char.idleRemaining > 0) return;

    const neighbors = getDownNeighbors(char.cell.x, char.cell.y, char.cell.z);
    if (neighbors.length === 0) {
      char.state = 'grounded';
      playAnim(char, IDLE_TAGS);
      return;
    }
    const target = neighbors[Math.floor(Math.random() * neighbors.length)];
    beginJump(char, target);
  }
}

function registerTick() {
  if (tickRegistered) return;
  tickRegistered = true;

  Omosuen.registerMethod('nexus', TICK_METHOD, (_manager, dt) => {
    spawnTimer += dt;
    if (spawnTimer >= SPAWN_INTERVAL_MS) {
      spawnTimer -= SPAWN_INTERVAL_MS;
      spawnCharacter().catch((err) => {
        console.error('[hero-characters] spawn failed:', err);
      });
    }

    for (let i = characters.length - 1; i >= 0; i--) {
      updateCharacter(characters[i], dt);
    }
  });
}

async function spawnCharacter() {
  if (!sceneRef || !cellMapRef) return;

  const def =
    CHARACTER_SPRITES[Math.floor(Math.random() * CHARACTER_SPRITES.length)];
  const spawn = apexCell();
  const apexWorld = cellWorld(cellMapRef, spawn.x, spawn.y, spawn.z);
  const color = randomEmissionColor();

  const nexus = await Omosuen.newComponent(
    'nexus',
    { name: `Demon ${def.id} ${nextCharId}` },
    sceneRef,
  );

  const transform = await Omosuen.newComponent(
    'transform',
    {
      name: 'Root Transform',
      position: new Omosuen.Vector3D(
        apexWorld.x,
        apexWorld.y + FALL_HEIGHT,
        apexWorld.z,
      ),
      scale: new Omosuen.Vector3D(1, 1, 1),
    },
    nexus,
  );

  const visualsNexus = await Omosuen.newComponent(
    'nexus',
    { name: VISUALS_NEXUS },
    nexus,
  );

  const visualsTransform = await Omosuen.newComponent(
    'transform',
    {
      name: 'Visuals Transform',
      position: new Omosuen.Vector3D(0, 0, 0),
      scale: new Omosuen.Vector3D(SPRITE_SCALE, SPRITE_SCALE, SPRITE_SCALE),
    },
    visualsNexus,
  );

  const loader = await Omosuen.newComponent(
    'aseprite-loader',
    {
      name: def.id,
      // Shared art path: texture-maps + animation-map live on the scene root;
      // repeat spawns of the same id reuse the blueprint (no duplicate maps).
      sources: [{ filePath: ASE_BASE + def.file, id: def.id }],
      flatten: false,
      visibleOnly: true,
      anchorMode: 'bottom-center',
    },
    visualsNexus,
  );
  await loader.ready;
  applyVisualScale(visualsTransform);

  /** @type {Character} */
  const char = {
    id: nextCharId++,
    nexus,
    transform,
    spriteId: def.id,
    emissionColor: color,
    cell: { ...spawn },
    targetCell: { ...spawn },
    fromWorld: {
      x: apexWorld.x,
      y: apexWorld.y + FALL_HEIGHT,
      z: apexWorld.z,
    },
    toWorld: { ...apexWorld },
    moveElapsed: 0,
    state: 'falling',
    idleRemaining: 0,
    currentAnim: '',
    controller: null,
    flickerRemaining: 0,
    flickerPhase: 0,
    flickerVisible: true,
  };

  configureCharacterSprites(char);
  playAnim(char, motionTags(def.id), true);
  characters.push(char);
}

async function initCellLights(scene) {
  const root = await Omosuen.newComponent(
    'nexus',
    { name: 'Cell Lights' },
    scene,
  );

  const pending = [];
  forEachShellCell((x, y, z) => {
    pending.push({ x, y, z });
  });

  for (let i = 0; i < pending.length; i++) {
    const { x, y, z } = pending[i];
    const key = cellKey(x, y, z);
    const lightNexus = await Omosuen.newComponent(
      'nexus',
      { name: `Cell Light ${key}` },
      root,
    );
    const pos = cellLightPosition(x, y, z);
    await Omosuen.newComponent(
      'transform',
      {
        name: 'Light Transform',
        position: new Omosuen.Vector3D(pos.x, pos.y, pos.z),
      },
      lightNexus,
    );
    const light = await Omosuen.newComponent(
      'light',
      {
        name: 'Cell Point Light',
        lightType: 'point',
        color: new Omosuen.Vector3D(1, 1, 1),
        brightness: 0,
        radius: CELL_LIGHT_RADIUS,
        hardness: CELL_LIGHT_HARDNESS,
      },
      lightNexus,
    );
    cellLights.set(key, light);
  }
}

/**
 * @param {import('omosuen').nexus} scene
 * @param {import('omosuen').cell_map} cellMap
 * @param {{ mapSize?: number, cellSize?: number }} [options]
 */
export async function initHeroCharacters(scene, cellMap, options = {}) {
  mapSize = options.mapSize ?? 10;
  cellSize = options.cellSize ?? 32;
  sceneRef = scene;
  cellMapRef = cellMap;
  spawnTimer = SPAWN_INTERVAL_MS;
  registerTick();

  await initCellLights(scene);

  await Omosuen.newComponent(
    'nexus',
    {
      name: 'Hero Characters',
      updateOverride: TICK_METHOD,
    },
    scene,
  );
}
