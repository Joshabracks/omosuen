import type { Material } from '../../cell-map/types';
import type { TextureMapT } from '../../texture-map';

/**
 * Cheap, precomputed representative flat RGB color per material, for the
 * "far"/"near" terrain-memory LOD tiers. This is NOT the real-time lit
 * appearance — it's a single average color standing in for "what does this
 * material look like at a glance", computed once and cached.
 *
 * ## Where the real pixel data lives
 *
 * A `TextureMapT` (see `src/component/texture-map/data.ts`) has an OPTIONAL
 * `sourceImage` field, populated only by procedural producers (e.g. the
 * Aseprite importer) that composite frames into a canvas at runtime. For the
 * common case — a texture map loaded the normal way via `filePath` — the
 * texture-map component's `sourceImage` field is NEVER populated.
 * `atlas-manager/methods.ts`'s `resolveSource()` loads `filePath` into an
 * `HTMLImageElement` and caches it in `atlasManager.imageCache` (a
 * `Map<string, CanvasImageSource>` keyed by `filePath`) — it does NOT write
 * the loaded image back onto the texture-map component. So for a typical
 * `filePath`-loaded material, the only place a decoded image lives is
 * `atlasManager.imageCache`.
 *
 * The compiled atlas (`atlasManager.atlases`) is NOT a safe alternative: in
 * "release" retain mode the CPU-side atlas `ImageData` is intentionally
 * dropped after GPU upload to save memory (see `atlasManager.config.retainAtlas`
 * and the `am.atlases = []` drop sites in `atlas-manager/methods.ts`), so
 * reading pixels back from it can silently stop working depending on scene
 * config. `atlasManager.imageCache`, by contrast, is only ever cleared by an
 * explicit `dispose`/`clear` call on the atlas manager — it survives the
 * release-mode atlas drop regardless of `retainAtlas`, making it the reliable
 * source.
 *
 * Because the caller-supplied `textureMapCache` (`Map<string, TextureMapT>`,
 * e.g. `atlasManager.textureMapsByKey`) alone cannot resolve pixels for a
 * `filePath`-loaded texture map, this module accepts an OPTIONAL third
 * `imageCache` parameter — pass `atlasManager.imageCache` for reliable
 * results. Without it, only texture maps with an explicit `sourceImage` (e.g.
 * Aseprite-imported ones) resolve to a real color; everything else falls back
 * to the neutral gray below. This keeps the 2-argument call shape from the
 * spec working unchanged while allowing a caller with atlas-manager access to
 * opt into full reliability.
 */

/** Neutral fallback color used whenever real pixel data can't be resolved. */
const FALLBACK_COLOR: [number, number, number] = [0.5, 0.5, 0.5];

/** Maximum number of materials representable in the memory-LOD color table uniform. */
export const MAX_MEMORY_MATERIALS = 64;

const colorCache = new WeakMap<Material, [number, number, number]>();

/** Lazily-created 1x1 offscreen canvas context reused across lookups (the
 * context itself keeps its owning canvas alive, so no separate reference to
 * the canvas element is needed). */
let sampleCtx: CanvasRenderingContext2D | null = null;
let triedCreateCanvas = false;

function getSampleContext(): CanvasRenderingContext2D | null {
  if (sampleCtx) return sampleCtx;
  if (triedCreateCanvas) return null;
  triedCreateCanvas = true;

  if (typeof document === 'undefined') return null;

  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    sampleCtx = ctx;
    return ctx;
  } catch {
    return null;
  }
}

/**
 * Resolves a `CanvasImageSource` for a texture map: its own `sourceImage`
 * (procedural producers) takes precedence, falling back to `imageCache`
 * (keyed by `filePath` — pass `atlasManager.imageCache`) for the common
 * `filePath`-loaded case. Returns `null` if neither is available.
 */
function resolveImageSource(
  tm: TextureMapT,
  imageCache?: Map<string, CanvasImageSource>,
): CanvasImageSource | null {
  if (tm.sourceImage) return tm.sourceImage;
  const cached = imageCache?.get(tm.filePath);
  return cached ?? null;
}

/**
 * Averages a frame's pixels down to a single RGB color by drawing its source
 * rect scaled into a 1x1 canvas (letting the browser's own image
 * downsampling compute the average) and reading back the resulting pixel.
 * Returns `null` on any failure (canvas unavailable, exception during
 * draw/read).
 */
function sampleAverageColor(
  source: CanvasImageSource,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
): [number, number, number] | null {
  if (sw <= 0 || sh <= 0) return null;

  const ctx = getSampleContext();
  if (!ctx) return null;

  try {
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, 1, 1);
    const data = ctx.getImageData(0, 0, 1, 1).data;
    return [data[0] / 255, data[1] / 255, data[2] / 255];
  } catch {
    return null;
  }
}

/**
 * Returns a cheap, cached, representative flat RGB color (0-1 range) for a
 * material's albedo texture+frame. Never throws — falls back to a neutral
 * gray `[0.5, 0.5, 0.5]` whenever real pixel data can't be resolved (texture
 * map not found, no image source available, frame out of range, canvas/context
 * unavailable, or any exception during draw/read).
 *
 * Cached in a `WeakMap` keyed by the material object itself — materials are
 * stable object references once created and rarely (if ever) change, so no
 * invalidation is needed.
 *
 * @param material - Material to compute a representative color for.
 * @param textureMapCache - Lookup from `textureMapKey` to `TextureMapT`, e.g. `atlasManager.textureMapsByKey`.
 * @param imageCache - Optional lookup from `filePath` to a decoded `CanvasImageSource`, e.g. `atlasManager.imageCache`. Required for `filePath`-loaded texture maps (the common case) to resolve to a real color rather than the fallback — see the module doc comment above.
 */
export function getMaterialAverageColor(
  material: Material,
  textureMapCache: Map<string, TextureMapT>,
  imageCache?: Map<string, CanvasImageSource>,
): [number, number, number] {
  const cached = colorCache.get(material);
  if (cached) return cached;

  const color = computeMaterialAverageColor(
    material,
    textureMapCache,
    imageCache,
  );
  colorCache.set(material, color);
  return color;
}

function computeMaterialAverageColor(
  material: Material,
  textureMapCache: Map<string, TextureMapT>,
  imageCache?: Map<string, CanvasImageSource>,
): [number, number, number] {
  const tm = textureMapCache.get(material.albedoTextureKey);
  if (!tm) return FALLBACK_COLOR;

  const source = resolveImageSource(tm, imageCache);
  if (!source) return FALLBACK_COLOR;

  const frame = tm.originalFrames.find(
    (f) => f.frameIndex === material.albedoFrame,
  );
  if (!frame) return FALLBACK_COLOR;

  const sampled = sampleAverageColor(
    source,
    frame.position.x,
    frame.position.y,
    frame.size.x,
    frame.size.y,
  );
  return sampled ?? FALLBACK_COLOR;
}

let warnedTooManyMaterials = false;

/**
 * Builds a flat `Float32Array` of length `MAX_MEMORY_MATERIALS * 3`
 * (r, g, b per material index, zero-padded past `materials.length`) for
 * uploading as a `vec3[MAX_MEMORY_MATERIALS]` uniform array. Caps at
 * `MAX_MEMORY_MATERIALS` entries — logs a one-time `console.warn` if the
 * scene has more materials than that, rather than throwing.
 *
 * @param materials - Scene materials, indexed the same way the renderer indexes them elsewhere.
 * @param textureMapCache - Lookup from `textureMapKey` to `TextureMapT`, e.g. `atlasManager.textureMapsByKey`.
 * @param imageCache - Optional lookup from `filePath` to a decoded `CanvasImageSource`, e.g. `atlasManager.imageCache`. See `getMaterialAverageColor`.
 */
export function buildMaterialColorTable(
  materials: Material[],
  textureMapCache: Map<string, TextureMapT>,
  imageCache?: Map<string, CanvasImageSource>,
): Float32Array {
  const table = new Float32Array(MAX_MEMORY_MATERIALS * 3);

  if (materials.length > MAX_MEMORY_MATERIALS && !warnedTooManyMaterials) {
    warnedTooManyMaterials = true;
    console.warn(
      `[material-color-table] Scene has ${materials.length} materials, exceeding ` +
        `MAX_MEMORY_MATERIALS (${MAX_MEMORY_MATERIALS}). Extra materials will not ` +
        'get a memory-LOD color and will fall back to whatever the shader defaults to.',
    );
  }

  const count = Math.min(materials.length, MAX_MEMORY_MATERIALS);
  for (let i = 0; i < count; i++) {
    const [r, g, b] = getMaterialAverageColor(
      materials[i],
      textureMapCache,
      imageCache,
    );
    const base = i * 3;
    table[base] = r;
    table[base + 1] = g;
    table[base + 2] = b;
  }

  return table;
}
