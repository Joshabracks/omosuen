/**
 * The Textris framebuffer — the single chokepoint between game code and the
 * cell-map.
 *
 * The whole 256x240 NES screen is a cell-map of 256x1x240 cells, one cell per
 * pixel. Colour reaches the GPU through the per-cell EMISSION channel rather
 * than per-pixel materials: emission is a texture channel that needs no
 * remesh, so every cell can share one material and the draw loop stays at one
 * call per chunk. (Per-pixel materials would remesh a chunk on every write and
 * emit one draw call per chunk per distinct material — thousands per frame.)
 *
 * Nothing here touches `setCellData` / `setMaterial`. If a chunk ever remeshes
 * during play, something has bypassed this module.
 *
 * Drawing is double-buffered against what the GPU already holds: game code
 * paints freely into `back`, then `flush()` pushes only the pixels that
 * actually changed. `setEmissionColor` does no value diffing of its own, so
 * this diff is what keeps a still frame free.
 */

import {
  BG_MAP,
  BG_TILES,
  FONT,
  PALETTE,
  SCREEN_H,
  SCREEN_W,
} from './screen-data.js';

const Omosuen = window.Omosuen;

export const W = SCREEN_W;
export const H = SCREEN_H;

/** Palette index per pixel: what the next flush should show. */
const back = new Uint8Array(W * H);
/** Palette index per pixel: what the GPU currently shows. */
const front = new Uint8Array(W * H);
/** The baked static screen — maze, panels, labels. Restored, never mutated. */
const background = new Uint8Array(W * H);

for (let ty = 0; ty < H / 8; ty++) {
  for (let tx = 0; tx < W / 8; tx++) {
    const tile = BG_MAP[ty * (W / 8) + tx] * 64;
    for (let j = 0; j < 8; j++) {
      for (let i = 0; i < 8; i++) {
        background[(ty * 8 + j) * W + tx * 8 + i] = BG_TILES[tile + j * 8 + i];
      }
    }
  }
}
back.set(background);

let cellMap = null;
// let setEmissionColor = null;
/** Reused across every pixel write — these are read, never retained. */
const coord = new Omosuen.Vector3D(0, 0, 0);
const rgb = new Omosuen.Vector3D(0, 0, 0);

/**
 * Packed `(r<<16)|(g<<8)|b` for the whole background, to seed the cell-map's
 * `emissionColorMap` at construction. Doing it this way rather than through
 * 61,440 runtime writes keeps the first frame from hitching.
 *
 * Array3D indexes as `z * sizeY * sizeX + y * sizeX + x`; with sizeY 1 that is
 * exactly this framebuffer's own `y * W + x`, so the two can be copied flat.
 */
export function buildInitialEmissionColorMap() {
  const map = new Omosuen.Array3D(new Omosuen.Vector3D(W, 1, H), 0);
  for (let i = 0; i < back.length; i++) {
    const c = PALETTE[back[i]];
    map.value[i] = (c[0] << 16) | (c[1] << 8) | c[2];
  }
  // The GPU starts out holding exactly this, so the first flush is a no-op.
  front.set(back);
  return map;
}

export function attach(component) {
  cellMap = component;
  // Resolved once: every read of `cellMap.setEmissionColor` goes through the
  // component's method-dispatch Proxy, and this runs thousands of times a frame.
  // setEmissionColor = cellMap.setEmissionColor;
}

/** Restores the static screen under the dynamic layers. */
export function clearToBackground() {
  back.set(background);
}

export function setPixel(x, y, color) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  back[y * W + x] = color;
}

export function fillRect(x, y, w, h, color) {
  const x1 = Math.min(W, x + w);
  const y1 = Math.min(H, y + h);
  for (let py = Math.max(0, y); py < y1; py++) {
    back.fill(color, py * W + Math.max(0, x), py * W + x1);
  }
}

/**
 * Draws a colour-slot mask (see screen-data.js): 0 leaves the pixel alone,
 * other values index `colors`. `colors[n] < 0` also leaves the pixel alone,
 * which is how a slot gets switched off without a second mask.
 */
export function blitMask(mask, maskW, maskH, x, y, colors) {
  for (let j = 0; j < maskH; j++) {
    const py = y + j;
    if (py < 0 || py >= H) continue;
    for (let i = 0; i < maskW; i++) {
      const slot = mask[j * maskW + i];
      if (slot === 0) continue;
      const color = colors[slot];
      if (color === undefined || color < 0) continue;
      const pxX = x + i;
      if (pxX < 0 || pxX >= W) continue;
      back[py * W + pxX] = color;
    }
  }
}

/** Draws 8x8 glyphs. Characters with no glyph are skipped, advancing 8px. */
export function drawText(text, x, y, color) {
  for (let c = 0; c < text.length; c++) {
    const glyph = FONT[text[c]];
    if (!glyph) continue;
    const gx = x + c * 8;
    for (let j = 0; j < 8; j++) {
      const bits = glyph[j];
      if (bits === 0) continue;
      const py = y + j;
      if (py < 0 || py >= H) continue;
      for (let i = 0; i < 8; i++) {
        if (bits & (0x80 >> i)) {
          const pxX = gx + i;
          if (pxX >= 0 && pxX < W) back[py * W + pxX] = color;
        }
      }
    }
  }
}

/** Zero-padded fixed-width number, the way every NES Tetris counter reads. */
export function drawNumber(value, digits, x, y, color) {
  drawText(
    String(Math.max(0, Math.floor(value)))
      .padStart(digits, '0')
      .slice(-digits),
    x,
    y,
    color,
  );
}

/** Pushes every pixel that changed since the last flush. */
export function flush() {
  if (!cellMap.setEmissionColor) return 0;
  let written = 0;
  for (let i = 0; i < back.length; i++) {
    const value = back[i];
    if (value === front[i]) continue;
    front[i] = value;
    const c = PALETTE[value];
    coord.x = i % W;
    coord.z = (i / W) | 0;
    rgb.x = c[0] / 255;
    rgb.y = c[1] / 255;
    rgb.z = c[2] / 255;
    cellMap.setEmissionColor(coord, rgb);
    written++;
  }
  return written;
}
