/**
 * Draws a game state into the framebuffer. Reads game state, writes pixels,
 * knows nothing about the engine.
 *
 * Every frame repaints the whole screen: `clearToBackground` restores the
 * baked static art and the dynamic layers go back on top. That costs a memcpy
 * plus a few thousand pixel writes, and screen.js's diff means only what
 * actually moved reaches the GPU.
 */

import {
  BLOCK_HOLLOW,
  BLOCK_SOLID,
  CURTAIN,
  LAYOUT,
  LEVEL_COLORS,
  MINI_HOLLOW,
  MINI_SOLID,
} from './screen-data.js';
import {
  COLS,
  PIECES,
  PIECE_COLOR_SLOT,
  PIECE_HOLLOW,
  ROWS,
  SHAPES,
  cellsOf,
  clearedColumns,
  gameOverSecondsLeft,
  spawnBounds,
} from './game.js';
import {
  blitMask,
  clearToBackground,
  drawNumber,
  drawText,
  fillRect,
} from './screen.js';

const WHITE = 1;
const BLACK = 0;
/** The statistics tallies are the one red text on screen. */
const STAT_RED = 28;

const CELL = LAYOUT.playfield.cell;
const MINI = LAYOUT.miniCell;

/** Reused per blit so drawing a full board does not allocate. */
const slots = [0, WHITE, 0, 0];

function levelColors(level) {
  return LEVEL_COLORS[level % LEVEL_COLORS.length];
}

function drawBlock(piece, x, y, colors) {
  slots[2] = colors[PIECE_COLOR_SLOT[piece]];
  blitMask(PIECE_HOLLOW[piece] ? BLOCK_HOLLOW : BLOCK_SOLID, 8, 8, x, y, slots);
}

function drawMini(piece, x, y, colors) {
  slots[2] = colors[PIECE_COLOR_SLOT[piece]];
  blitMask(
    PIECE_HOLLOW[piece] ? MINI_HOLLOW : MINI_SOLID,
    MINI,
    MINI,
    x,
    y,
    slots,
  );
}

function drawPlayfield(state, colors) {
  const { x: ox, y: oy } = LAYOUT.playfield;

  // Rows mid-clear are drawn with the animation's opened columns knocked out.
  const clearing = state.phase === 'clearing';
  const opened = clearing ? clearedColumns(state) : null;

  for (let r = 0; r < ROWS; r++) {
    const rowClearing = clearing && state.clearRows.includes(r);
    for (let c = 0; c < COLS; c++) {
      const value = state.board[r * COLS + c];
      if (value === 0) continue;
      if (rowClearing && opened.includes(c)) continue;
      drawBlock(value - 1, ox + c * CELL, oy + r * CELL, colors);
    }
  }

  if (state.phase !== 'falling') return;
  for (const [r, c] of cellsOf(
    state.piece,
    state.rotation,
    state.row,
    state.col,
  )) {
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue;
    drawBlock(state.piece, ox + c * CELL, oy + r * CELL, colors);
  }
}

function drawNext(state, colors) {
  const { cx, cy } = LAYOUT.next;
  const box = spawnBounds(state.next);
  const x = cx - box.w * (CELL / 2);
  const y = cy - box.h * (CELL / 2);
  for (const [r, c] of SHAPES[state.next][0]) {
    drawBlock(
      state.next,
      x + (c - box.minC) * CELL,
      y + (r - box.minR) * CELL,
      colors,
    );
  }
}

function drawStats(state, colors) {
  for (let piece = 0; piece < PIECES.length; piece++) {
    const row = LAYOUT.stats[piece];
    const box = spawnBounds(piece);
    for (const [r, c] of SHAPES[piece][0]) {
      drawMini(
        piece,
        row.x + (c - box.minC) * MINI,
        row.y + (r - box.minR) * MINI,
        colors,
      );
    }
    drawNumber(state.stats[piece], 3, row.countX, row.countY, STAT_RED);
  }
}

function drawCurtain(state, colors) {
  const { x: ox, y: oy } = LAYOUT.playfield;
  slots[2] = colors[0];
  slots[3] = colors[1];
  const rows = Math.min(ROWS, state.curtainRow);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < COLS; c++) {
      blitMask(CURTAIN, 8, 8, ox + c * CELL, oy + r * CELL, slots);
    }
  }
  slots[3] = 0;
}

function drawGameOverPanel(state) {
  const { x: ox, y: oy } = LAYOUT.playfield;
  const w = COLS * CELL;
  const x = ox;
  const y = oy + 48;
  const h = 48;

  fillRect(x, y, w, h, BLACK);
  fillRect(x, y, w, 2, WHITE);
  fillRect(x, y + h - 2, w, 2, WHITE);
  fillRect(x, y, 2, h, WHITE);
  fillRect(x + w - 2, y, 2, h, WHITE);

  drawText('GAME OVER', x + 4, y + 12, WHITE);
  drawNumber(gameOverSecondsLeft(state), 2, x + (w - 16) / 2, y + 28, STAT_RED);
}

export function render(state) {
  const colors = levelColors(state.level);

  clearToBackground();

  if (state.phase === 'curtain' || state.phase === 'gameover') {
    drawCurtain(state, colors);
    if (state.phase === 'gameover') drawGameOverPanel(state);
  } else {
    drawPlayfield(state, colors);
    drawNext(state, colors);
  }

  drawStats(state, colors);
  drawNumber(
    state.lines,
    LAYOUT.lines.digits,
    LAYOUT.lines.x,
    LAYOUT.lines.y,
    WHITE,
  );
  drawNumber(state.top, LAYOUT.top.digits, LAYOUT.top.x, LAYOUT.top.y, WHITE);
  drawNumber(
    state.score,
    LAYOUT.score.digits,
    LAYOUT.score.x,
    LAYOUT.score.y,
    WHITE,
  );
  drawNumber(
    state.level,
    LAYOUT.level.digits,
    LAYOUT.level.x,
    LAYOUT.level.y,
    WHITE,
  );
}
