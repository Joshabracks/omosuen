/**
 * Exact-RGB palette remap for sprites: a per-sprite list of entries the
 * sprite shader applies to the sampled albedo before lighting (see
 * `applyPaletteRemap` in unified.frag). Each entry matches one exact 8-bit
 * RGB colour and can recolour it, change its alpha, or both — alpha 0 turns
 * the texel off entirely (discarded: nothing drawn, nothing written to the
 * per-pixel id mask that post effects read).
 *
 * Leaf module (no registry imports) so it can be unit-tested headless.
 */

/** An 8-bit RGB triple, each channel 0-255. */
export type Rgb8 = [number, number, number];

/**
 * One swap for texels whose RGB is exactly `from`. At least one of `to` and
 * `alpha` must be given.
 *
 * - `to` replaces the RGB. Omitted = keep the texel's own RGB.
 * - `alpha` (0-255) multiplies the texel's own alpha by `alpha / 255`.
 *   Omitted = alpha untouched. A result below 0.01 (alpha 0, 1 or 2 on an
 *   opaque texel) discards the texel, exactly as a transparent texel in the
 *   texture is: nothing is drawn and the sprite's id isn't written to the
 *   per-pixel id mask (so post effects such as outlines skip it). CPU
 *   `screenPick` tests the sprite's rectangle and is unaffected, as it
 *   already is for transparent texels.
 */
export interface PaletteEntry {
  from: Rgb8;
  to?: Rgb8;
  alpha?: number;
}

/**
 * Most entries one sprite can carry. The shader holds the remap in two
 * `uvec4[12]` uniform arrays (one packed entry per component), so this is
 * 12 * 4.
 */
export const MAX_PALETTE_ENTRIES = 48;

/** Number of `uvec4` slots each packed array occupies in the shader. */
export const PALETTE_UNIFORM_VECTORS = MAX_PALETTE_ENTRIES / 4;

/**
 * Bit layout of a packed entry (the shader decodes the same bits):
 *
 *   from: bits 0-23 = match colour (r<<16 | g<<8 | b)
 *         bit 24    = PALETTE_FLAG_ALPHA: apply `to`'s alpha byte
 *         bit 25    = PALETTE_FLAG_KEEP_RGB: keep the texel's RGB
 *   to:   bits 0-23 = output colour, bits 24-31 = alpha (0-255)
 */
export const PALETTE_FLAG_ALPHA = 1 << 24;
export const PALETTE_FLAG_KEEP_RGB = 1 << 25;

/** A remap packed for upload; see the bit layout above. */
export interface PackedPalette {
  /** The `paletteRemap` array this was packed from (identity cache key). */
  source: PaletteEntry[];
  from: Uint32Array;
  to: Uint32Array;
  count: number;
}

function toRgb8(value: unknown): Rgb8 | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const out: number[] = [];
  for (const c of value) {
    if (typeof c !== 'number' || !Number.isFinite(c)) return null;
    out.push(Math.max(0, Math.min(255, Math.round(c))));
  }
  return [out[0], out[1], out[2]];
}

function toByte(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(255, Math.round(value)));
}

/** Packs an 8-bit RGB triple into one 24-bit integer. */
export function packRgb8(rgb: Rgb8): number {
  return ((rgb[0] << 16) | (rgb[1] << 8) | rgb[2]) >>> 0;
}

/** Inverse of {@link packRgb8} (ignores bits above 23). */
export function unpackRgb8(packed: number): Rgb8 {
  return [(packed >>> 16) & 0xff, (packed >>> 8) & 0xff, packed & 0xff];
}

/**
 * Validates a remap list into a clean copy.
 *
 * - Channels and `alpha` are rounded and clamped to 0-255.
 * - Malformed entries are dropped: `from` must be `[r,g,b]`; `to`, when
 *   present, must be `[r,g,b]`; `alpha`, when present, must be a number; and
 *   at least one of `to` / `alpha` must be present.
 * - A repeated `from` keeps its first entry (the shader stops at the first
 *   match, so a later one could never apply anyway).
 * - Entries past {@link MAX_PALETTE_ENTRIES} are dropped.
 * - An empty, null or undefined list becomes `null` (no remap).
 *
 * Every drop is reported once per call through `warn` (console.warn by default).
 */
export function normalizePaletteRemap(
  entries: unknown,
  label = 'sprite',
  warn: (message: string) => void = (m) => console.warn(m),
): PaletteEntry[] | null {
  if (entries === null || entries === undefined) return null;
  if (!Array.isArray(entries)) {
    warn(
      `[${label}] paletteRemap must be an array of { from, to?, alpha? }; ignored`,
    );
    return null;
  }

  const out: PaletteEntry[] = [];
  const seen = new Set<number>();
  let malformed = 0;
  let duplicate = 0;
  let overflow = 0;

  for (const e of entries) {
    const entry =
      e && typeof e === 'object'
        ? (e as { from?: unknown; to?: unknown; alpha?: unknown })
        : null;
    const from = entry ? toRgb8(entry.from) : null;
    const hasTo = !!entry && entry.to !== undefined && entry.to !== null;
    const hasAlpha =
      !!entry && entry.alpha !== undefined && entry.alpha !== null;
    const to = hasTo ? toRgb8(entry.to) : null;
    const alpha = hasAlpha ? toByte(entry.alpha) : null;
    if (
      !from ||
      (!hasTo && !hasAlpha) ||
      (hasTo && !to) ||
      (hasAlpha && alpha === null)
    ) {
      malformed++;
      continue;
    }
    const key = packRgb8(from);
    if (seen.has(key)) {
      duplicate++;
      continue;
    }
    if (out.length >= MAX_PALETTE_ENTRIES) {
      overflow++;
      continue;
    }
    seen.add(key);
    const clean: PaletteEntry = { from };
    if (to) clean.to = to;
    if (alpha !== null) clean.alpha = alpha;
    out.push(clean);
  }

  if (malformed > 0) {
    warn(
      `[${label}] paletteRemap: ${malformed} malformed entr${malformed === 1 ? 'y' : 'ies'} dropped (expected { from: [r,g,b], to?: [r,g,b], alpha?: 0-255 } with at least one of to / alpha)`,
    );
  }
  if (duplicate > 0) {
    warn(
      `[${label}] paletteRemap: ${duplicate} entr${duplicate === 1 ? 'y' : 'ies'} with a repeated 'from' colour dropped (first one wins)`,
    );
  }
  if (overflow > 0) {
    warn(
      `[${label}] paletteRemap: limit is ${MAX_PALETTE_ENTRIES} entries; ${overflow} dropped`,
    );
  }

  return out.length > 0 ? out : null;
}

/** Packs a (normalized) remap for upload to the shader's uniform arrays. */
export function packPaletteRemap(entries: PaletteEntry[]): PackedPalette {
  const from = new Uint32Array(MAX_PALETTE_ENTRIES);
  const to = new Uint32Array(MAX_PALETTE_ENTRIES);
  const count = Math.min(entries.length, MAX_PALETTE_ENTRIES);
  for (let i = 0; i < count; i++) {
    const e = entries[i];
    let f = packRgb8(e.from);
    let t = e.to ? packRgb8(e.to) : 0;
    if (!e.to) f |= PALETTE_FLAG_KEEP_RGB;
    if (e.alpha !== undefined) {
      f |= PALETTE_FLAG_ALPHA;
      t |= (e.alpha & 0xff) << 24;
    }
    from[i] = f >>> 0;
    to[i] = t >>> 0;
  }
  return { source: entries, from, to, count };
}

/** Deep copy (so a phantom or a clone never shares the caller's arrays). */
export function clonePaletteRemap(
  entries: PaletteEntry[] | null,
): PaletteEntry[] | null {
  if (!entries) return null;
  return entries.map((e) => {
    const copy: PaletteEntry = { from: [e.from[0], e.from[1], e.from[2]] };
    if (e.to) copy.to = [e.to[0], e.to[1], e.to[2]];
    if (e.alpha !== undefined) copy.alpha = e.alpha;
    return copy;
  });
}
