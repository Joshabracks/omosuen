import type { ComponentData, ComponentOptions } from '../types';
import { ComponentUnique } from '../types';
import type { ImageRegistryMethods } from './methods';
import type { ComponentInstanceMethods } from '../types';

export interface ImageRegistryT
  extends ComponentData,
    ComponentInstanceMethods<ImageRegistryMethods> {
  type: 'image-registry';
  unique: ComponentUnique.GLOBAL;

  /**
   * Cache of loaded images, indexed by file path.
   */
  cache: Map<string, HTMLImageElement>;

  /**
   * Map of in-flight image load promises, indexed by file path.
   * Prevents duplicate simultaneous loads of the same image.
   */
  loading: Map<string, Promise<HTMLImageElement>>;
}

export const PROPERTY_ALLOWLIST = ['cache', 'loading'];

/**
 * Builder function for creating ImageRegistry components.
 */
export function builder(options: ComponentOptions): ImageRegistryT {
  return {
    type: 'image-registry' as const,
    name: options.name || 'ImageRegistry',
    unique: ComponentUnique.GLOBAL,
    parent: null,
    _disposed: false,
    cache: new Map<string, HTMLImageElement>(),
    loading: new Map<string, Promise<HTMLImageElement>>(),
  } as unknown as ImageRegistryT;
}
