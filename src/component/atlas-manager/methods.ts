import type { ComponentData, ComponentMethods } from '../types';
import type { AtlasManagerT } from './data';
import type { TextureMapT } from '../texture-map/data';
import type { NexusT } from '../nexus/data';
import type { UnpackedFrame } from './types';
import { packFrames } from './packer';
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
  getImage: (am: AtlasManagerT, filePath: string) => HTMLImageElement | null;

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
 * Compiles all pending texture maps into atlases as a resumable generator: it
 * `yield`s between work batches (after image load, after pack, every N blits,
 * between per-atlas reads) so the progressive-init scheduler can spread the
 * compile across frames. Pixels are blitted source→atlas via drawImage (no
 * per-frame ImageData extraction). Driven to completion by `processTextureMaps`
 * or sliced across frames by `initProgressive`.
 */
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

  // Load source images (internal cache).
  const imageLoadPromises = textureMaps.map((tm) =>
    AtlasManager.loadImage(am, tm.filePath),
  );
  let images: HTMLImageElement[];
  try {
    images = await Promise.all(imageLoadPromises);
  } catch (error) {
    console.error('[atlas-manager] Failed to load images', error);
    throw error;
  }
  yield;

  // Frame metadata only — no per-frame canvas/getImageData extraction.
  const unpackedFrames: UnpackedFrame[] = [];
  for (let i = 0; i < textureMaps.length; i++) {
    const tm = textureMaps[i];
    const image = images[i];
    if (tm.originalFrames.length === 0) {
      tm.originalFrames = [
        {
          frameIndex: 0,
          position: new Vector2D(0, 0),
          size: new Vector2D(image.width, image.height),
        },
      ];
    }
    for (const originalFrame of tm.originalFrames) {
      unpackedFrames.push({
        textureMapKey: tm.textureMapKey,
        frameIndex: originalFrame.frameIndex,
        size: originalFrame.size,
        sourceImage: image,
        sourcePosition: originalFrame.position,
      });
    }
  }
  yield;

  // Pack (single synchronous chunk).
  const tPack = performance.now();
  let packedFrames: UnpackedFrame[];
  try {
    packedFrames = packFrames(
      unpackedFrames,
      am.config.atlasSize,
      am.config.maxAtlases,
      am.config.padding,
    );
  } catch (error) {
    console.error('[atlas-manager] Failed to pack frames', error);
    throw error;
  }
  const packMs = performance.now() - tPack;
  yield;

  // Create the atlas canvases that are actually used.
  const atlasContexts: CanvasRenderingContext2D[] = [];
  const usedAtlasIndices = new Set<number>();
  for (const frame of packedFrames) {
    if (frame.atlasIndex !== undefined) usedAtlasIndices.add(frame.atlasIndex);
  }
  for (const index of usedAtlasIndices) {
    const canvas = document.createElement('canvas');
    canvas.width = am.config.atlasSize;
    canvas.height = am.config.atlasSize;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error(`Failed to get 2D context for atlas ${index}`);
    }
    atlasContexts[index] = ctx;
  }

  // Blit frames straight onto the atlas canvases (chunked + yielding).
  const BUILD_BATCH = 512;
  let drawn = 0;
  for (const frame of packedFrames) {
    if (frame.atlasIndex === undefined || frame.atlasPosition === undefined) {
      console.error('[atlas-manager] Frame missing atlas info', frame);
      continue;
    }
    const ctx = atlasContexts[frame.atlasIndex];
    ctx.drawImage(
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
    if (++drawn % BUILD_BATCH === 0) yield;
  }

  // One getImageData per atlas → am.atlases stays ImageData[] (renderer unchanged).
  am.atlases = [];
  for (const index of usedAtlasIndices) {
    am.atlases[index] = atlasContexts[index].getImageData(
      0,
      0,
      am.config.atlasSize,
      am.config.atlasSize,
    );
    yield;
  }

  // Assign packed frames to texture maps. Group by key once (O(F)) instead of
  // the old O(textureMaps × frames) nested scan.
  const framesByKey = new Map<string, PackedFrame[]>();
  for (const frame of packedFrames) {
    if (frame.atlasIndex === undefined || frame.atlasPosition === undefined) {
      continue;
    }
    let arr = framesByKey.get(frame.textureMapKey);
    if (!arr) {
      arr = [];
      framesByKey.set(frame.textureMapKey, arr);
    }
    arr.push({
      frameIndex: frame.frameIndex,
      atlasPosition: frame.atlasPosition,
      atlasIndex: frame.atlasIndex,
      size: frame.size,
    });
  }
  for (const tm of textureMaps) {
    TextureMap.setPackedFrames(tm, framesByKey.get(tm.textureMapKey) ?? []);
  }

  am.textureMapIds.clear();
  am.compiled = true;
  invalidateAllTextureMapCaches();

  console.log(
    `[atlas-manager] compiled ${unpackedFrames.length} frames → ` +
      `${usedAtlasIndices.size} atlases (pack ${packMs.toFixed(0)} ms; ` +
      `build spread across frames)`,
  );
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
    am.compiled = false;
  },

  processTextureMaps: async (am: AtlasManagerT): Promise<void> => {
    // Drives the progressive compile straight to completion (no frame yielding).
    // Used by direct/manual callers; the auto-init path runs `compileSteps` via
    // `initProgressive` so the scheduler can spread it across frames.
    const gen = compileSteps(am);
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

    return am.atlases[index];
  },

  getAtlasCount: (am: AtlasManagerT): number => {
    return am.atlases.length;
  },

  clear: (am: AtlasManagerT): void => {
    am.textureMapIds.clear();
    am.atlases = [];
    am.compiled = false;
    am.imageCache.clear();
    am.imageLoading.clear();
  },

  loadImage: async (
    am: AtlasManagerT,
    filePath: string,
  ): Promise<HTMLImageElement> => {
    // Check if already loaded
    if (am.imageCache.has(filePath)) {
      return am.imageCache.get(filePath)!;
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

  getImage: (am: AtlasManagerT, filePath: string): HTMLImageElement | null => {
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
    am._disposed = true;
  },
};
