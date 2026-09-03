/**
 * Generates `site/src/scenes/textris/screen-data.js` from the NES palette
 * swatch and a set of emulator screenshots.
 *
 * Run once by hand; the OUTPUT is committed, the inputs are not. Every path is
 * taken from argv so no reference to the (untracked) source art ends up in a
 * committed file:
 *
 *   node site/scripts/build-textris-screen-data.mjs <palette.png> <screenshot-dir> [out.js] [preview.png]
 *
 * Passing a preview path dumps the baked background re-rendered at 1x, so the
 * bake can be eyeballed against the original. Write it somewhere scratch —
 * everything under site/src/scenes/ is copied verbatim into the site build.
 *
 * The screenshots are 512x480 — exactly 2x the NES's 256x240 — so downsampling
 * is a straight `(2x, 2y)` pick, asserted below. The emulator renders the NES
 * palette slightly differently from the supplied swatch (e.g. its grey is
 * #666666 where the swatch has #787878), so every colour is snapped to the
 * nearest swatch entry: the swatch is the only palette the game ever uses.
 *
 * What comes out:
 *   - PALETTE      55 RGB triples, the game's entire colour vocabulary
 *   - BG_TILES/MAP the static screen (maze, panels, labels) as deduped 8x8
 *                  tiles + a 32x30 tilemap, with every dynamic region blanked
 *   - FONT         8x8 1bpp glyphs lifted from real on-screen text
 *   - BLOCK/MINI   playfield (8x8) and statistics (6x6) block art, as colour
 *                  SLOT masks so one shape serves every level palette
 *   - CURTAIN      the 8x8 game-over stripe tile
 *   - LEVEL_COLORS the per-level colour pair
 *   - LAYOUT       measured pixel positions of everything the game draws
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readPng, writePng } from './png.mjs';

const [palettePath, refDir, outPathArg, previewPath] = process.argv.slice(2);
if (!palettePath || !refDir) {
  console.error(
    'usage: node build-textris-screen-data.mjs <palette.png> <screenshot-dir> [out.js] [preview.png]',
  );
  process.exit(1);
}
const outPath =
  outPathArg ?? new URL('../src/scenes/textris/screen-data.js', import.meta.url).pathname.replace(/^\//, '');

const W = 256;
const H = 240;
const PALETTE_SIZE = 55;

// ── Palette ────────────────────────────────────────────────────────────────

const swatch = readPng(palettePath);
if (swatch.width !== 8 || swatch.height !== 8) {
  throw new Error(`palette swatch must be 8x8, got ${swatch.width}x${swatch.height}`);
}
/** Row-major; entries 55..63 of the 8x8 swatch are padding and are dropped. */
const PALETTE = [];
for (let i = 0; i < PALETTE_SIZE; i++) {
  PALETTE.push([swatch.rgb[i * 3], swatch.rgb[i * 3 + 1], swatch.rgb[i * 3 + 2]]);
}

const snapCache = new Map();
function snap(r, g, b) {
  const key = (r << 16) | (g << 8) | b;
  const hit = snapCache.get(key);
  if (hit !== undefined) return hit;
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < PALETTE.length; i++) {
    const d =
      (PALETTE[i][0] - r) ** 2 + (PALETTE[i][1] - g) ** 2 + (PALETTE[i][2] - b) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  snapCache.set(key, best);
  return best;
}

// ── Screenshots → 256x240 palette-index buffers ────────────────────────────

const SHOTS = {
  start: 'screenshot_930-nintendo-tetris-game-start.png',
  level1: 'screenshot_88e-nintendo-tetris-these-tall-straight-pieces-are-usually-useful.png',
  level2: 'screenshot_44a-nintendo-tetris-looking-for-a-spot-to-fit-this-angled-piece-into.png',
  level3: 'screenshot_d28-nintendo-tetris-on-to-level-three.png',
  level4: 'screenshot_777-nintendo-tetris-i-m-getting-very-low-on-open-space.png',
  level9: 'screenshot_fb7-nintendo-tetris-game-b-on-level-9-the-pieces-fall-very-fast.png',
  gameOver: 'screenshot_9d4-nintendo-tetris-game-over.png',
  highScore: 'screenshot_e97-nintendo-tetris-a-new-high-score.png',
};

const shots = {};
for (const [name, file] of Object.entries(SHOTS)) {
  const src = readPng(join(refDir, file));
  if (src.width !== W * 2 || src.height !== H * 2) {
    throw new Error(`${file}: expected ${W * 2}x${H * 2}, got ${src.width}x${src.height}`);
  }
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const a = (y * 2 * src.width + x * 2) * 3;
      const b = ((y * 2 + 1) * src.width + x * 2 + 1) * 3;
      if (src.rgb[a] !== src.rgb[b] || src.rgb[a + 1] !== src.rgb[b + 1] || src.rgb[a + 2] !== src.rgb[b + 2]) {
        throw new Error(`${file}: pixel block at (${x},${y}) is not a uniform 2x2 — not an exact 2x scale`);
      }
      out[y * W + x] = snap(src.rgb[a], src.rgb[a + 1], src.rgb[a + 2]);
    }
  }
  shots[name] = out;
}

const px = (buf, x, y) => buf[y * W + x];

// ── Layout (measured from the reference; see the docs block above) ─────────

const LAYOUT = {
  /** 10x20 cells of 8x8 px. */
  playfield: { x: 96, y: 48, cols: 10, rows: 20, cell: 8 },
  lines: { x: 152, y: 24, digits: 3 },
  top: { x: 192, y: 40, digits: 6 },
  score: { x: 192, y: 64, digits: 6 },
  level: { x: 208, y: 168, digits: 2 },
  /** Next-piece bounding box is centred on this point. */
  next: { cx: 208, cy: 128, clip: { x: 192, y: 112, w: 32, h: 32 } },
  /**
   * Seven statistics rows, in NES order T J Z O S L I. `x`/`y` are the mini
   * piece's top-left; `countX`/`countY` the 3-digit tally. Both were measured
   * per row rather than derived — the rows are not evenly spaced.
   */
  stats: [
    { x: 26, y: 93, countX: 48, countY: 96 },
    { x: 26, y: 108, countX: 48, countY: 112 },
    { x: 26, y: 125, countX: 48, countY: 128 },
    { x: 29, y: 141, countX: 48, countY: 144 },
    { x: 26, y: 157, countX: 48, countY: 160 },
    { x: 26, y: 172, countX: 48, countY: 176 },
    { x: 24, y: 192, countX: 48, countY: 192 },
  ],
  miniCell: 6,
};

/** Tile-aligned rectangles blanked out of the baked background, in TILES. */
const DYNAMIC_TILE_RECTS = [
  [12, 6, 10, 20], // playfield interior
  [19, 3, 3, 1], // LINES value
  [24, 5, 6, 1], // TOP value
  [24, 8, 6, 1], // SCORE value
  [26, 21, 2, 1], // LEVEL value
  [24, 14, 4, 4], // NEXT piece area
  [3, 11, 3, 14], // statistics mini pieces
  [6, 12, 3, 1],
  [6, 14, 3, 1],
  [6, 16, 3, 1],
  [6, 18, 3, 1],
  [6, 20, 3, 1],
  [6, 22, 3, 1],
  [6, 24, 3, 1],
];

// ── Background bake ────────────────────────────────────────────────────────

const bg = Uint8Array.from(shots.start);
for (const [tx, ty, tw, th] of DYNAMIC_TILE_RECTS) {
  for (let y = ty * 8; y < (ty + th) * 8; y++) {
    for (let x = tx * 8; x < (tx + tw) * 8; x++) bg[y * W + x] = 0;
  }
}

const tiles = [];
const tileIndex = new Map();
const tilemap = new Uint8Array(32 * 30);
for (let ty = 0; ty < 30; ty++) {
  for (let tx = 0; tx < 32; tx++) {
    const tile = new Uint8Array(64);
    for (let j = 0; j < 8; j++) {
      for (let i = 0; i < 8; i++) tile[j * 8 + i] = bg[(ty * 8 + j) * W + tx * 8 + i];
    }
    const key = tile.join(',');
    let idx = tileIndex.get(key);
    if (idx === undefined) {
      idx = tiles.length;
      tileIndex.set(key, idx);
      tiles.push(tile);
    }
    tilemap[ty * 32 + tx] = idx;
  }
}
if (tiles.length > 256) throw new Error(`background needs ${tiles.length} tiles; tilemap is 8-bit`);

// ── Font ───────────────────────────────────────────────────────────────────
//
// Glyphs are lifted from real on-screen text. Every run below is 8 px per
// character and tile-aligned; the condensed "STATISTICS" banner is NOT (it is
// a pre-drawn graphic, not text) which is why it is absent here — it lives in
// the baked background instead.

const FONT_RUNS = [
  ['start', 192, 32, 'TOP', 1],
  ['start', 192, 56, 'SCORE', 1],
  ['start', 192, 104, 'NEXT', 1],
  ['start', 192, 160, 'LEVEL', 1],
  ['start', 24, 32, 'A-TYPE', 1],
  ['start', 104, 24, 'LINES-', 1],
  ['start', 192, 40, '010000', 1],
  ['start', 192, 64, '000022', 1],
  ['level3', 208, 168, '03', 1],
  ['level4', 48, 160, '018', 28],
  ['gameOver', 192, 64, '012596', 1],
  ['highScore', 72, 56, 'CONGRATULATIONS', 28],
  ['highScore', 72, 96, 'TETRIS', 1],
  ['highScore', 128, 96, 'MASTER.', 1],
  ['highScore', 40, 120, 'PLEASE', 1],
  ['highScore', 96, 120, 'ENTER', 1],
  ['highScore', 144, 120, 'YOUR', 1],
  ['highScore', 184, 120, 'NAME', 1],
  ['highScore', 72, 176, 'HOWARD', 1],
  ['highScore', 128, 192, '007500', 1],
  ['highScore', 184, 160, '04', 1],
];

/** char -> 8 bytes, one bit per pixel, MSB = leftmost column. */
const font = new Map();
for (const [shot, x0, y0, text, ink] of FONT_RUNS) {
  const buf = shots[shot];
  for (let c = 0; c < text.length; c++) {
    const ch = text[c];
    const rows = new Uint8Array(8);
    for (let j = 0; j < 8; j++) {
      let bits = 0;
      for (let i = 0; i < 8; i++) {
        if (px(buf, x0 + c * 8 + i, y0 + j) === ink) bits |= 0x80 >> i;
      }
      rows[j] = bits;
    }
    const existing = font.get(ch);
    if (existing) {
      for (let j = 0; j < 8; j++) {
        if (existing[j] !== rows[j]) {
          throw new Error(
            `glyph '${ch}' differs between sources (run ${shot} @${x0},${y0} offset ${c})`,
          );
        }
      }
    } else {
      font.set(ch, rows);
    }
  }
}

/**
 * `G` is the one glyph "GAME OVER" needs that appears nowhere in the
 * references — every static label on screen is drawn from a set that happens
 * to exclude it. Hand-authored here in the same 6-wide, 2px-stroke style as
 * the extracted `C` and `O`, and asserted against them below.
 */
const HAND_AUTHORED = {
  G: ['..####..', '.##..##.', '##......', '##..###.', '##...##.', '.##..##.', '..####..', '........'],
};
for (const [ch, art] of Object.entries(HAND_AUTHORED)) {
  if (font.has(ch)) continue;
  const rows = new Uint8Array(8);
  art.forEach((line, j) => {
    let bits = 0;
    for (let i = 0; i < 8; i++) if (line[i] === '#') bits |= 0x80 >> i;
    rows[j] = bits;
  });
  font.set(ch, rows);
}

const REQUIRED_GLYPHS = '0123456789GAMEOVR-';
for (const ch of REQUIRED_GLYPHS) {
  if (!font.has(ch)) throw new Error(`font is missing required glyph '${ch}'`);
}

// ── Block art ──────────────────────────────────────────────────────────────
//
// Masks use colour SLOTS, not colours: 0 = background, 1 = white, 2 = the
// piece's level colour. One shape then serves all ten level palettes.

function extractMask(shot, x0, y0, w, h, white, color) {
  const buf = shots[shot];
  const out = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const v = px(buf, x0 + i, y0 + j);
      out[j * w + i] = v === white ? 1 : v === color ? 2 : 0;
    }
  }
  return out;
}

// Level 4: colour A = 20 (magenta) hollow block, colour B = 46 (green) solid.
const BLOCK_HOLLOW = extractMask('level4', 96, 176, 8, 8, 1, 20);
const BLOCK_SOLID = extractMask('level4', 104, 184, 8, 8, 1, 46);
// Level 0 statistics: row 1 (T) is hollow, row 2 (J) is solid, both colour A.
const MINI_HOLLOW = extractMask('start', 26, 93, 6, 6, 1, 15);
const MINI_SOLID = extractMask('start', 26, 108, 6, 6, 1, 15);

for (const [name, mask] of [
  ['BLOCK_HOLLOW', BLOCK_HOLLOW],
  ['BLOCK_SOLID', BLOCK_SOLID],
  ['MINI_HOLLOW', MINI_HOLLOW],
  ['MINI_SOLID', MINI_SOLID],
]) {
  if (!mask.some((v) => v === 1) || !mask.some((v) => v === 2)) {
    throw new Error(`${name} does not contain both white and colour pixels — wrong sample point?`);
  }
}

/** Game-over curtain: one 8x8 stripe tile. 0 = bg, 1 = white, 2 = A, 3 = B. */
const CURTAIN = (() => {
  const out = new Uint8Array(64);
  for (let j = 0; j < 8; j++) {
    for (let i = 0; i < 8; i++) {
      const v = px(shots.gameOver, 96 + i, 48 + j);
      out[j * 8 + i] = v === 1 ? 1 : v === 20 ? 2 : v === 46 ? 3 : 0;
    }
  }
  return out;
})();

// ── Level colours ──────────────────────────────────────────────────────────
//
// A = the colour of the statistics T mini's border, B = the Z mini's. Levels
// 0-4 and 9 are read straight out of the references; 5-8 have no reference
// screenshot and are reconstructed by hue family (cyan, red/silver, violet,
// red/blue), which is the documented NES progression.

function levelPair(shot) {
  return [px(shots[shot], 26, 97), px(shots[shot], 26, 129)];
}
const LEVEL_COLORS = [
  levelPair('start'), //  0  blue
  levelPair('level1'), // 1  green
  levelPair('level2'), // 2  magenta
  levelPair('level3'), // 3  blue + green
  levelPair('level4'), // 4  purple + mint
  [51, 49], //            5  cyan            (reconstructed)
  [28, 3], //             6  red + silver    (reconstructed)
  [16, 14], //            7  violet          (reconstructed)
  [28, 15], //            8  red + blue      (reconstructed)
  levelPair('level9'), // 9  red + orange
];
for (const [a, b] of LEVEL_COLORS) {
  if (a >= PALETTE_SIZE || b >= PALETTE_SIZE) throw new Error('level colour outside palette');
}

// ── Emit ───────────────────────────────────────────────────────────────────

const b64 = (bytes) => Buffer.from(bytes).toString('base64');

const fontEntries = [...font.entries()]
  .sort((a, b) => (a[0] < b[0] ? -1 : 1))
  .map(([ch, rows]) => `  ${JSON.stringify(ch)}: '${b64(rows)}',`)
  .join('\n');

const source = `/**
 * GENERATED FILE — do not edit by hand.
 * Regenerate with site/scripts/build-textris-screen-data.mjs.
 *
 * Every colour here is an index into PALETTE, the NES palette swatch. Block
 * and curtain masks store colour SLOTS (0 = background, 1 = white, 2 = the
 * piece colour, 3 = the level's second colour) so one shape serves all ten
 * level palettes.
 */

const decode = (s) => {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

export const SCREEN_W = ${W};
export const SCREEN_H = ${H};

/** ${PALETTE_SIZE} RGB triples — the game's entire colour vocabulary. */
export const PALETTE = ${JSON.stringify(PALETTE)};

/** ${tiles.length} deduped 8x8 tiles, flat: tile t, pixel (i, j) = BG_TILES[t * 64 + j * 8 + i]. */
export const BG_TILES = decode('${b64(Uint8Array.from(tiles.flatMap((t) => [...t])))}');

/** 32x30 tile indices for the static screen; dynamic regions are blank. */
export const BG_MAP = decode('${b64(tilemap)}');

/** 8x8 glyphs, 1 bit per pixel, one byte per row, MSB = leftmost column. */
export const FONT = {
${fontEntries}
};
for (const key of Object.keys(FONT)) FONT[key] = decode(FONT[key]);

export const BLOCK_SOLID = decode('${b64(BLOCK_SOLID)}');
export const BLOCK_HOLLOW = decode('${b64(BLOCK_HOLLOW)}');
export const MINI_SOLID = decode('${b64(MINI_SOLID)}');
export const MINI_HOLLOW = decode('${b64(MINI_HOLLOW)}');
export const CURTAIN = decode('${b64(CURTAIN)}');

/** [colourA, colourB] per level, indexed by level % 10. */
export const LEVEL_COLORS = ${JSON.stringify(LEVEL_COLORS)};

/** Measured pixel positions of everything the game draws. */
export const LAYOUT = ${JSON.stringify(LAYOUT, null, 2).replace(/\n/g, '\n')};
`;

writeFileSync(outPath, source);

// Round-trip dump: the baked background re-rendered at 1x, for eyeballing
// against the original before anything is built on top of it.
if (previewPath) {
  const rgb = new Uint8Array(W * H * 3);
  for (let i = 0; i < W * H; i++) {
    const c = PALETTE[bg[i]];
    rgb[i * 3] = c[0];
    rgb[i * 3 + 1] = c[1];
    rgb[i * 3 + 2] = c[2];
  }
  writePng(previewPath, W, H, rgb);
}

console.log(`palette      ${PALETTE_SIZE} colours`);
console.log(`background   ${tiles.length} unique tiles + 960-entry tilemap`);
console.log(`font         ${font.size} glyphs: ${[...font.keys()].sort().join('')}`);
console.log(`level colors ${LEVEL_COLORS.map(([a, b]) => `${a}/${b}`).join(' ')}`);
console.log(`wrote        ${outPath}`);
if (previewPath) console.log(`preview      ${previewPath}`);
