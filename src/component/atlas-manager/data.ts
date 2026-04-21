import type {
  ComponentData,
  ComponentOptions,
  ComponentSerializer,
  DeserializationError,
  DeserializeResult,
} from '../types';
import { ComponentUnique } from '../types';
import type { AtlasManagerMethods } from './methods';
import type { ComponentInstanceMethods } from '../types';

/**
 * Valid atlas sizes (power of 2)
 */
export type AtlasSize = 1024 | 2048 | 4096 | 8192;

/**
 * Configuration options for the AtlasManager
 */
export interface AtlasManagerConfig {
  /**
   * Size of each atlas texture (power of 2)
   * Default: 4096
   */
  atlasSize?: AtlasSize;

  /**
   * Maximum number of atlases (1-16)
   * Default: 16
   */
  maxAtlases?: number;

  /**
   * Padding between frames in pixels (0-4)
   * Used for texture bleeding prevention
   * Default: 1
   */
  padding?: number;
}

export interface AtlasManagerT
  extends ComponentData, ComponentInstanceMethods<AtlasManagerMethods> {
  type: 'atlas-manager';
  unique: ComponentUnique.GLOBAL;

  /**
   * Set of texture map IDs pending processing
   */
  textureMapIds: Set<string>;

  /**
   * Array of compiled atlas textures (0-15)
   * Each atlas is an ImageData object
   */
  atlases: ImageData[];

  /**
   * Flag indicating if atlases are compiled and ready for rendering
   */
  compiled: boolean;

  /**
   * Configuration for atlas management
   */
  config: Required<AtlasManagerConfig>;

  /**
   * Cache of loaded images, indexed by file path.
   * Merged from image-registry component.
   */
  imageCache: Map<string, HTMLImageElement>;

  /**
   * Map of in-flight image load promises, indexed by file path.
   * Prevents duplicate simultaneous loads of the same image.
   * Merged from image-registry component.
   */
  imageLoading: Map<string, Promise<HTMLImageElement>>;
}

export const PROPERTY_ALLOWLIST = [
  'textureMapIds',
  'atlases',
  'compiled',
  'config',
  'imageCache',
  'imageLoading',
];

/**
 * Options for creating an AtlasManager component.
 */
export interface AtlasManagerOptions extends ComponentOptions {
  config?: AtlasManagerConfig;
}

/**
 * Builder function for creating AtlasManager components.
 */
export function builder(options: AtlasManagerOptions): AtlasManagerT {
  // Apply defaults to config
  const config: Required<AtlasManagerConfig> = {
    atlasSize: options.config?.atlasSize ?? 4096,
    maxAtlases: options.config?.maxAtlases ?? 16,
    padding: options.config?.padding ?? 1,
  };

  // Validate config
  if (config.maxAtlases < 1 || config.maxAtlases > 16) {
    throw new Error(
      `maxAtlases must be between 1 and 16, got ${config.maxAtlases}`,
    );
  }

  if (config.padding < 0 || config.padding > 4) {
    throw new Error(`padding must be between 0 and 4, got ${config.padding}`);
  }

  const validSizes: AtlasSize[] = [1024, 2048, 4096, 8192];
  if (!validSizes.includes(config.atlasSize)) {
    throw new Error(
      `atlasSize must be a power of 2 (1024, 2048, 4096, or 8192), got ${config.atlasSize}`,
    );
  }

  return {
    type: 'atlas-manager' as const,
    name: options.name || 'AtlasManager',
    unique: ComponentUnique.GLOBAL,
    parent: null,
    _disposed: false,
    textureMapIds: new Set<string>(),
    atlases: [],
    compiled: false,
    config,
    imageCache: new Map<string, HTMLImageElement>(),
    imageLoading: new Map<string, Promise<HTMLImageElement>>(),
  } as unknown as AtlasManagerT;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serialize(component: ComponentData): any {
  const c = component as AtlasManagerT;
  return {
    type: 'atlas-manager',
    name: c.name,
    unique: ComponentUnique.GLOBAL,
    config: {
      atlasSize: c.config.atlasSize,
      maxAtlases: c.config.maxAtlases,
      padding: c.config.padding,
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deserialize(data: any): DeserializeResult<AtlasManagerT> {
  const errors: DeserializationError[] = [];

  if (!data || typeof data !== 'object') {
    return {
      component: null,
      errors: [
        {
          code: 'INVALID_DATA',
          message: 'atlas-manager deserialize received non-object data',
        },
      ],
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const { type, name, config } = data;

  if (type !== 'atlas-manager') {
    return {
      component: null,
      errors: [
        {
          code: 'TYPE_MISMATCH',
          message: `type ${type} does not match "atlas-manager"`,
        },
      ],
    };
  }

  const componentName = (name as string) || 'AtlasManager';

  // atlas-manager's builder validates atlasSize/maxAtlases/padding and
  // throws on invalid values. Convert any such throw into a structured error.
  try {
    return {
      component: builder({
        name: componentName,
        config: config as AtlasManagerConfig | undefined,
      }),
      errors,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push({
      code: 'INVALID_CONFIG',
      message: `atlas-manager "${componentName}" config rejected: ${message}`,
    });
    return { component: null, errors };
  }
}

export const AtlasManagerSerializer: ComponentSerializer = {
  serialize,
  deserialize,
};
