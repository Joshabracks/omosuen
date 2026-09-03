/**
 * Which Y layer each screen pixel's cell sits on.
 *
 * Flat-on, none of this is visible — the camera looks straight down and world Y
 * drops out of the projection entirely. It exists for the pause view, which
 * tilts the camera over and reveals that the screen was never flat: the maze
 * separates into three sheets, the HUD panels float above it with their labels
 * standing proud of their boards, "A-TYPE" climbs a staircase, and the
 * playfield is scattered across ten layers.
 *
 * The map is per-pixel and STATIC. A pixel's layer is a property of the region
 * it sits in, not of what happens to be drawn there, so the falling piece, the
 * score digits and the game-over curtain all simply inherit the layer of
 * whatever they are drawn on top of. Nothing here re-runs while the game plays.
 *
 * Panel rectangles are not hardcoded — they are recovered from the baked
 * background by flood fill, so re-baking the screen art cannot leave stale
 * coordinates behind.
 */

import { LAYOUT } from './screen-data.js';
import { PIECES, SHAPES, spawnBounds } from './game.js';
import { H, W, getBackground } from './screen.js';

/**
 * Total Y layers. The top layer is deliberately never assigned: the WASM
 * mesher treats a neighbour lookup that leaves the resident window as
 * occluding, so a cell up there would lose its top face — the only face a
 * straight-down camera can see.
 */
export const LAYERS = 15;

/** Palette indices the baked background is drawn from. */
const BLACK = 0;
const WHITE = 1;
const CYAN = 5;
const GREY = 54;

const LAYER = {
  /** Background maze, lowest to highest, as requested. */
  black: 0,
  grey: 1,
  cyan: 2,
  /** Any other background colour; there is very little of it. */
  other: 3,
  /** Panel faces, and everything drawn onto one: digits, the NEXT piece. */
  board: 4,
  /** Panel labels and the statistics artwork — raised off their board. */
  raised: 5,
  /** Playfield cells scatter across [playfield, playfield + PLAYFIELD_SPREAD). */
  playfield: 4,
};
const PLAYFIELD_SPREAD = 10;

/**
 * Where the baked "A-TYPE" label starts, matching the generator's own font run
 * (see FONT_RUNS in build-textris-screen-data.mjs). Each of its six characters
 * is lifted one layer higher than the last.
 */
const A_TYPE = { x: 24, y: 32, chars: 6 };

function seedFromColor(color) {
  if (color === BLACK) return LAYER.black;
  if (color === GREY) return LAYER.grey;
  if (color === CYAN) return LAYER.cyan;
  return LAYER.other;
}

/**
 * Connected regions of "not maze grey". The maze is one big such region (it
 * has black gaps and cyan accents running through it) and every HUD panel is
 * another, sealed off from it by the grey it sits on. Returns every region
 * except the maze itself, which is identified as the one containing (0, 0).
 */
function findPanels(background) {
  const seen = new Uint8Array(W * H);
  const panels = [];

  for (let start = 0; start < W * H; start++) {
    if (seen[start] || background[start] === GREY) continue;

    const pixels = [start];
    seen[start] = 1;
    let minX = W;
    let minY = H;
    let maxX = -1;
    let maxY = -1;

    for (let head = 0; head < pixels.length; head++) {
      const i = pixels[head];
      const x = i % W;
      const y = (i / W) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      if (x > 0 && !seen[i - 1] && background[i - 1] !== GREY) {
        seen[i - 1] = 1;
        pixels.push(i - 1);
      }
      if (x < W - 1 && !seen[i + 1] && background[i + 1] !== GREY) {
        seen[i + 1] = 1;
        pixels.push(i + 1);
      }
      if (y > 0 && !seen[i - W] && background[i - W] !== GREY) {
        seen[i - W] = 1;
        pixels.push(i - W);
      }
      if (y < H - 1 && !seen[i + W] && background[i + W] !== GREY) {
        seen[i + W] = 1;
        pixels.push(i + W);
      }
    }

    // The maze spans the whole screen; a panel never does. Anything smaller
    // than a panel is a black gap sealed inside the maze — leave those on the
    // layer their colour gave them.
    const spansScreen =
      minX === 0 && minY === 0 && maxX === W - 1 && maxY === H - 1;
    if (spansScreen || pixels.length < 200) continue;
    panels.push({ pixels, minX, minY, maxX, maxY });
  }

  return panels;
}

const contains = (panel, x, y) =>
  x >= panel.minX && x <= panel.maxX && y >= panel.minY && y <= panel.maxY;

/** Draws a piece's spawn shape into the map at `cell`-sized steps. */
function stampPiece(map, piece, originX, originY, cell, layer) {
  const box = spawnBounds(piece);
  for (const [row, col] of SHAPES[piece][0]) {
    const x0 = originX + (col - box.minC) * cell;
    const y0 = originY + (row - box.minR) * cell;
    for (let y = y0; y < y0 + cell; y++) {
      for (let x = x0; x < x0 + cell; x++) {
        if (x >= 0 && y >= 0 && x < W && y < H) map[y * W + x] = layer;
      }
    }
  }
}

/**
 * Builds the per-pixel layer map. Called once at scene creation — in
 * particular the playfield scatter is rolled here, so it stays put for the
 * whole session and the relief reads as a fixed landscape.
 */
export function buildLayerMap() {
  const background = getBackground();
  const map = new Uint8Array(W * H);
  for (let i = 0; i < map.length; i++) map[i] = seedFromColor(background[i]);

  const panels = findPanels(background);
  const playfield = LAYOUT.playfield;

  for (const panel of panels) {
    // The whole panel — face and frame alike — is the board.
    for (const i of panel.pixels) map[i] = LAYER.board;

    // Panel frames are drawn in cyan, so white inside a panel is label text:
    // TOP, SCORE, NEXT, LEVEL, LINES-, the STATISTICS banner. Lift it off the
    // board. A-TYPE instead climbs one layer per character.
    const isATypePanel = contains(panel, A_TYPE.x, A_TYPE.y);
    for (const i of panel.pixels) {
      if (background[i] !== WHITE) continue;
      if (!isATypePanel) {
        map[i] = LAYER.raised;
        continue;
      }
      const step = Math.floor(((i % W) - A_TYPE.x) / 8);
      map[i] = LAYER.raised + Math.min(Math.max(step, 0), A_TYPE.chars - 1);
    }
  }

  // The statistics mini-pieces never move, so they stand off their board with
  // the label rather than sitting on it with the tallies. Same geometry the
  // renderer uses to draw them.
  for (let piece = 0; piece < PIECES.length; piece++) {
    const row = LAYOUT.stats[piece];
    stampPiece(map, piece, row.x, row.y, LAYOUT.miniCell, LAYER.raised);
  }

  // The playfield: one random layer per 8x8 cell, so the well reads as a
  // scattered relief rather than a plane. Rolled once, here.
  for (let r = 0; r < playfield.rows; r++) {
    for (let c = 0; c < playfield.cols; c++) {
      const layer =
        LAYER.playfield + Math.floor(Math.random() * PLAYFIELD_SPREAD);
      const x0 = playfield.x + c * playfield.cell;
      const y0 = playfield.y + r * playfield.cell;
      for (let y = y0; y < y0 + playfield.cell; y++) {
        for (let x = x0; x < x0 + playfield.cell; x++) map[y * W + x] = layer;
      }
    }
  }

  return map;
}
