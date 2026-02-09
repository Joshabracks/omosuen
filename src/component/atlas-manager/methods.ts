import type { ComponentData, ComponentMethods } from '../types';
import type { AtlasManagerT } from './data';
import type { TextureMapT } from '../texture-map/data';
import type { ImageRegistryT } from '../image-registry/data';
import type { NexusT } from '../nexus/data';
import type { UnpackedFrame } from './types';
import { packFrames } from './packer';
import { Vector2D } from '../../math';
import type { PackedFrame } from '../texture-map/types';

export interface AtlasManagerMethods extends ComponentMethods {
  type: 'atlas-manager';

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
   * 2. Loads source images via ImageRegistry
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

  // Import Nexus methods
  const { getComponentsByType } = require('../nexus/methods').Nexus;

  // Get all texture-map components recursively
  const allTextureMaps = getComponentsByType(
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
 * Helper function to get the ImageRegistry component.
 */
function getImageRegistry(rootNexus: NexusT): ImageRegistryT | null {
  const { getComponentByType } = require('../nexus/methods').Nexus;
  return getComponentByType(rootNexus, 'image-registry', true) as ImageRegistryT | null;
}

/**
 * Extracts image data for a frame from a source image.
 */
function extractFrameImageData(
  image: HTMLImageElement,
  position: Vector2D,
  size: Vector2D,
): ImageData {
  // Create temporary canvas for extraction
  const canvas = document.createElement('canvas');
  canvas.width = size.x;
  canvas.height = size.y;
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Failed to get 2D context for frame extraction');
  }

  // Draw the frame portion of the source image
  ctx.drawImage(
    image,
    position.x,
    position.y,
    size.x,
    size.y,
    0,
    0,
    size.x,
    size.y,
  );

  return ctx.getImageData(0, 0, size.x, size.y);
}

export const AtlasManager: AtlasManagerMethods = {
  type: 'atlas-manager',

  addTextureMap: (am: AtlasManagerT, textureMap: TextureMapT): void => {
    am.textureMapIds.add(textureMap.textureMapKey);
    am.compiled = false;
  },

  processTextureMaps: async (am: AtlasManagerT): Promise<void> => {
    if (am.textureMapIds.size === 0) {
      console.warn('[atlas-manager] No texture maps to process');
      return;
    }

    // Get root nexus
    const rootNexus = getRootNexus(am);
    if (!rootNexus) {
      throw new Error(
        '[atlas-manager] Cannot process texture maps: not attached to a scene',
      );
    }

    // Get texture maps
    const textureMaps = getTextureMaps(rootNexus, am.textureMapIds);
    if (textureMaps.length === 0) {
      console.warn(
        '[atlas-manager] No texture maps found for pending IDs',
      );
      am.textureMapIds.clear();
      return;
    }

    // Get image registry
    const imageRegistry = getImageRegistry(rootNexus);
    if (!imageRegistry) {
      throw new Error(
        '[atlas-manager] ImageRegistry component not found in scene',
      );
    }

    // Import ImageRegistry methods
    const { loadImage } = require('../image-registry/methods').ImageRegistry;

    // Load all images
    const imageLoadPromises = textureMaps.map((tm) =>
      loadImage(imageRegistry, tm.filePath),
    );

    let images: HTMLImageElement[];
    try {
      images = await Promise.all(imageLoadPromises);
    } catch (error) {
      console.error('[atlas-manager] Failed to load images', error);
      throw error;
    }

    // Create unpacked frames
    const unpackedFrames: UnpackedFrame[] = [];

    for (let i = 0; i < textureMaps.length; i++) {
      const tm = textureMaps[i];
      const image = images[i];

      // If originalFrames is empty (undefined imageType), create single frame
      if (tm.originalFrames.length === 0) {
        tm.originalFrames = [
          {
            frameIndex: 0,
            position: new Vector2D(0, 0),
            size: new Vector2D(image.width, image.height),
          },
        ];
      }

      // Extract image data for each frame
      for (const originalFrame of tm.originalFrames) {
        const imageData = extractFrameImageData(
          image,
          originalFrame.position,
          originalFrame.size,
        );

        unpackedFrames.push({
          textureMapKey: tm.textureMapKey,
          frameIndex: originalFrame.frameIndex,
          size: originalFrame.size,
          imageData,
        });
      }
    }

    // Pack frames into atlases
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

    // Create atlas canvases and contexts
    const atlasCanvases: HTMLCanvasElement[] = [];
    const atlasContexts: CanvasRenderingContext2D[] = [];
    const usedAtlasIndices = new Set<number>();

    // Determine which atlases are used
    for (const frame of packedFrames) {
      if (frame.atlasIndex !== undefined) {
        usedAtlasIndices.add(frame.atlasIndex);
      }
    }

    // Create only the atlases that are used
    for (const index of usedAtlasIndices) {
      const canvas = document.createElement('canvas');
      canvas.width = am.config.atlasSize;
      canvas.height = am.config.atlasSize;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        throw new Error(`Failed to get 2D context for atlas ${index}`);
      }

      atlasCanvases[index] = canvas;
      atlasContexts[index] = ctx;
    }

    // Apply frames to atlases
    for (const frame of packedFrames) {
      if (frame.atlasIndex === undefined || frame.atlasPosition === undefined) {
        console.error('[atlas-manager] Frame missing atlas info', frame);
        continue;
      }

      const ctx = atlasContexts[frame.atlasIndex];
      ctx.putImageData(
        frame.imageData,
        frame.atlasPosition.x,
        frame.atlasPosition.y,
      );
    }

    // Convert canvases to ImageData and store
    am.atlases = [];
    for (const index of usedAtlasIndices) {
      const ctx = atlasContexts[index];
      am.atlases[index] = ctx.getImageData(
        0,
        0,
        am.config.atlasSize,
        am.config.atlasSize,
      );
    }

    // Update texture maps with packed frames
    const { setPackedFrames } = require('../texture-map/methods').TextureMap;

    for (const tm of textureMaps) {
      const tmPackedFrames: PackedFrame[] = [];

      for (const frame of packedFrames) {
        if (
          frame.textureMapKey === tm.textureMapKey &&
          frame.atlasIndex !== undefined &&
          frame.atlasPosition !== undefined
        ) {
          tmPackedFrames.push({
            frameIndex: frame.frameIndex,
            atlasPosition: frame.atlasPosition,
            atlasIndex: frame.atlasIndex,
            size: frame.size,
          });
        }
      }

      setPackedFrames(tm, tmPackedFrames);
    }

    // Clear pending texture maps and set compiled flag
    am.textureMapIds.clear();
    am.compiled = true;

    console.log(
      `[atlas-manager] Successfully compiled ${am.atlases.length} atlases from ${textureMaps.length} texture maps`,
    );
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
  },

  dispose: (component: ComponentData): void => {
    const am = component as unknown as AtlasManagerT;
    am.textureMapIds.clear();
    am.atlases = [];
    am.compiled = false;
    am._disposed = true;
  },
};
