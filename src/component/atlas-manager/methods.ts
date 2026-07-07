import type { ComponentData, ComponentMethods } from '../types';
import type { AtlasManagerT } from './data';
import type { TextureMapT } from '../texture-map/data';
import type { NexusT } from '../nexus/data';
import type { UnpackedFrame, PackedRegion, AtlasDirtyRegion } from './types';
import { createPackerState, packFramesInto } from './packer';
import { Vector2D } from '../../math';
import type { PackedFrame } from '../texture-map/types';
import { Nexus } from '../nexus/methods';
import { TextureMap } from '../texture-map';
import { invalidateAllTextureMapCaches } from '../camera/render/index';

export interface AtlasManagerMethods extends ComponentMethods {
  type: 'atlas-manager';

  /**
   * Initializes the AtlasManager and auto-compiles texture atlases if needed.
   * Implemented as a progressive (resumable) init: the compile yields between
   * work batches so the progressive-init scheduler can spread it across frames
   * (keeping the game loop / loading UI responsive) instead of freezing for the
   * full compile duration.
   *
   * @param component - The atlas manager component
   */
  initProgressive: (component: ComponentData) => AsyncGenerator<void>;

  /**
   * Adds a TextureMap to the processing queue.
   * Sets compiled flag to false.
   *
   * @param am - AtlasManager component
   * @param textureMap - TextureMap component to add
   */
  addTextureMap: (am: AtlasManagerT, textureMap: TextureMapT) => void;

  /**
   * Returns the canonical texture-map registered under `key`, or null.
   * Used to share one texture-map component across many entities by key.
   */
  getTextureMap: (am: AtlasManagerT, key: string) => TextureMapT | null;

  /**
   * Returns the canonical texture-map for `key`, creating and registering it via
   * `factory` on first use. Lets callers dedup shared art: the first caller builds
   * the texture-map, everyone else reuses it. The factory should create the
   * texture-map parented to a stable owner (typically `am.parent`, the scene root)
   * so it outlives any single entity.
   *
   * @param am - AtlasManager component
   * @param key - textureMapKey identity
   * @param factory - builds the texture-map component when the key is new
   */
  getOrCreateTextureMap: (
    am: AtlasManagerT,
    key: string,
    factory: () => Promise<TextureMapT | null>,
  ) => Promise<TextureMapT | null>;

  /**
   * Processes all pending texture maps and compiles atlases.
   * This is an async operation that:
   * 1. Retrieves all pending TextureMap components
   * 2. Loads source images (internal image cache)
   * 3. Extracts frame image data
   * 4. Packs frames into atlases
   * 5. Updates TextureMap.packedFrames
   * 6. Sets compiled flag to true
   *
   * @param am - AtlasManager component
   * @returns Promise that resolves when processing is complete
   */
  processTextureMaps: (am: AtlasManagerT) => Promise<void>;

  /**
   * Gets a compiled atlas texture by index.
   *
   * @param am - AtlasManager component
   * @param index - Atlas index (0-15)
   * @returns The atlas ImageData, or undefined if not compiled or invalid index
   */
  getAtlas: (am: AtlasManagerT, index: number) => ImageData | undefined;

  /**
   * Gets the number of compiled atlases.
   *
   * @param am - AtlasManager component
   * @returns Number of atlases
   */
  getAtlasCount: (am: AtlasManagerT) => number;

  /**
   * Rebuilds the CPU-side atlas ImageData (`am.atlases`) on demand. Used as the
   * safety net for release mode (where the atlases are auto-dropped after GPU
   * upload) and to back `getAtlas`. In retain mode it snapshots the live atlas
   * canvases; in release mode it re-blits from the cached source images + the
   * texture-maps' stored packed layout. Synchronous (source images are cached).
   *
   * @param am - AtlasManager component
   */
  rebuildAtlases: (am: AtlasManagerT) => void;

  /**
   * Clears all atlases and pending texture maps.
   * Sets compiled flag to false.
   *
   * @param am - AtlasManager component
   */
  clear: (am: AtlasManagerT) => void;

  /**
   * Loads an image asynchronously.
   * If the image is already loaded, returns it immediately from cache.
   * If the image is currently loading, returns the existing promise.
   * Otherwise, initiates a new load.
   * (Merged from image-registry component)
   *
   * @param am - AtlasManager component
   * @param filePath - Path to the image file
   * @returns Promise that resolves to the loaded HTMLImageElement
   */
  loadImage: (am: AtlasManagerT, filePath: string) => Promise<HTMLImageElement>;

  /**
   * Synchronously retrieves an image from the cache.
   * Returns null if the image is not loaded.
   * (Merged from image-registry component)
   *
   * @param am - AtlasManager component
   * @param filePath - Path to the image file
   * @returns The cached HTMLImageElement, or null if not found
   */
  getImage: (am: AtlasManagerT, filePath: string) => CanvasImageSource | null;

  /**
   * Checks if an image is loaded in the cache.
   * (Merged from image-registry component)
   *
   * @param am - AtlasManager component
   * @param filePath - Path to the image file
   * @returns True if the image is cached, false otherwise
   */
  hasImage: (am: AtlasManagerT, filePath: string) => boolean;

  /**
   * Checks if an image is currently being loaded.
   * (Merged from image-registry component)
   *
   * @param am - AtlasManager component
   * @param filePath - Path to the image file
   * @returns True if the image is loading, false otherwise
   */
  isLoading: (am: AtlasManagerT, filePath: string) => boolean;

  /**
   * Removes an image from the cache.
   * Useful for freeing memory when an image is no longer needed.
   * (Merged from image-registry component)
   *
   * @param am - AtlasManager component
   * @param filePath - Path to the image file
   */
  removeImage: (am: AtlasManagerT, filePath: string) => void;

  /**
   * Gets the number of cached images.
   * (Merged from image-registry component)
   *
   * @param am - AtlasManager component
   * @returns Number of images in cache
   */
  getImageCacheSize: (am: AtlasManagerT) => number;

  /**
   * Disposes of the AtlasManager.
   *
   * @param component - Component to dispose
   */
  dispose: (component: ComponentData) => void;
}

/**
 * Helper function to get the root Nexus from a component.
 */
function getRootNexus(component: ComponentData): NexusT | null {
  let current: ComponentData | null = component;

  // Climb to root
  while (current && current.parent) {
    current = current.parent;
  }

  // Root should be a Nexus
  if (current && current.type === 'nexus') {
    return current as NexusT;
  }

  return null;
}

/**
 * Helper function to get TextureMap components by IDs.
 */
function getTextureMaps(
  rootNexus: NexusT,
  textureMapIds: Set<string>,
): TextureMapT[] {
  const textureMaps: TextureMapT[] = [];

  // Get all texture-map components recursively
  const allTextureMaps = Nexus.getComponentsByType(
    rootNexus,
    'texture-map',
    true,
  ) as TextureMapT[];

  // Filter by textureMapKeys in the set
  for (const tm of allTextureMaps) {
    if (textureMapIds.has(tm.textureMapKey)) {
      textureMaps.push(tm);
    }
  }

  return textureMaps;
}

/**
 * Dedup key for a frame: same source file + same source rect ⇒ identical pixels,
 * so such frames share a single packed atlas region. Granularity matches
 * loadImage's filePath cache (distinct path strings for one file aren't merged).
 */
function frameKey(filePath: string, pos: Vector2D, size: Vector2D): string {
  return `${filePath}|${pos.x},${pos.y},${size.x},${size.y}`;
}

/**
 * Creates a blank atlas-sized 2D canvas. When `willReadFrequently` is set, the
 * 2D context is primed with that hint now (its attributes are fixed on first
 * `getContext`) — retain-mode atlases are read back per region on every delta
 * GPU upload, so they opt into the fast-readback backing; release canvases are
 * drawn once + read once and keep the default (draw-optimized) backing.
 */
function createAtlasCanvas(
  size: number,
  willReadFrequently = false,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  canvas.getContext('2d', { willReadFrequently });
  return canvas;
}

/**
 * Reads the pixel dimensions of a source image. Canvas / ImageBitmap /
 * HTMLImageElement all expose numeric width/height; anything else yields 0.
 */
function sourceDims(src: CanvasImageSource): { width: number; height: number } {
  const w = (src as { width?: unknown }).width;
  const h = (src as { height?: unknown }).height;
  return {
    width: typeof w === 'number' ? w : 0,
    height: typeof h === 'number' ? h : 0,
  };
}

/**
 * Resolves a texture-map's source image: an in-memory `sourceImage` (canvas /
 * ImageBitmap from a procedural producer like the Aseprite importer) takes
 * precedence over loading `filePath`. The in-memory source is cached under the
 * texture-map's (synthetic, unique) filePath so release-mode rebuild can re-blit
 * it without a network/Image load.
 */
async function resolveSource(
  am: AtlasManagerT,
  tm: TextureMapT,
): Promise<CanvasImageSource> {
  if (tm.sourceImage) {
    am.imageCache.set(tm.filePath, tm.sourceImage);
    return tm.sourceImage;
  }
  return AtlasManager.loadImage(am, tm.filePath);
}

/**
 * Fills in a default whole-image frame for a texture map that declared none.
 */
function ensureOriginalFrames(tm: TextureMapT, image: CanvasImageSource): void {
  if (tm.originalFrames.length === 0) {
    const { width, height } = sourceDims(image);
    tm.originalFrames = [
      {
        frameIndex: 0,
        position: new Vector2D(0, 0),
        size: new Vector2D(width, height),
      },
    ];
  }
}

/**
 * Points every texture-map frame at its (possibly shared) packed atlas region,
 * looked up by frame key. Shared by the full compile and the incremental add.
 */
function assignPackedFrames(
  textureMaps: TextureMapT[],
  regions: Map<string, PackedRegion>,
): void {
  for (const tm of textureMaps) {
    const packed: PackedFrame[] = [];
    for (const originalFrame of tm.originalFrames) {
      const key = frameKey(
        tm.filePath,
        originalFrame.position,
        originalFrame.size,
      );
      const region = regions.get(key);
      if (region) {
        packed.push({
          frameIndex: originalFrame.frameIndex,
          atlasPosition: region.atlasPosition,
          atlasIndex: region.atlasIndex,
          size: originalFrame.size,
        });
      }
    }
    TextureMap.setPackedFrames(tm, packed);
  }
}

/**
 * Compiles all pending texture maps into atlases as a resumable generator: it
 * `yield`s between work batches (after image load, after pack, every N blits,
 * between per-atlas reads) so the progressive-init scheduler can spread the
 * compile across frames. Pixels are blitted source→atlas via drawImage (no
 * per-frame ImageData extraction). Driven to completion by `processTextureMaps`
 * or sliced across frames by `initProgressive`.
 */
// Blit frames onto their atlas canvases, yielding every BUILD_BATCH draws so the
// work spreads across frames. `getContext` resolves an atlas index to its 2D ctx
// (prebuilt array in full compile, lazy accessor in incremental); `onBlit` runs
// optional per-frame bookkeeping (incremental mode records the dedup map + dirty
// regions).
const BUILD_BATCH = 512;
function* blitFramesYielding(
  frames: UnpackedFrame[],
  getContext: (atlasIndex: number) => CanvasRenderingContext2D,
  onBlit?: (frame: UnpackedFrame, index: number) => void,
): Generator<void> {
  let drawn = 0;
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    if (frame.atlasIndex === undefined || frame.atlasPosition === undefined) {
      console.error('[atlas-manager] Frame missing atlas info', frame);
      continue;
    }
    getContext(frame.atlasIndex).drawImage(
      frame.sourceImage,
      frame.sourcePosition.x,
      frame.sourcePosition.y,
      frame.size.x,
      frame.size.y,
      frame.atlasPosition.x,
      frame.atlasPosition.y,
      frame.size.x,
      frame.size.y,
    );
    onBlit?.(frame, i);
    if (++drawn % BUILD_BATCH === 0) yield;
  }
}

async function* compileSteps(am: AtlasManagerT): AsyncGenerator<void> {
  if (am.textureMapIds.size === 0) {
    console.warn('[atlas-manager] No texture maps to process');
    return;
  }

  const rootNexus = getRootNexus(am);
  if (!rootNexus) {
    throw new Error(
      '[atlas-manager] Cannot process texture maps: not attached to a scene',
    );
  }

  const textureMaps = getTextureMaps(rootNexus, am.textureMapIds);
  if (textureMaps.length === 0) {
    console.warn('[atlas-manager] No texture maps found for pending IDs');
    am.textureMapIds.clear();
    return;
  }

  // Resolve source images (in-memory sourceImage, else load filePath).
  const imageLoadPromises = textureMaps.map((tm) => resolveSource(am, tm));
  let images: CanvasImageSource[];
  try {
    images = await Promise.all(imageLoadPromises);
  } catch (error) {
    console.error('[atlas-manager] Failed to load images', error);
    throw error;
  }
  yield;

  // Build UNIQUE frames (dedup by source file + source rect). Multiple texture
  // maps that reference the same file+rect share ONE packed atlas region — common
  // when sprites each spin up their own texture-map from a shared sheet. No
  // per-frame canvas/getImageData extraction (pixels are blitted at build time).
  const uniqueFrames: UnpackedFrame[] = [];
  const keyToUnique = new Map<string, number>();
  for (let i = 0; i < textureMaps.length; i++) {
    const tm = textureMaps[i];
    const image = images[i];
    ensureOriginalFrames(tm, image);
    for (const originalFrame of tm.originalFrames) {
      const key = frameKey(
        tm.filePath,
        originalFrame.position,
        originalFrame.size,
      );
      if (!keyToUnique.has(key)) {
        keyToUnique.set(key, uniqueFrames.length);
        uniqueFrames.push({
          size: originalFrame.size,
          sourceImage: image,
          sourcePosition: originalFrame.position,
        });
      }
    }
  }
  yield;

  // Pack into a persistent packer state so retain mode can keep packing new
  // frames into the same free space on later incremental adds.
  const packState = createPackerState(
    am.config.atlasSize,
    am.config.maxAtlases,
    am.config.padding,
  );
  try {
    packFramesInto(packState, uniqueFrames);
  } catch (error) {
    console.error('[atlas-manager] Failed to pack frames', error);
    throw error;
  }
  yield;

  // Region map (frame key → packed location): used to assign texture maps and,
  // in retain mode, persisted as the dedup map for incremental adds.
  const regions = new Map<string, PackedRegion>();
  for (const [key, idx] of keyToUnique) {
    const u = uniqueFrames[idx];
    if (u.atlasIndex !== undefined && u.atlasPosition !== undefined) {
      regions.set(key, {
        atlasIndex: u.atlasIndex,
        atlasPosition: u.atlasPosition,
        size: u.size,
      });
    }
  }

  // Create the atlas canvases that are actually used.
  const canvases: HTMLCanvasElement[] = [];
  const contexts: CanvasRenderingContext2D[] = [];
  const usedAtlasIndices = new Set<number>();
  for (const frame of uniqueFrames) {
    if (frame.atlasIndex !== undefined) usedAtlasIndices.add(frame.atlasIndex);
  }
  for (const index of usedAtlasIndices) {
    const canvas = createAtlasCanvas(
      am.config.atlasSize,
      am.config.retainAtlas,
    );
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error(`Failed to get 2D context for atlas ${index}`);
    }
    canvases[index] = canvas;
    contexts[index] = ctx;
  }

  // Blit unique frames straight onto the atlas canvases (chunked + yielding).
  yield* blitFramesYielding(uniqueFrames, (idx) => contexts[idx]);

  if (am.config.retainAtlas) {
    // Retain: keep the canvases + packer state + dedup map alive so a later
    // runtime add only packs/blits the NEW frames. Cameras upload straight from
    // the canvas, so the per-atlas getImageData snapshot is skipped here.
    am.atlasCanvases = canvases;
    am.packState = packState;
    am.packedByKey = regions;
    am.atlases = [];
  } else {
    // Release: snapshot to ImageData (the upload source); the canvases + packer
    // state are not retained (they GC). am.atlases is auto-dropped after upload.
    am.atlasCanvases = [];
    am.packState = null;
    am.packedByKey = new Map();
    am.atlases = [];
    for (const index of usedAtlasIndices) {
      am.atlases[index] = contexts[index].getImageData(
        0,
        0,
        am.config.atlasSize,
        am.config.atlasSize,
      );
      yield;
    }
  }

  // Point each texture-map frame at its (possibly shared) packed region.
  assignPackedFrames(textureMaps, regions);

  // NOTE: textureMapIds is the set of ALL registered texture maps, not a
  // pending queue — it is intentionally NOT cleared here. Every (re)compile
  // re-packs the full set so the atlas stays complete when texture maps are
  // added at runtime; clearing it would drop previously-packed maps on the next
  // recompile (their sprites would then sample whatever now occupies those
  // atlas regions). compiled=true gates re-compilation until addTextureMap
  // flips it false again.
  am.compiled = true;
  am.atlasVersion++;
  // A full compile changes everything → no per-region delta to log. Cameras
  // below fullVersion full-upload; the dirty-region log starts fresh from here.
  am.fullVersion = am.atlasVersion;
  am.dirtyRegions = [];
  invalidateAllTextureMapCaches();
}

// Cap on the retained dirty-region log; on overflow the log is cleared and
// fullVersion is reset, forcing a one-time full upload for any straggler camera
// (the canvas is the source of truth, so this is always safe).
const DIRTY_REGION_CAP = 4096;

/**
 * Incremental retain-mode add: packs + blits ONLY the texture-map frames whose
 * region isn't already in `am.packedByKey`, into the retained free space and
 * canvases — no full re-pack/re-blit of previously-packed frames. Reassigns
 * every texture map's packed frames (old + new) and bumps the atlas version so
 * cameras re-upload (from the retained canvas). Falls back to a full compile if
 * there's no retained state yet.
 */
async function* incrementalSteps(am: AtlasManagerT): AsyncGenerator<void> {
  if (!am.packState) {
    yield* compileSteps(am);
    return;
  }

  const rootNexus = getRootNexus(am);
  if (!rootNexus) {
    throw new Error(
      '[atlas-manager] Cannot process texture maps: not attached to a scene',
    );
  }

  const textureMaps = getTextureMaps(rootNexus, am.textureMapIds);
  if (textureMaps.length === 0) {
    return;
  }

  // Resolve any not-yet-cached source images (in-memory sourceImage, else load).
  let images: CanvasImageSource[];
  try {
    images = await Promise.all(textureMaps.map((tm) => resolveSource(am, tm)));
  } catch (error) {
    console.error('[atlas-manager] Failed to load images', error);
    throw error;
  }
  yield;

  // Collect only the frames whose region isn't already packed (genuinely new).
  const newFrames: UnpackedFrame[] = [];
  const newKeys: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < textureMaps.length; i++) {
    const tm = textureMaps[i];
    const image = images[i];
    ensureOriginalFrames(tm, image);
    for (const originalFrame of tm.originalFrames) {
      const key = frameKey(
        tm.filePath,
        originalFrame.position,
        originalFrame.size,
      );
      if (am.packedByKey.has(key) || seen.has(key)) continue;
      seen.add(key);
      newKeys.push(key);
      newFrames.push({
        size: originalFrame.size,
        sourceImage: image,
        sourcePosition: originalFrame.position,
      });
    }
  }

  // Changed rects logged for delta GPU upload (tagged with the new version below).
  const newRegions: AtlasDirtyRegion[] = [];

  // Pack + blit ONLY the new frames into the retained free space + canvases.
  if (newFrames.length > 0) {
    try {
      packFramesInto(am.packState, newFrames);
    } catch (error) {
      console.error(
        '[atlas-manager] Failed to pack new frames (atlas full?)',
        error,
      );
      throw error;
    }
    yield;

    const ctxCache = new Map<number, CanvasRenderingContext2D>();
    const getCtx = (index: number): CanvasRenderingContext2D => {
      let ctx = ctxCache.get(index);
      if (ctx) return ctx;
      let canvas = am.atlasCanvases[index];
      if (!canvas) {
        canvas = createAtlasCanvas(am.config.atlasSize, true);
        am.atlasCanvases[index] = canvas;
      }
      const c = canvas.getContext('2d');
      if (!c) {
        throw new Error(`Failed to get 2D context for atlas ${index}`);
      }
      ctx = c;
      ctxCache.set(index, ctx);
      return ctx;
    };

    // Blit only the new frames, recording the dedup map + dirty regions per frame.
    // (version is tagged after the bump below.)
    yield* blitFramesYielding(newFrames, getCtx, (frame, i) => {
      am.packedByKey.set(newKeys[i], {
        atlasIndex: frame.atlasIndex!,
        atlasPosition: frame.atlasPosition!,
        size: frame.size,
      });
      newRegions.push({
        version: 0,
        atlasIndex: frame.atlasIndex!,
        x: frame.atlasPosition!.x,
        y: frame.atlasPosition!.y,
        w: frame.size.x,
        h: frame.size.y,
      });
    });
  }

  // Reassign every texture map from the (now-updated) dedup map (old + new).
  assignPackedFrames(textureMaps, am.packedByKey);

  am.compiled = true;
  am.atlasVersion++;

  // Tag the new regions with this version and append them to the delta log so
  // cameras upload only these rects (texSubImage2D). Overflow → clear + reset
  // fullVersion so stragglers fall back to a full upload (canvas is truth).
  for (const region of newRegions) {
    region.version = am.atlasVersion;
  }
  am.dirtyRegions.push(...newRegions);
  if (am.dirtyRegions.length > DIRTY_REGION_CAP) {
    am.dirtyRegions = [];
    am.fullVersion = am.atlasVersion;
  }

  invalidateAllTextureMapCaches();
}

export const AtlasManager: AtlasManagerMethods = {
  type: 'atlas-manager',

  initProgressive: async function* (
    component: ComponentData,
  ): AsyncGenerator<void> {
    const am = component as AtlasManagerT;

    // Auto-discover texture maps if none were explicitly registered (handles
    // deserialized scenes where the builder didn't receive the atlasManager option).
    if (am.textureMapIds.size === 0) {
      const rootNexus = getRootNexus(am);
      if (rootNexus) {
        const allTextureMaps = Nexus.getComponentsByType(
          rootNexus,
          'texture-map',
          true,
        ) as TextureMapT[];
        for (const tm of allTextureMaps) {
          am.textureMapIds.add(tm.textureMapKey);
        }
      }
    }

    // Compile (yields between batches → spread across frames by the scheduler).
    if (!am.compiled && am.textureMapIds.size > 0) {
      yield* compileSteps(am);
    }
  },

  addTextureMap: (am: AtlasManagerT, textureMap: TextureMapT): void => {
    am.textureMapIds.add(textureMap.textureMapKey);
    // Register the canonical component for this key. A second, DIFFERENT map
    // claiming an existing key with different source pixels is a developer
    // mistake (the engine resolves texture-maps globally by key) — surface it
    // loudly and keep the first registration (first-wins).
    const existing = am.textureMapsByKey.get(textureMap.textureMapKey);
    if (
      existing &&
      existing !== textureMap &&
      existing.filePath !== textureMap.filePath
    ) {
      console.error(
        `[atlas-manager] textureMapKey '${textureMap.textureMapKey}' registered with conflicting sources ` +
          `('${existing.filePath}' vs '${textureMap.filePath}'); keeping the first. ` +
          `Texture-map keys must be unique per source.`,
      );
    } else if (!existing) {
      am.textureMapsByKey.set(textureMap.textureMapKey, textureMap);
    }
    am.compiled = false;
  },

  getTextureMap: (am: AtlasManagerT, key: string): TextureMapT | null => {
    return am.textureMapsByKey.get(key) ?? null;
  },

  getOrCreateTextureMap: async (
    am: AtlasManagerT,
    key: string,
    factory: () => Promise<TextureMapT | null>,
  ): Promise<TextureMapT | null> => {
    const existing = am.textureMapsByKey.get(key);
    if (existing) return existing;
    const tm = await factory();
    if (tm) {
      // The factory-created map registers itself via addTextureMap only if it was
      // built with the `atlasManager` option; register here too so the key is
      // cached regardless of how the factory built it.
      if (!am.textureMapsByKey.has(key)) am.textureMapsByKey.set(key, tm);
    }
    return tm;
  },

  processTextureMaps: async (am: AtlasManagerT): Promise<void> => {
    // Drives the progressive compile straight to completion (no frame yielding).
    // Used by direct/manual callers; the auto-init path runs `compileSteps` via
    // `initProgressive` so the scheduler can spread it across frames.
    //
    // Retain mode with an existing compile → incremental add (pack/blit only the
    // new frames). Otherwise (release mode, or the very first retain compile) →
    // full compile.
    const gen =
      am.config.retainAtlas && am.packState
        ? incrementalSteps(am)
        : compileSteps(am);
    while (!(await gen.next()).done) {
      // run every step back-to-back
    }
  },

  getAtlas: (am: AtlasManagerT, index: number): ImageData | undefined => {
    if (index < 0 || index >= am.config.maxAtlases) {
      console.warn(
        `[atlas-manager] Invalid atlas index: ${index} (max: ${am.config.maxAtlases - 1})`,
      );
      return undefined;
    }

    // Rebuild on demand if the CPU atlas was released after GPU upload.
    if (am.atlases.length === 0 && am.compiled) {
      AtlasManager.rebuildAtlases(am);
    }

    return am.atlases[index];
  },

  rebuildAtlases: (am: AtlasManagerT): void => {
    if (!am.compiled) return;
    const size = am.config.atlasSize;

    // Retain mode: the atlas canvases are alive — just snapshot them.
    if (am.config.retainAtlas && am.atlasCanvases.length > 0) {
      const atlases: ImageData[] = [];
      for (let i = 0; i < am.atlasCanvases.length; i++) {
        const canvas = am.atlasCanvases[i];
        if (!canvas) continue;
        const ctx = canvas.getContext('2d');
        if (ctx) atlases[i] = ctx.getImageData(0, 0, size, size);
      }
      am.atlases = atlases;
      return;
    }

    // Release mode: re-blit from cached source images + the texture maps'
    // stored packed layout onto fresh canvases, then snapshot to ImageData.
    const rootNexus = getRootNexus(am);
    if (!rootNexus) return;
    const textureMaps = getTextureMaps(rootNexus, am.textureMapIds);
    const contexts: CanvasRenderingContext2D[] = [];
    const getCtx = (index: number): CanvasRenderingContext2D | null => {
      let ctx = contexts[index];
      if (ctx) return ctx;
      const c = createAtlasCanvas(size).getContext('2d');
      if (!c) return null;
      ctx = c;
      contexts[index] = ctx;
      return ctx;
    };

    for (const tm of textureMaps) {
      const image = am.imageCache.get(tm.filePath);
      if (!image) {
        console.warn(
          `[atlas-manager] Cannot rebuild atlas region for '${tm.filePath}' — source image not cached`,
        );
        continue;
      }
      for (const pf of tm.packedFrames) {
        const original = TextureMap.getOriginalFrame(tm, pf.frameIndex);
        const sx = original ? original.position.x : 0;
        const sy = original ? original.position.y : 0;
        const ctx = getCtx(pf.atlasIndex);
        if (!ctx) continue;
        ctx.drawImage(
          image,
          sx,
          sy,
          pf.size.x,
          pf.size.y,
          pf.atlasPosition.x,
          pf.atlasPosition.y,
          pf.size.x,
          pf.size.y,
        );
      }
    }

    const atlases: ImageData[] = [];
    for (let i = 0; i < contexts.length; i++) {
      if (contexts[i]) atlases[i] = contexts[i].getImageData(0, 0, size, size);
    }
    am.atlases = atlases;
  },

  getAtlasCount: (am: AtlasManagerT): number => {
    // Retain mode holds the atlases as canvases (am.atlases is left empty);
    // release mode holds them as ImageData (but may have been auto-dropped after
    // upload — fall back to the packer state's atlas count when compiled).
    if (am.config.retainAtlas) {
      return am.atlasCanvases.filter(Boolean).length;
    }
    if (am.atlases.length > 0) return am.atlases.length;
    if (am.compiled && am.packState) return am.packState.currentAtlasIndex + 1;
    return am.atlases.length;
  },

  clear: (am: AtlasManagerT): void => {
    am.textureMapIds.clear();
    am.atlases = [];
    am.compiled = false;
    am.imageCache.clear();
    am.imageLoading.clear();
    am.atlasCanvases = [];
    am.packState = null;
    am.packedByKey.clear();
    am._releaseScheduled = false;
    am.dirtyRegions = [];
    am.fullVersion = 0;
  },

  loadImage: async (
    am: AtlasManagerT,
    filePath: string,
  ): Promise<HTMLImageElement> => {
    // Check if already loaded. loadImage is only ever called for real file
    // paths (in-memory sources go through resolveSource), so any cached entry
    // here is the HTMLImageElement this function stored.
    if (am.imageCache.has(filePath)) {
      return am.imageCache.get(filePath)! as HTMLImageElement;
    }

    // Check if currently loading
    if (am.imageLoading.has(filePath)) {
      return am.imageLoading.get(filePath)!;
    }

    // Start new load
    const loadPromise = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();

      img.onload = () => {
        // Add to cache
        am.imageCache.set(filePath, img);
        // Remove from loading map
        am.imageLoading.delete(filePath);
        resolve(img);
      };

      img.onerror = (error) => {
        // Remove from loading map
        am.imageLoading.delete(filePath);
        console.error(
          `[atlas-manager] Failed to load image: ${filePath}`,
          error,
        );
        reject(new Error(`Failed to load image: ${filePath}`));
      };

      img.src = filePath;
    });

    // Store the promise to prevent duplicate loads
    am.imageLoading.set(filePath, loadPromise);

    return loadPromise;
  },

  getImage: (am: AtlasManagerT, filePath: string): CanvasImageSource | null => {
    return am.imageCache.get(filePath) || null;
  },

  hasImage: (am: AtlasManagerT, filePath: string): boolean => {
    return am.imageCache.has(filePath);
  },

  isLoading: (am: AtlasManagerT, filePath: string): boolean => {
    return am.imageLoading.has(filePath);
  },

  removeImage: (am: AtlasManagerT, filePath: string): void => {
    am.imageCache.delete(filePath);
    am.imageLoading.delete(filePath);
  },

  getImageCacheSize: (am: AtlasManagerT): number => {
    return am.imageCache.size;
  },

  dispose: (component: ComponentData): void => {
    const am = component as unknown as AtlasManagerT;
    am.textureMapIds.clear();
    am.atlases = [];
    am.compiled = false;
    am.imageCache.clear();
    am.imageLoading.clear();
    am.atlasCanvases = [];
    am.packState = null;
    am.packedByKey.clear();
    am._releaseScheduled = false;
    am.dirtyRegions = [];
    am.fullVersion = 0;
    am._disposed = true;
  },
};
