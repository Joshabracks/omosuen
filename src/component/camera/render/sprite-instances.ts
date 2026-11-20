/**
 * Per-instance sprite data for the instanced sprite pass (render-sprites.ts).
 *
 * Sprites are drawn with `drawArraysInstanced`, so nothing about one sprite
 * can be a uniform. Each drawn sprite instead gets one fixed-size RECORD in an
 * RGBA32F data texture (`u_spriteInstances`), which unified.vert reads by
 * instance index and unified.frag reads for the few values it needs only on
 * some branches. Palette remaps live in a second, integer data texture
 * (`u_spritePalettes`), one slot per distinct remap, so two sprites with
 * different palettes can still share a draw call.
 *
 * This module owns the record layout, the CPU-side buffers, the draw-order
 * sort and the two textures. Leaf module (no registry imports) so the layout
 * and the sort can be unit-tested headless.
 */
import type { PackedPalette } from '../../sprite/palette';

// ---------------------------------------------------------------------------
// Record layout. unified.vert and unified.frag hard-code the same numbers.
// ---------------------------------------------------------------------------

/** Texels (RGBA32F) per sprite record. */
export const SPRITE_INSTANCE_TEXELS = 11;
/** Floats per sprite record. */
export const SPRITE_INSTANCE_FLOATS = SPRITE_INSTANCE_TEXELS * 4;
/** Width of the instance texture, in texels. Must stay a power of two. */
export const SPRITE_INSTANCE_TEX_WIDTH = 1024;

/** Float offsets of each texel within a record. */
export const SPRITE_OFFSET_POS_ROT = 0; // world x, y, z, rotation
export const SPRITE_OFFSET_SIZE_ANCHOR = 4; // size x, y, normalized anchor x, y
export const SPRITE_OFFSET_UV_ALBEDO = 8; // minU, minV, maxU, maxV
export const SPRITE_OFFSET_TINT = 12; // r, g, b, a
export const SPRITE_OFFSET_EMISSION = 16; // colour r, g, b, intensity
export const SPRITE_OFFSET_FOG = 20; // opacity, visibility, fog alpha, flags
export const SPRITE_OFFSET_IDS = 24; // sprite id, palette slot, -, -
export const SPRITE_OFFSET_UV_NORMAL = 28;
export const SPRITE_OFFSET_UV_EMISSION = 32;
export const SPRITE_OFFSET_UV_MATERIAL = 36;
export const SPRITE_OFFSET_SILHOUETTE = 40; // r, g, b, a

/**
 * Flag bits, stored (with the palette entry count shifted above them) in the
 * fog texel's fourth float. The whole value stays far below 2^24, so the
 * float carries it exactly.
 */
export const SPRITE_FLAG_FOG_MEMORY = 1;
export const SPRITE_FLAG_NORMAL = 2;
export const SPRITE_FLAG_EMISSION = 4;
export const SPRITE_FLAG_MATERIAL = 8;
export const SPRITE_FLAG_SILHOUETTE = 16;
/** The palette entry count sits above the flag byte. */
export const SPRITE_PALETTE_COUNT_SHIFT = 8;

/** Texture units, clear of every other unit the unified program uses. */
export const UNIT_SPRITE_INSTANCES = 14;
export const UNIT_SPRITE_PALETTES = 15;

// ---------------------------------------------------------------------------
// Instance buffer
// ---------------------------------------------------------------------------

const FLOATS_PER_ROW = SPRITE_INSTANCE_TEX_WIDTH * 4;

/** Whole texture rows needed to hold `count` records (at least one). */
export function spriteInstanceRows(count: number): number {
  return Math.max(
    1,
    Math.ceil((count * SPRITE_INSTANCE_TEXELS) / SPRITE_INSTANCE_TEX_WIDTH),
  );
}

// Grown to the high-water sprite count and reused, so steady-state rendering
// allocates nothing. Always a whole number of texture rows.
let instanceData = new Float32Array(FLOATS_PER_ROW);

/**
 * The shared instance buffer, grown if needed to hold `count` records. Record
 * `i` starts at float `i * SPRITE_INSTANCE_FLOATS`. Contents are only valid
 * for the pass that wrote them.
 */
export function spriteInstanceBuffer(count: number): Float32Array {
  const rows = spriteInstanceRows(count);
  if (rows * FLOATS_PER_ROW > instanceData.length) {
    let newRows = instanceData.length / FLOATS_PER_ROW;
    while (newRows < rows) newRows *= 2;
    instanceData = new Float32Array(newRows * FLOATS_PER_ROW);
  }
  return instanceData;
}

// ---------------------------------------------------------------------------
// Draw-order sort
// ---------------------------------------------------------------------------

let orderA = new Uint32Array(256);
let orderB = new Uint32Array(256);

/**
 * Returns the indices `0..count-1` ordered by ascending `depths`, STABLY:
 * entries with equal depth keep their original relative order. That stability
 * is load-bearing -- a composited entity's layers share one depth and must
 * keep their renderOrder, and render-sprites relies on it for the phantom
 * tie-break.
 *
 * Bottom-up merge sort over an index permutation: O(n log n) whatever the
 * input order, and allocation-free once the scratch arrays have grown. The
 * returned array is module-owned scratch, valid until the next call.
 */
export function sortDrawOrder(
  depths: ArrayLike<number>,
  count: number,
): Uint32Array {
  if (orderA.length < count) {
    let size = orderA.length;
    while (size < count) size *= 2;
    orderA = new Uint32Array(size);
    orderB = new Uint32Array(size);
  }

  let sorted = true;
  for (let i = 0; i < count; i++) {
    orderA[i] = i;
    if (i > 0 && depths[i - 1] > depths[i]) sorted = false;
  }
  if (sorted) return orderA;

  let src = orderA;
  let dst = orderB;
  for (let width = 1; width < count; width *= 2) {
    for (let lo = 0; lo < count; lo += 2 * width) {
      const mid = Math.min(lo + width, count);
      const hi = Math.min(lo + 2 * width, count);
      let a = lo;
      let b = mid;
      let k = lo;
      // Take from the right run only when it is STRICTLY smaller: ties go to
      // the left run, which is what keeps the sort stable.
      while (a < mid && b < hi) {
        dst[k++] = depths[src[b]] < depths[src[a]] ? src[b++] : src[a++];
      }
      while (a < mid) dst[k++] = src[a++];
      while (b < hi) dst[k++] = src[b++];
    }
    const swap = src;
    src = dst;
    dst = swap;
  }
  return src;
}

// ---------------------------------------------------------------------------
// Palette table
// ---------------------------------------------------------------------------

/** Texels per palette slot: 12 packed `from` vectors, then 12 packed `to`. */
export const SPRITE_PALETTE_SLOT_TEXELS = 24;
/** Slots per texture row. */
export const SPRITE_PALETTE_SLOTS_PER_ROW = 64;
const PALETTE_TEX_WIDTH =
  SPRITE_PALETTE_SLOT_TEXELS * SPRITE_PALETTE_SLOTS_PER_ROW;
const UINTS_PER_SLOT = SPRITE_PALETTE_SLOT_TEXELS * 4;
const UINTS_PER_PALETTE_ROW = PALETTE_TEX_WIDTH * 4;
/** Half a slot: where its `to` entries start. */
const SLOT_TO_OFFSET = UINTS_PER_SLOT / 2;

/**
 * Slot count past which the table is emptied at the start of the next pass.
 * Slots are never freed one by one (a remap that is replaced just leaves its
 * old slot behind), so this bounds what a game that keeps minting new remaps
 * can accumulate.
 */
const PALETTE_RESET_SLOTS = 4096;

let paletteData = new Uint32Array(UINTS_PER_PALETTE_ROW);
let paletteSlots = new WeakMap<PackedPalette, number>();
let paletteCount = 0;
// Bumped whenever the table is emptied, so every camera knows its texture no
// longer matches and re-uploads from slot 0.
let paletteGeneration = 0;

/** Call once at the start of a sprite pass, before any `spritePaletteSlot`. */
export function beginSpritePalettes(): void {
  if (paletteCount > PALETTE_RESET_SLOTS) {
    paletteSlots = new WeakMap();
    paletteCount = 0;
    paletteGeneration++;
  }
}

/**
 * The table slot holding `palette`, assigning (and filling) a new one the
 * first time a given packed remap is seen. Keyed on the packed object's
 * identity, which `sprite/palette.ts` replaces whenever the remap changes.
 */
export function spritePaletteSlot(palette: PackedPalette): number {
  let slot = paletteSlots.get(palette);
  if (slot !== undefined) return slot;

  slot = paletteCount++;
  const offset = slot * UINTS_PER_SLOT;
  if (offset + UINTS_PER_SLOT > paletteData.length) {
    const grown = new Uint32Array(paletteData.length * 2);
    grown.set(paletteData);
    paletteData = grown;
  }
  paletteData.set(palette.from, offset);
  paletteData.set(palette.to, offset + SLOT_TO_OFFSET);
  paletteSlots.set(palette, slot);
  return slot;
}

/** Test hook: the table's backing store and how many slots are in use. */
export function spritePaletteTable(): { data: Uint32Array; count: number } {
  return { data: paletteData, count: paletteCount };
}

// ---------------------------------------------------------------------------
// GL
// ---------------------------------------------------------------------------

interface SpriteInstanceGL {
  instanceTex: WebGLTexture | null;
  /** Rows the instance texture is currently allocated with. */
  instanceRows: number;
  paletteTex: WebGLTexture | null;
  paletteRows: number;
  /** `paletteGeneration` this camera's texture was last uploaded against. */
  paletteGeneration: number;
  /** Slots already uploaded to this camera's texture, in that generation. */
  paletteUploaded: number;
  instanceBaseLoc: WebGLUniformLocation | null;
}

const cameraGL = new Map<number, SpriteInstanceGL>();

function makeDataTexture(
  gl: WebGL2RenderingContext,
  unit: number,
): WebGLTexture | null {
  const tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  // Float32 and integer textures are not filterable; NEAREST also keeps them
  // texture-complete. Every read is a texelFetch anyway.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

/**
 * Creates this camera's instance and palette textures (one zeroed row each)
 * and pins their samplers to their units for the program's lifetime. Called
 * from camera/init with the unified program in use.
 *
 * The pinning matters even for a scene with no sprites: an unset sampler
 * defaults to unit 0, where `u_albedoTexture` (a float sampler2D) lives, and
 * an integer sampler sharing a unit with a float one makes EVERY draw of the
 * program fail with GL_INVALID_OPERATION, cell draws included.
 */
export function initSpriteInstanceResources(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  cameraId: number,
): void {
  const instanceTex = makeDataTexture(gl, UNIT_SPRITE_INSTANCES);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA32F,
    SPRITE_INSTANCE_TEX_WIDTH,
    1,
    0,
    gl.RGBA,
    gl.FLOAT,
    new Float32Array(FLOATS_PER_ROW),
  );
  const paletteTex = makeDataTexture(gl, UNIT_SPRITE_PALETTES);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA32UI,
    PALETTE_TEX_WIDTH,
    1,
    0,
    gl.RGBA_INTEGER,
    gl.UNSIGNED_INT,
    new Uint32Array(UINTS_PER_PALETTE_ROW),
  );

  gl.uniform1i(
    gl.getUniformLocation(program, 'u_spriteInstances'),
    UNIT_SPRITE_INSTANCES,
  );
  gl.uniform1i(
    gl.getUniformLocation(program, 'u_spritePalettes'),
    UNIT_SPRITE_PALETTES,
  );

  cameraGL.set(cameraId, {
    instanceTex,
    instanceRows: 1,
    paletteTex,
    paletteRows: 1,
    // Never matches a real generation, so the first pass uploads everything.
    paletteGeneration: -1,
    paletteUploaded: 0,
    instanceBaseLoc: gl.getUniformLocation(program, 'u_instanceBase'),
  });
}

/** Drops a disposed camera's textures and cached state. */
export function clearSpriteInstanceCache(
  gl: WebGL2RenderingContext | null,
  cameraId: number,
): void {
  const state = cameraGL.get(cameraId);
  if (state && gl) {
    if (state.instanceTex) gl.deleteTexture(state.instanceTex);
    if (state.paletteTex) gl.deleteTexture(state.paletteTex);
  }
  cameraGL.delete(cameraId);
}

/**
 * Uploads the first `count` records of the shared instance buffer and any
 * palette slots this camera has not seen yet, leaving both textures bound on
 * their units. Returns the `u_instanceBase` location, or null when the camera
 * was never initialised (nothing can be drawn).
 */
export function uploadSpriteInstances(
  gl: WebGL2RenderingContext,
  cameraId: number,
  count: number,
): { instanceBaseLoc: WebGLUniformLocation | null } | null {
  const state = cameraGL.get(cameraId);
  if (!state) return null;

  // Instances: every pass rewrites the rows in use.
  const rows = spriteInstanceRows(count);
  gl.activeTexture(gl.TEXTURE0 + UNIT_SPRITE_INSTANCES);
  gl.bindTexture(gl.TEXTURE_2D, state.instanceTex);
  if (rows > state.instanceRows) {
    const allocRows = instanceData.length / FLOATS_PER_ROW;
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA32F,
      SPRITE_INSTANCE_TEX_WIDTH,
      allocRows,
      0,
      gl.RGBA,
      gl.FLOAT,
      instanceData,
    );
    state.instanceRows = allocRows;
  } else {
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      SPRITE_INSTANCE_TEX_WIDTH,
      rows,
      gl.RGBA,
      gl.FLOAT,
      instanceData,
    );
  }

  // Palettes: slots are append-only within a generation, so only the rows
  // holding new slots are sent.
  gl.activeTexture(gl.TEXTURE0 + UNIT_SPRITE_PALETTES);
  gl.bindTexture(gl.TEXTURE_2D, state.paletteTex);
  if (state.paletteGeneration !== paletteGeneration) {
    state.paletteGeneration = paletteGeneration;
    state.paletteUploaded = 0;
  }
  if (state.paletteUploaded < paletteCount) {
    const allocRows = paletteData.length / UINTS_PER_PALETTE_ROW;
    if (allocRows > state.paletteRows) {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA32UI,
        PALETTE_TEX_WIDTH,
        allocRows,
        0,
        gl.RGBA_INTEGER,
        gl.UNSIGNED_INT,
        paletteData,
      );
      state.paletteRows = allocRows;
    } else {
      const firstRow = Math.floor(
        state.paletteUploaded / SPRITE_PALETTE_SLOTS_PER_ROW,
      );
      const endRow = Math.ceil(paletteCount / SPRITE_PALETTE_SLOTS_PER_ROW);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        firstRow,
        PALETTE_TEX_WIDTH,
        endRow - firstRow,
        gl.RGBA_INTEGER,
        gl.UNSIGNED_INT,
        paletteData,
        firstRow * UINTS_PER_PALETTE_ROW,
      );
    }
    state.paletteUploaded = paletteCount;
  }

  return state;
}
