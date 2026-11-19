/**
 * Channel packing — combine several single-channel (grayscale) images into the
 * RGB channels of one image.
 *
 * The renderer reads a sprite's `material` texture as `R = metallic,
 * G = roughness` (`camera/shader/unified.frag`), which means an artist would
 * otherwise have to author each map as its own file and merge them into
 * channels in external software. This removes that step.
 *
 * The file is split deliberately: `interleaveChannels` below is pure
 * `Uint8ClampedArray` math with no DOM access, so it can be unit-tested under
 * `tsx` with no browser. Everything that touches a canvas lives in the async
 * wrappers further down.
 */

import { Vector2D } from '../../math';
import {
  ResolvedSource,
  createPackCanvas,
  get2d,
  readPixels,
  resolveSource,
} from './image-source';

/** Destination channel within the packed image. */
export type PackChannel = 'r' | 'g' | 'b' | 'a';

/** Which channel of a SOURCE image supplies a destination channel. */
export type ChannelReadSource = PackChannel | 'luminance';

/**
 * Anything the packer accepts for one channel.
 *
 * A plain `number` is a constant 0..1 — no image at all. That case matters more
 * than it looks: "roughness 0.6 everywhere, metallic 0" is the commonest 2D
 * material, and without it an artist has to author two flat grayscale files to
 * say nothing.
 */
export type ChannelSource =
  | CanvasImageSource
  | ImageData
  | Blob
  | string
  | number;

/** A channel with its read/fallback behaviour spelled out. */
export interface ChannelSpec {
  source: ChannelSource;
  /** Which channel of `source` to read. Default `'r'` (grayscale convention). */
  from?: ChannelReadSource;
  /**
   * 0..1, used wherever the source is absent, fully transparent, or outside
   * its bounds. Defaults differ per channel in `packMaterial` and are
   * load-bearing — see that function.
   */
  default?: number;
  /**
   * Snap the result to N evenly-spaced levels across 0..1 inclusive. Intended
   * for region-mask indices, where a value drifting across a band boundary
   * silently reassigns a region.
   */
  quantize?: number;
}

/** How to reconcile sources that disagree about size. */
export type ChannelFit = 'error' | 'scale' | 'top-left';

export interface ChannelPackOptions {
  /** Explicit output size. Default: the agreed size of all sources. */
  size?: Vector2D;
  /** Behaviour when sources disagree on size. Default `'error'`. */
  fit?: ChannelFit;
  /**
   * Output alpha 0..1. Default 1, and lowering it is almost always a mistake —
   * see the premultiplication note on `packChannels`.
   */
  alpha?: number;
  /** Used in thrown errors and warnings to identify the offending pack. */
  label?: string;
}

/**
 * One resolved source plane, ready for `interleaveChannels`.
 *
 * `data === null` means a constant plane: there is no image, and every texel
 * takes `defaultByte`.
 */
export interface ChannelPlane {
  /** RGBA bytes, `width * height * 4`, or null for a constant plane. */
  data: Uint8ClampedArray | null;
  /** Byte offset of the channel to read, or luminance across RGB. */
  from: 0 | 1 | 2 | 3 | 'luminance';
  /** 0..255. Used for a constant plane and wherever the source is transparent. */
  defaultByte: number;
  /** Snap to N evenly-spaced levels. Undefined = no quantisation. */
  quantize?: number;
}

/** Rec. 601 luma weights — the same ones `unified.frag` uses for fog desaturation. */
const LUMA_R = 0.299;
const LUMA_G = 0.587;
const LUMA_B = 0.114;

/** Byte offset for each destination channel in an RGBA buffer. */
const CHANNEL_OFFSET: Record<PackChannel, 0 | 1 | 2 | 3> = {
  r: 0,
  g: 1,
  b: 2,
  a: 3,
};

/** Maps the public `from` name onto a byte offset (or the luminance marker). */
export function readOffset(
  from: ChannelReadSource,
): 0 | 1 | 2 | 3 | 'luminance' {
  return from === 'luminance' ? 'luminance' : CHANNEL_OFFSET[from];
}

/** Clamps 0..1 and scales to a byte. */
export function unitToByte(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.min(1, Math.max(0, value)) * 255);
}

/**
 * Snaps to `levels` evenly-spaced values across 0..255 inclusive.
 *
 * With `levels = 4` the only outputs are 0, 85, 170, 255 — so a mask authored
 * anywhere inside a band lands exactly on that band's value, and a source that
 * drifted a few LSBs during decode still resolves to the region the artist
 * meant.
 */
export function quantizeByte(byte: number, levels: number): number {
  if (!Number.isFinite(levels) || levels < 2) return byte;
  const step = levels - 1;
  return Math.round(Math.round((byte / 255) * step) * (255 / step));
}

/** Reads one texel's contribution from a plane, honouring transparency. */
function samplePlane(plane: ChannelPlane, texel: number): number {
  const data = plane.data;
  if (data === null) return plane.defaultByte;

  const base = texel * 4;
  if (base + 3 >= data.length) return plane.defaultByte;

  // A fully transparent source texel carries no authored value — its RGB is
  // whatever the compositor left behind, which for a premultiplied canvas is
  // zero. Falling back to the channel default is both more useful and what
  // keeps an unauthored roughness matte instead of mirror-finish.
  if (data[base + 3] === 0) return plane.defaultByte;

  const from = plane.from;
  if (from === 'luminance') {
    return Math.round(
      data[base] * LUMA_R + data[base + 1] * LUMA_G + data[base + 2] * LUMA_B,
    );
  }
  return data[base + from];
}

/**
 * Interleaves resolved planes into a single RGBA buffer.
 *
 * Pure: no DOM, no async, no allocation beyond the output. This is the piece
 * the headless unit test drives.
 *
 * Output alpha is written from `alpha` for every texel and is never taken from
 * a source. The shader ignores the material texture's alpha entirely, and a
 * non-opaque material image would have its RGB mangled by the atlas blit's
 * premultiplication — at alpha 0 collapsing to roughness 0, i.e. mirror
 * specular exactly where the artist meant "nothing here".
 */
export function interleaveChannels(
  planes: Partial<Record<PackChannel, ChannelPlane>>,
  width: number,
  height: number,
  alpha = 1,
): Uint8ClampedArray {
  const count = width * height;
  const out = new Uint8ClampedArray(count * 4);
  const alphaByte = unitToByte(alpha);

  const entries: { offset: number; plane: ChannelPlane }[] = [];
  for (const key of ['r', 'g', 'b'] as const) {
    const plane = planes[key];
    if (plane) entries.push({ offset: CHANNEL_OFFSET[key], plane });
  }
  const alphaPlane = planes.a;

  for (let texel = 0; texel < count; texel++) {
    const base = texel * 4;
    for (const { offset, plane } of entries) {
      const value = samplePlane(plane, texel);
      out[base + offset] =
        plane.quantize === undefined
          ? value
          : quantizeByte(value, plane.quantize);
    }
    // An explicit alpha plane overrides the flat value, for the rare caller
    // that genuinely wants a fourth data channel rather than an opaque image.
    out[base + 3] = alphaPlane ? samplePlane(alphaPlane, texel) : alphaByte;
  }

  return out;
}

// ---------------------------------------------------------------------------
// Canvas wrappers. Everything below touches the DOM; the kernel above does not.
// ---------------------------------------------------------------------------

/** Normalises the loose `source | spec` form into a full spec. */
function toSpec(entry: ChannelSource | ChannelSpec): ChannelSpec {
  if (
    entry !== null &&
    typeof entry === 'object' &&
    'source' in (entry as ChannelSpec)
  ) {
    return entry as ChannelSpec;
  }
  return { source: entry as ChannelSource };
}

type SizedSource = Exclude<ResolvedSource, { kind: 'constant' }>;

interface ResolvedEntry {
  channel: PackChannel;
  spec: ChannelSpec;
  source: ResolvedSource;
}

/** Picks the output size, or explains exactly why the sources disagree. */
function resolveOutputSize(
  resolved: ResolvedEntry[],
  options: ChannelPackOptions,
): { width: number; height: number } {
  const label = options.label ?? 'packChannels';
  if (options.size) {
    return { width: options.size.x, height: options.size.y };
  }

  const sized = resolved.filter((r) => r.source.kind !== 'constant');
  if (sized.length === 0) {
    throw new Error(
      `[texture-map] ${label}: every channel is a constant, so there is no ` +
        'size to infer. Pass an explicit `size`.',
    );
  }

  const first = sized[0].source as SizedSource;
  const mismatched = sized.filter((r) => {
    const s = r.source as SizedSource;
    return s.width !== first.width || s.height !== first.height;
  });

  if (mismatched.length === 0) {
    return { width: first.width, height: first.height };
  }

  const fit = options.fit ?? 'error';
  if (fit === 'error') {
    // A material map must register with its albedo pixel for pixel. Silently
    // resampling produces a texture that looks plausible and is misaligned —
    // which survives review and surfaces months later as "the specular is
    // subtly wrong". List every source so the mistake is obvious.
    const detail = sized
      .map((r) => {
        const s = r.source as SizedSource;
        return `${r.channel}=${s.width}x${s.height}`;
      })
      .join(', ');
    throw new Error(
      `[texture-map] ${label}: channel sources disagree on size (${detail}). ` +
        'Pass an explicit `size`, or set `fit` to "scale" or "top-left" if ' +
        'that is intended.',
    );
  }

  // Non-error fits with no explicit size: take the largest source.
  let width = 0;
  let height = 0;
  for (const r of sized) {
    const s = r.source as SizedSource;
    if (s.width * s.height > width * height) {
      width = s.width;
      height = s.height;
    }
  }
  return { width, height };
}

/** Draws a source into the output rect according to `fit`. */
function drawFitted(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  fit: ChannelFit,
): void {
  if (fit === 'scale' && (srcW !== dstW || srcH !== dstH)) {
    ctx.drawImage(image, 0, 0, srcW, srcH, 0, 0, dstW, dstH);
  } else {
    // "top-left" (and the equal-size case): place at the origin and let the
    // remainder keep the prefilled default.
    ctx.drawImage(image, 0, 0);
  }
}

/** Rasterises one resolved source into a plane of the output size. */
function planeFor(
  spec: ChannelSpec,
  source: ResolvedSource,
  width: number,
  height: number,
  fit: ChannelFit,
  scratch: HTMLCanvasElement,
  label: string,
): ChannelPlane {
  const defaultByte = unitToByte(spec.default ?? 0);
  const from = readOffset(spec.from ?? 'r');

  if (source.kind === 'constant') {
    return {
      data: null,
      from,
      defaultByte: unitToByte(source.value),
      quantize: spec.quantize,
    };
  }

  // An ImageData that already matches the output can be used as-is — no canvas
  // round-trip, and no premultiplication to undo.
  if (
    source.kind === 'pixels' &&
    source.width === width &&
    source.height === height
  ) {
    return { data: source.data, from, defaultByte, quantize: spec.quantize };
  }

  const ctx = get2d(scratch);
  ctx.clearRect(0, 0, width, height);

  // Prefill with the channel default at FULL opacity before drawing. This does
  // two jobs at once: a transparent region of the source resolves to the
  // documented default rather than to premultiplied black, and the source never
  // has to be composited against transparency.
  const d = defaultByte;
  ctx.fillStyle = `rgb(${d},${d},${d})`;
  ctx.fillRect(0, 0, width, height);

  if (source.kind === 'pixels') {
    // putImageData ignores the transform and composite state, so it cannot be
    // scaled directly — go through a temporary canvas.
    const temp = createPackCanvas(source.width, source.height);
    const tempCtx = get2d(temp);
    // Built through createImageData rather than `new ImageData(...)`: the
    // constructor's typing insists on a plain-ArrayBuffer-backed array, and
    // this avoids the cast without changing behaviour.
    const staged = tempCtx.createImageData(source.width, source.height);
    staged.data.set(source.data);
    tempCtx.putImageData(staged, 0, 0);
    drawFitted(ctx, temp, source.width, source.height, width, height, fit);
  } else {
    drawFitted(
      ctx,
      source.image,
      source.width,
      source.height,
      width,
      height,
      fit,
    );
  }

  return {
    data: readPixels(ctx, width, height, label),
    from,
    defaultByte,
    quantize: spec.quantize,
  };
}

/**
 * Packs several single-channel images into the RGB(A) channels of one canvas.
 *
 * Returns a canvas, not a blob URL: `TextureMapT.sourceImage` already accepts a
 * `CanvasImageSource` and the atlas blits straight from it, so encoding to PNG
 * and decoding back would cost time, leak an object URL unless revoked, and put
 * the pixels through premultiplication a second time for no gain.
 *
 * ```ts
 * const canvas = await packMaterial({ metallic: 0, roughness: './rough.png' });
 * newComponent('texture-map', {
 *   textureMapKey: 'hero-material',
 *   filePath: 'packed://hero/material',   // dedup key only
 *   sourceImage: canvas,
 * });
 * ```
 */
export async function packChannels(
  channels: Partial<Record<PackChannel, ChannelSource | ChannelSpec>>,
  options: ChannelPackOptions = {},
): Promise<HTMLCanvasElement> {
  const label = options.label ?? 'packChannels';
  const requested = (Object.keys(channels) as PackChannel[]).filter(
    (c) => channels[c] !== undefined,
  );

  if (requested.length === 0) {
    throw new Error(`[texture-map] ${label}: no channels supplied`);
  }

  const resolved: ResolvedEntry[] = await Promise.all(
    requested.map(async (channel) => {
      const spec = toSpec(channels[channel] as ChannelSource | ChannelSpec);
      return {
        channel,
        spec,
        source: await resolveSource(spec.source, `${label}.${channel}`),
      };
    }),
  );

  const { width, height } = resolveOutputSize(resolved, options);
  if (!(width > 0) || !(height > 0)) {
    throw new Error(
      `[texture-map] ${label}: output size is ${width}x${height}`,
    );
  }

  const fit = options.fit ?? 'error';
  const scratch = createPackCanvas(width, height);
  const planes: Partial<Record<PackChannel, ChannelPlane>> = {};
  for (const entry of resolved) {
    planes[entry.channel] = planeFor(
      entry.spec,
      entry.source,
      width,
      height,
      fit,
      scratch,
      `${label}.${entry.channel}`,
    );
  }

  const alpha = options.alpha ?? 1;
  if (alpha < 1) {
    console.warn(
      `[texture-map] ${label}: alpha below 1 will be premultiplied into the ` +
        'packed channels by the atlas blit, quantising them. The renderer ' +
        'ignores a material texture alpha, so 1 is almost always correct.',
    );
  }

  const out = createPackCanvas(width, height, false);
  const outCtx = get2d(out);
  const packed = outCtx.createImageData(width, height);
  packed.data.set(interleaveChannels(planes, width, height, alpha));
  outCtx.putImageData(packed, 0, 0);
  return out;
}

/**
 * Packs the engine's sprite material convention: `R = metallic`,
 * `G = roughness`, `B = region mask`.
 *
 * The defaults match the shader exactly — `metallic 0`, `roughness 1` (fully
 * rough). That is load-bearing: an unauthored roughness channel packed as 0 is
 * a **mirror finish**, not matte, and it is the likeliest silent mistake in
 * this whole feature.
 *
 * Quantise the mask channel for region indices, and prefer a Blob/ImageBitmap
 * source over a URL for it — only the former can disable colour-space
 * conversion on decode, and a mask value that drifts across a band boundary
 * silently reassigns a region.
 */
export async function packMaterial(
  maps: {
    metallic?: ChannelSource | ChannelSpec;
    roughness?: ChannelSource | ChannelSpec;
    mask?: ChannelSource | ChannelSpec;
  },
  options: ChannelPackOptions = {},
): Promise<HTMLCanvasElement> {
  const withDefault = (
    entry: ChannelSource | ChannelSpec | undefined,
    fallback: number,
  ): ChannelSpec => {
    const spec = entry === undefined ? { source: fallback } : toSpec(entry);
    return { ...spec, default: spec.default ?? fallback };
  };

  return packChannels(
    {
      r: withDefault(maps.metallic, 0),
      g: withDefault(maps.roughness, 1),
      b: withDefault(maps.mask, 0),
    },
    { label: 'packMaterial', ...options },
  );
}
