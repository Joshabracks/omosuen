/**
 * Normalising the many things a caller can hand an image helper into one shape.
 *
 * Shared by `channel-pack.ts` and `frame-strip.ts`. Everything funnels through
 * `resolveSource`, so the async/CORS/decode hazards live in exactly one place.
 */

/** A source reduced to something the packers can read pixels from. */
export type ResolvedSource =
  | { kind: 'constant'; value: number }
  | { kind: 'pixels'; data: Uint8ClampedArray; width: number; height: number }
  | { kind: 'image'; image: CanvasImageSource; width: number; height: number };

/**
 * Reads the pixel dimensions of a source image.
 *
 * Deliberately duplicated from atlas-manager's private `sourceDims` rather than
 * widening that module's exported surface for six lines.
 */
export function sourceDimensions(src: CanvasImageSource): {
  width: number;
  height: number;
} {
  const w = (src as { width?: unknown }).width;
  const h = (src as { height?: unknown }).height;
  return {
    width: typeof w === 'number' ? w : 0,
    height: typeof h === 'number' ? h : 0,
  };
}

/**
 * Creates a canvas for packing work.
 *
 * `willReadFrequently` opts into a CPU-backed surface — the same hint
 * atlas-manager uses for canvases it reads back. Every packing canvas is
 * read-back-heavy by definition, so it is on by default here.
 */
export function createPackCanvas(
  width: number,
  height: number,
  willReadFrequently = true,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d', { willReadFrequently });
  return canvas;
}

/** Fetches a 2D context, throwing rather than returning null. */
export function get2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('[texture-map] Could not acquire a 2D context');
  // Canvas 2D has no NEAREST mode; this is the switch. Mandatory for pixel art,
  // and non-negotiable for a quantised mask — a bilinear-resampled band
  // boundary produces intermediate values that belong to no region.
  ctx.imageSmoothingEnabled = false;
  return ctx;
}

/**
 * Whether a URL will taint a canvas unless the image is fetched with CORS.
 *
 * Deliberately conservative: `data:` and `blob:` never taint, and anything we
 * cannot parse is treated as same-origin. Setting `crossOrigin` where it is not
 * needed is not free — under `file://` it can break loads that would otherwise
 * succeed, and the test harness runs from `file://` in places.
 */
function isCrossOrigin(url: string): boolean {
  if (/^(data|blob):/i.test(url)) return false;
  if (typeof location === 'undefined') return false;
  try {
    return new URL(url, location.href).origin !== location.origin;
  } catch {
    return false;
  }
}

/** Loads a URL into a decoded `HTMLImageElement`. */
async function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  // MUST be set before `src`; assigning it afterwards is a no-op.
  if (isCrossOrigin(url)) img.crossOrigin = 'anonymous';
  img.src = url;
  try {
    await img.decode();
  } catch {
    // decode() rejects on a load failure, but its message never names the URL.
    throw new Error(`[texture-map] Failed to load image: ${url}`);
  }
  return img;
}

/**
 * Reduces any accepted source to a `ResolvedSource`.
 *
 * Note the `Blob` path uses `createImageBitmap` with colour conversion off.
 * `HTMLImageElement` has no such control, so an ICC-tagged PNG can shift by a
 * few least-significant bits on decode. That is invisible for metallic and
 * roughness and **fatal for a quantised mask**, which is why masks should
 * either come through a Blob/ImageBitmap or carry a `quantize` setting.
 */
export async function resolveSource(
  source: unknown,
  label = 'source',
): Promise<ResolvedSource> {
  if (typeof source === 'number') {
    return { kind: 'constant', value: source };
  }

  if (typeof source === 'string') {
    const img = await loadImage(source);
    const { width, height } = sourceDimensions(img);
    return { kind: 'image', image: img, width, height };
  }

  if (typeof ImageData !== 'undefined' && source instanceof ImageData) {
    return {
      kind: 'pixels',
      data: source.data,
      width: source.width,
      height: source.height,
    };
  }

  if (typeof Blob !== 'undefined' && source instanceof Blob) {
    const bitmap = await createImageBitmap(source, {
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    });
    return {
      kind: 'image',
      image: bitmap,
      width: bitmap.width,
      height: bitmap.height,
    };
  }

  if (source && typeof source === 'object') {
    const image = source as CanvasImageSource;
    const { width, height } = sourceDimensions(image);
    if (width > 0 && height > 0) return { kind: 'image', image, width, height };
    throw new Error(
      `[texture-map] ${label}: image source has no usable dimensions ` +
        `(${width}x${height})`,
    );
  }

  throw new Error(
    `[texture-map] ${label}: unsupported source type '${typeof source}'. ` +
      'Expected a number, URL string, Blob, ImageData, canvas or ImageBitmap.',
  );
}

/**
 * Reads pixels out of a canvas, turning the tainted-canvas failure into
 * something actionable. The raw DOM `SecurityError` names neither the image nor
 * the remedy.
 */
export function readPixels(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  label: string,
): Uint8ClampedArray {
  try {
    return ctx.getImageData(0, 0, width, height).data;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'SecurityError') {
      throw new Error(
        `[texture-map] ${label}: cannot read pixels because the canvas was ` +
          'tainted by a cross-origin image. Serve the image with an ' +
          "'Access-Control-Allow-Origin' header, or load it from the same origin.",
      );
    }
    throw e;
  }
}
