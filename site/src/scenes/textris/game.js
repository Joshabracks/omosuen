/**
 * Textris rules — pure state, no rendering and no engine calls.
 *
 * Everything runs on a fixed 60 Hz tick (`step` advances exactly one frame),
 * because the NES constants this follows — gravity, DAS, entry delay, the line
 * clear animation — are all counted in frames, not seconds. index.js owns the
 * accumulator that turns real elapsed time into whole ticks.
 */

export const COLS = 10;
export const ROWS = 20;

/** NES statistics order. Indices are used as piece ids throughout. */
export const PIECES = ['T', 'J', 'Z', 'O', 'S', 'L', 'I'];

/**
 * Rotation states as [row, col] offsets from the piece's rotation centre.
 * State 0 is the spawn orientation; rotating clockwise advances the index.
 * No wall kicks — a rotation that collides is simply refused, as on the NES.
 */
export const SHAPES = [
  // T
  [
    [
      [0, -1],
      [0, 0],
      [0, 1],
      [1, 0],
    ],
    [
      [-1, 0],
      [0, -1],
      [0, 0],
      [1, 0],
    ],
    [
      [-1, 0],
      [0, -1],
      [0, 0],
      [0, 1],
    ],
    [
      [-1, 0],
      [0, 0],
      [0, 1],
      [1, 0],
    ],
  ],
  // J
  [
    [
      [0, -1],
      [0, 0],
      [0, 1],
      [1, 1],
    ],
    [
      [-1, 0],
      [0, 0],
      [1, -1],
      [1, 0],
    ],
    [
      [-1, -1],
      [0, -1],
      [0, 0],
      [0, 1],
    ],
    [
      [-1, 0],
      [-1, 1],
      [0, 0],
      [1, 0],
    ],
  ],
  // Z
  [
    [
      [0, -1],
      [0, 0],
      [1, 0],
      [1, 1],
    ],
    [
      [-1, 1],
      [0, 0],
      [0, 1],
      [1, 0],
    ],
  ],
  // O
  [
    [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ],
  ],
  // S
  [
    [
      [0, 0],
      [0, 1],
      [1, -1],
      [1, 0],
    ],
    [
      [-1, 0],
      [0, 0],
      [0, 1],
      [1, 1],
    ],
  ],
  // L
  [
    [
      [0, -1],
      [0, 0],
      [0, 1],
      [1, -1],
    ],
    [
      [-1, -1],
      [-1, 0],
      [0, 0],
      [1, 0],
    ],
    [
      [-1, 1],
      [0, -1],
      [0, 0],
      [0, 1],
    ],
    [
      [-1, 0],
      [0, 0],
      [1, 0],
      [1, 1],
    ],
  ],
  // I
  [
    [
      [0, -2],
      [0, -1],
      [0, 0],
      [0, 1],
    ],
    [
      [-2, 0],
      [-1, 0],
      [0, 0],
      [1, 0],
    ],
  ],
];

/** Frames per row of gravity, indexed by level; 29+ is one row per frame. */
const GRAVITY = [
  48, 43, 38, 33, 28, 23, 18, 13, 8, 6, 5, 5, 5, 4, 4, 4, 3, 3, 3,
];
function gravityFrames(level) {
  if (level < GRAVITY.length) return GRAVITY[level];
  if (level < 29) return 2;
  return 1;
}

/**
 * The only thing that scores: points for 1, 2, 3 and 4 lines cleared at once,
 * multiplied by `level + 1`. Steeply superlinear on purpose — four singles pay
 * 160 where one tetris pays 1200 — so the reward is for holding out and
 * clearing several rows together, not for clearing rows at all.
 */
const LINE_SCORES = [40, 100, 300, 1200];
/** Frames of horizontal auto-repeat: first delay, then the repeat interval. */
const DAS_DELAY = 16;
const DAS_PERIOD = 6;
/** Frames between locking a piece and the next one spawning. */
const ARE_FRAMES = 12;
/** The clear animation opens from the centre out: 5 column pairs, 4 frames each. */
const CLEAR_STEP_FRAMES = 4;
const CLEAR_STEPS = 5;
/** Game-over curtain: frames per row as it falls, then the countdown length. */
const CURTAIN_ROW_FRAMES = 4;
const GAME_OVER_SECONDS = 60;
/** A stack reaching this row starts the danger-zone music speed-up. */
export const DANGER_ROWS = 4;

/** Playfield rendering: which block art and which of the level's two colours. */
export const PIECE_HOLLOW = [true, false, false, true, false, false, true];
export const PIECE_COLOR_SLOT = [0, 0, 1, 0, 0, 1, 0];

/**
 * NES-style randomiser: one reroll when the draw repeats the previous piece,
 * which thins out back-to-back duplicates without making them impossible.
 */
function nextPiece(state) {
  let index = Math.floor(Math.random() * 8);
  if (index === 7 || index === state.previousPiece) {
    index = (Math.floor(Math.random() * 7) + state.previousPiece + 1) % 7;
  }
  state.previousPiece = index;
  return index;
}

export function createGame() {
  const state = {
    board: new Uint8Array(COLS * ROWS), // 0 = empty, else piece id + 1
    phase: 'spawning', // spawning | falling | clearing | are | curtain | gameover
    piece: 0,
    rotation: 0,
    row: 0,
    col: 0,
    next: 0,
    stats: new Uint16Array(7),
    lines: 0,
    score: 0,
    top: 0,
    level: 0,
    /** Bumped whenever anything the renderer cares about has changed. */
    dirty: true,

    frame: 0,
    gravityCounter: 0,
    dasCounter: 0,
    dasDirection: 0,
    softDropCounter: 0,
    /** Down must be released once after a spawn before it drops again. */
    softDropLocked: false,
    areCounter: 0,
    clearRows: [],
    clearCounter: 0,
    curtainRow: 0,
    curtainCounter: 0,
    gameOverCounter: 0,
    previousPiece: 0,
  };
  state.next = nextPiece(state);
  return state;
}

export function reset(state) {
  state.board.fill(0);
  state.stats.fill(0);
  state.phase = 'spawning';
  state.lines = 0;
  state.score = 0;
  state.level = 0;
  state.frame = 0;
  state.clearRows = [];
  state.curtainRow = 0;
  state.next = nextPiece(state);
  state.dirty = true;
}

/**
 * Bounding box of a piece's spawn orientation, in cells. Used wherever a piece
 * has to be laid out relative to its own extent rather than the board — the
 * NEXT box, the statistics minis, and the layer map that stands those minis
 * off their board.
 */
export function spawnBounds(piece) {
  let minR = Infinity;
  let maxR = -Infinity;
  let minC = Infinity;
  let maxC = -Infinity;
  for (const [r, c] of SHAPES[piece][0]) {
    if (r < minR) minR = r;
    if (r > maxR) maxR = r;
    if (c < minC) minC = c;
    if (c > maxC) maxC = c;
  }
  return { minR, minC, w: maxC - minC + 1, h: maxR - minR + 1 };
}

export function cellsOf(piece, rotation, row, col) {
  const shape = SHAPES[piece][rotation % SHAPES[piece].length];
  const out = [];
  for (const [dr, dc] of shape) out.push([row + dr, col + dc]);
  return out;
}

function collides(state, piece, rotation, row, col) {
  for (const [r, c] of cellsOf(piece, rotation, row, col)) {
    if (c < 0 || c >= COLS || r >= ROWS) return true;
    if (r >= 0 && state.board[r * COLS + c] !== 0) return true;
  }
  return false;
}

/** Where the piece would land if dropped straight down from here. */
export function ghostRow(state) {
  let row = state.row;
  while (!collides(state, state.piece, state.rotation, row + 1, state.col))
    row++;
  return row;
}

export function isInDangerZone(state) {
  for (let r = 0; r < DANGER_ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (state.board[r * COLS + c] !== 0) return true;
    }
  }
  return false;
}

function spawn(state, fx) {
  state.piece = state.next;
  state.next = nextPiece(state);
  state.rotation = 0;
  state.row = 0;
  state.col = 5;
  state.gravityCounter = 0;
  state.softDropCounter = 0;
  state.softDropLocked = true;
  state.stats[state.piece] = Math.min(999, state.stats[state.piece] + 1);

  if (collides(state, state.piece, state.rotation, state.row, state.col)) {
    // Topped out: the new piece has nowhere to go.
    state.phase = 'curtain';
    state.curtainRow = 0;
    state.curtainCounter = 0;
    fx.topOut();
    return;
  }
  state.phase = 'falling';
}

function lockPiece(state, fx) {
  for (const [r, c] of cellsOf(
    state.piece,
    state.rotation,
    state.row,
    state.col,
  )) {
    if (r >= 0 && r < ROWS && c >= 0 && c < COLS)
      state.board[r * COLS + c] = state.piece + 1;
  }
  fx.lock();

  const full = [];
  for (let r = 0; r < ROWS; r++) {
    let complete = true;
    for (let c = 0; c < COLS; c++) {
      if (state.board[r * COLS + c] === 0) {
        complete = false;
        break;
      }
    }
    if (complete) full.push(r);
  }

  if (full.length > 0) {
    state.clearRows = full;
    state.clearCounter = 0;
    state.phase = 'clearing';
    fx.lineClear(full.length);
  } else {
    state.areCounter = 0;
    state.phase = 'are';
  }
}

function completeClear(state, fx) {
  const cleared = state.clearRows.length;
  for (const row of state.clearRows) {
    state.board.copyWithin(COLS, 0, row * COLS);
    state.board.fill(0, 0, COLS);
  }
  state.clearRows = [];

  const beforeLevel = state.level;
  state.lines += cleared;
  state.score += LINE_SCORES[cleared - 1] * (state.level + 1);
  state.top = Math.max(state.top, state.score);
  state.level = Math.floor(state.lines / 10);
  if (state.level !== beforeLevel) fx.levelUp();

  state.areCounter = 0;
  state.phase = 'are';
}

function tryMove(state, dcol, fx) {
  if (collides(state, state.piece, state.rotation, state.row, state.col + dcol))
    return false;
  state.col += dcol;
  fx.move();
  return true;
}

function tryRotate(state, delta, fx) {
  const count = SHAPES[state.piece].length;
  const rotation = (state.rotation + delta + count) % count;
  if (rotation === state.rotation) return false;
  if (collides(state, state.piece, rotation, state.row, state.col))
    return false;
  state.rotation = rotation;
  fx.rotate();
  return true;
}

function stepFalling(state, input, fx) {
  // Horizontal movement with NES auto-shift: a fresh press moves immediately,
  // then holding repeats after DAS_DELAY at DAS_PERIOD.
  const direction =
    input.left && !input.right ? -1 : input.right && !input.left ? 1 : 0;
  if (direction === 0) {
    state.dasDirection = 0;
    state.dasCounter = 0;
  } else if (direction !== state.dasDirection) {
    state.dasDirection = direction;
    state.dasCounter = 0;
    tryMove(state, direction, fx);
  } else {
    state.dasCounter++;
    const threshold = state.dasCounter <= DAS_DELAY ? DAS_DELAY : DAS_PERIOD;
    if (state.dasCounter >= threshold) {
      state.dasCounter = 0;
      // A blocked auto-shift keeps the counter charged, so the piece slides the
      // instant the obstruction clears rather than re-arming the whole delay.
      if (!tryMove(state, direction, fx)) state.dasCounter = DAS_PERIOD;
    }
  }

  if (input.rotateCW) tryRotate(state, 1, fx);
  if (input.rotateCCW) tryRotate(state, -1, fx);

  if (!input.down) state.softDropLocked = false;

  // Soft drop overrides gravity at one row per 2 frames. It deliberately scores
  // nothing: clearing lines is the only thing that moves the score, so the
  // counter cannot be run up by holding a key.
  if (input.down && !state.softDropLocked) {
    state.softDropCounter++;
    if (state.softDropCounter >= 2) {
      state.softDropCounter = 0;
      if (
        collides(state, state.piece, state.rotation, state.row + 1, state.col)
      ) {
        lockPiece(state, fx);
        return;
      }
      state.row++;
    }
    return;
  }

  state.gravityCounter++;
  if (state.gravityCounter >= gravityFrames(state.level)) {
    state.gravityCounter = 0;
    if (
      collides(state, state.piece, state.rotation, state.row + 1, state.col)
    ) {
      lockPiece(state, fx);
    } else {
      state.row++;
    }
  }
}

/**
 * Advances exactly one 60 Hz frame.
 *
 * `input` carries held flags (`left`/`right`/`down`) and one-frame edges
 * (`rotateCW`/`rotateCCW`/`anyPress`). `fx` is the sound/side-effect sink; see
 * audio.js for the shape.
 */
export function step(state, input, fx) {
  state.frame++;

  switch (state.phase) {
    case 'spawning':
      spawn(state, fx);
      break;

    case 'falling':
      stepFalling(state, input, fx);
      break;

    case 'clearing':
      state.clearCounter++;
      if (state.clearCounter >= CLEAR_STEP_FRAMES * CLEAR_STEPS)
        completeClear(state, fx);
      break;

    case 'are':
      state.areCounter++;
      if (state.areCounter >= ARE_FRAMES) spawn(state, fx);
      break;

    case 'curtain':
      state.curtainCounter++;
      if (state.curtainCounter >= CURTAIN_ROW_FRAMES) {
        state.curtainCounter = 0;
        state.curtainRow++;
        if (state.curtainRow > ROWS) {
          state.phase = 'gameover';
          state.gameOverCounter = GAME_OVER_SECONDS * 60;
        }
      }
      break;

    case 'gameover':
      // Any keypress restarts immediately; otherwise the countdown does.
      if (input.anyPress) {
        reset(state);
        fx.restart();
        break;
      }
      state.gameOverCounter--;
      if (state.gameOverCounter <= 0) {
        reset(state);
        fx.restart();
      }
      break;

    default:
      break;
  }

  state.dirty = true;
}

/** Seconds left on the game-over countdown, as the HUD should show them. */
export function gameOverSecondsLeft(state) {
  return Math.max(0, Math.ceil(state.gameOverCounter / 60));
}

/**
 * Columns hidden so far by the clear animation, which opens from the middle
 * outward. Returns a set of column indices that should read as empty.
 */
export function clearedColumns(state) {
  const steps = Math.min(
    CLEAR_STEPS,
    Math.floor(state.clearCounter / CLEAR_STEP_FRAMES),
  );
  const columns = [];
  for (let i = 0; i < steps; i++) {
    columns.push(COLS / 2 - 1 - i, COLS / 2 + i);
  }
  return columns;
}
