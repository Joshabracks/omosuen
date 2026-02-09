import type { ComponentData, ComponentMethods } from '../types';
import type { ImageRegistryT } from './data';

export interface ImageRegistryMethods extends ComponentMethods {
  type: 'image-registry';

  /**
   * Loads an image asynchronously.
   * If the image is already loaded, returns it immediately from cache.
   * If the image is currently loading, returns the existing promise.
   * Otherwise, initiates a new load.
   *
   * @param ir - ImageRegistry component
   * @param filePath - Path to the image file
   * @returns Promise that resolves to the loaded HTMLImageElement
   */
  loadImage: (
    ir: ImageRegistryT,
    filePath: string,
  ) => Promise<HTMLImageElement>;

  /**
   * Synchronously retrieves an image from the cache.
   * Returns null if the image is not loaded.
   *
   * @param ir - ImageRegistry component
   * @param filePath - Path to the image file
   * @returns The cached HTMLImageElement, or null if not found
   */
  getImage: (ir: ImageRegistryT, filePath: string) => HTMLImageElement | null;

  /**
   * Checks if an image is loaded in the cache.
   *
   * @param ir - ImageRegistry component
   * @param filePath - Path to the image file
   * @returns True if the image is cached, false otherwise
   */
  hasImage: (ir: ImageRegistryT, filePath: string) => boolean;

  /**
   * Checks if an image is currently being loaded.
   *
   * @param ir - ImageRegistry component
   * @param filePath - Path to the image file
   * @returns True if the image is loading, false otherwise
   */
  isLoading: (ir: ImageRegistryT, filePath: string) => boolean;

  /**
   * Removes an image from the cache.
   * Useful for freeing memory when an image is no longer needed.
   *
   * @param ir - ImageRegistry component
   * @param filePath - Path to the image file
   */
  removeImage: (ir: ImageRegistryT, filePath: string) => void;

  /**
   * Clears all cached images and pending loads.
   *
   * @param ir - ImageRegistry component
   */
  clear: (ir: ImageRegistryT) => void;

  /**
   * Gets the number of cached images.
   *
   * @param ir - ImageRegistry component
   * @returns Number of images in cache
   */
  getCacheSize: (ir: ImageRegistryT) => number;

  /**
   * Disposes of the ImageRegistry.
   *
   * @param component - Component to dispose
   */
  dispose: (component: ComponentData) => void;
}

export const ImageRegistry: ImageRegistryMethods = {
  type: 'image-registry',

  loadImage: async (
    ir: ImageRegistryT,
    filePath: string,
  ): Promise<HTMLImageElement> => {
    // Check if already loaded
    if (ir.cache.has(filePath)) {
      return ir.cache.get(filePath)!;
    }

    // Check if currently loading
    if (ir.loading.has(filePath)) {
      return ir.loading.get(filePath)!;
    }

    // Start new load
    const loadPromise = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();

      img.onload = () => {
        // Add to cache
        ir.cache.set(filePath, img);
        // Remove from loading map
        ir.loading.delete(filePath);
        resolve(img);
      };

      img.onerror = (error) => {
        // Remove from loading map
        ir.loading.delete(filePath);
        console.error(
          `[image-registry] Failed to load image: ${filePath}`,
          error,
        );
        reject(new Error(`Failed to load image: ${filePath}`));
      };

      img.src = filePath;
    });

    // Store the promise to prevent duplicate loads
    ir.loading.set(filePath, loadPromise);

    return loadPromise;
  },

  getImage: (ir: ImageRegistryT, filePath: string): HTMLImageElement | null => {
    return ir.cache.get(filePath) || null;
  },

  hasImage: (ir: ImageRegistryT, filePath: string): boolean => {
    return ir.cache.has(filePath);
  },

  isLoading: (ir: ImageRegistryT, filePath: string): boolean => {
    return ir.loading.has(filePath);
  },

  removeImage: (ir: ImageRegistryT, filePath: string): void => {
    ir.cache.delete(filePath);
    ir.loading.delete(filePath);
  },

  clear: (ir: ImageRegistryT): void => {
    ir.cache.clear();
    ir.loading.clear();
  },

  getCacheSize: (ir: ImageRegistryT): number => {
    return ir.cache.size;
  },

  dispose: (component: ComponentData): void => {
    const ir = component as unknown as ImageRegistryT;
    ir.cache.clear();
    ir.loading.clear();
    ir._disposed = true;
  },
};
