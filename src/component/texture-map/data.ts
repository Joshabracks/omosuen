import type {
  ComponentData,
  ComponentOptions,
  ComponentSerializer,
  DeserializationError,
  DeserializeResult,
} from '../types';
import { ComponentUnique } from '../types';
import type {
  ImageType,
  OriginalFrame,
  PackedFrame,
  GridConfig,
} from './types';
import { isFrameMap, isGridConfig } from './types';
import type { TextureMapMethods } from './methods';
import type { ComponentInstanceMethods } from '../types';
import { Vector2D, Vector4D } from '../../math';

export interface TextureMapT
  extends ComponentData, ComponentInstanceMethods<TextureMapMethods> {
  type: 'texture-map';
  unique: ComponentUnique.FALSE;

  /**
   * Unique key for this texture map.
   * Used for atlas lookups and serialization.
   */
  textureMapKey: string;

  /**
   * File path to the source image.
   */
  filePath: string;

  /**
   * Configuration for how to extract frames from the source image.
   * - FrameMap: Explicit frame rectangles
   * - GridConfig: Uniform grid extraction
   * - undefined: Entire image is a single frame
   */
  imageType: ImageType;

  /**
   * Original frame definitions from the source image.
   * Required for atlas packing and serialization/deserialization.
   */
  originalFrames: OriginalFrame[];

  /**
   * Packed frame data after atlas processing.
   * Populated by AtlasManager.processTextureMaps().
   * Used at runtime for rendering.
   */
  packedFrames: PackedFrame[];

  /**
   * O(1) lookup map from frameIndex to PackedFrame.
   * Built automatically by setPackedFrames().
   */
  frameIndexMap: Map<number, PackedFrame>;
}

export const PROPERTY_ALLOWLIST = [
  'textureMapKey',
  'filePath',
  'imageType',
  'originalFrames',
  'packedFrames',
  'frameIndexMap',
];

/**
 * Options for creating a TextureMap component.
 */
export interface TextureMapOptions extends ComponentOptions {
  /**
   * Unique key for this texture map.
   */
  textureMapKey: string;

  /**
   * File path to the source image.
   */
  filePath: string;

  /**
   * Configuration for frame extraction.
   * - FrameMap: Array of Vector4D frame rectangles
   * - GridConfig: Uniform grid configuration
   * - undefined: Entire image is a single frame
   */
  imageType?: ImageType;

  /**
   * Optional atlas manager to auto-register this texture map with.
   * If provided, automatically calls atlasManager.addTextureMap() during initialization.
   */
  atlasManager?: unknown; // Using unknown to avoid circular dependency, will be cast to AtlasManagerT
}

/**
 * Extracts original frames from an image based on the imageType configuration.
 *
 * @param imageType - Frame extraction configuration
 * @param imageSize - Size of the source image (width, height)
 * @returns Array of OriginalFrame definitions
 */
function extractOriginalFrames(
  imageType: ImageType,
  imageSize?: Vector2D,
): OriginalFrame[] {
  // Case 1: FrameMap - explicit frame definitions
  if (isFrameMap(imageType)) {
    return imageType.map((rect, index) => ({
      frameIndex: index,
      position: new Vector2D(rect.x, rect.y),
      size: new Vector2D(rect.z, rect.w),
    }));
  }

  // Case 2: GridConfig - uniform grid extraction
  if (isGridConfig(imageType)) {
    const frames: OriginalFrame[] = [];
    const { cellSize, gridSize, cellCount } = imageType as GridConfig;
    const maxCells =
      cellCount !== undefined ? cellCount : gridSize.x * gridSize.y;

    for (let row = 0; row < gridSize.y; row++) {
      for (let col = 0; col < gridSize.x; col++) {
        const index = row * gridSize.x + col;
        if (index >= maxCells) break;

        frames.push({
          frameIndex: index,
          position: new Vector2D(col * cellSize.x, row * cellSize.y),
          size: new Vector2D(cellSize.x, cellSize.y),
        });
      }
    }

    return frames;
  }

  // Case 3: undefined - entire image is a single frame
  if (imageSize) {
    return [
      {
        frameIndex: 0,
        position: new Vector2D(0, 0),
        size: new Vector2D(imageSize.x, imageSize.y),
      },
    ];
  }

  // If no imageSize provided and imageType is undefined, return empty array
  // The frames will be populated later when the image is loaded
  return [];
}

/**
 * Builder function for creating TextureMap components.
 */
export function builder(options: TextureMapOptions): TextureMapT {
  const { textureMapKey, filePath, imageType, name, atlasManager } = options;

  // Extract original frames if imageType is provided
  // If imageType is undefined, frames will be set when image loads
  const originalFrames = extractOriginalFrames(imageType);

  const textureMap = {
    type: 'texture-map' as const,
    name: name || textureMapKey,
    unique: ComponentUnique.FALSE,
    parent: null,
    _disposed: false,
    textureMapKey,
    filePath,
    imageType,
    originalFrames,
    packedFrames: [],
    frameIndexMap: new Map(),
  } as unknown as TextureMapT;

  // Auto-register with atlas manager if provided
  if (atlasManager) {
    // Cast to any to avoid circular dependency issues
    const am = atlasManager as any;
    if (am.type === 'atlas-manager' && typeof am.addTextureMap === 'function') {
      am.addTextureMap(textureMap);
    } else {
      console.warn(
        '[texture-map] atlasManager option provided but is not a valid AtlasManager component',
      );
    }
  }

  return textureMap;
}

/**
 * Serializes a texture-map component to a plain object.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serialize(component: ComponentData): any {
  const t = component as TextureMapT;

  // Serialize imageType based on mode
  let imageTypeData: unknown = null;

  if (isFrameMap(t.imageType)) {
    imageTypeData = {
      mode: 'framemap',
      frames: t.imageType.map((rect) => ({
        x: rect.x,
        y: rect.y,
        w: rect.z,
        h: rect.w,
      })),
    };
  } else if (isGridConfig(t.imageType)) {
    const grid = t.imageType as GridConfig;
    imageTypeData = {
      mode: 'grid',
      cellWidth: grid.cellSize.x,
      cellHeight: grid.cellSize.y,
      cols: grid.gridSize.x,
      rows: grid.gridSize.y,
      cellCount: grid.cellCount,
    };
  }

  return {
    type: 'texture-map',
    name: t.name,
    unique: ComponentUnique.FALSE,
    textureMapKey: t.textureMapKey,
    filePath: t.filePath,
    imageType: imageTypeData,
  };
}

/**
 * Collapse errors sharing the same `code` into a single tallied entry.
 * Preserves the first-seen message as representative; sums the counts.
 * This keeps a texture-map with N broken frames from producing N error
 * entries — the caller gets one entry with count = N instead.
 */
function tallyErrors(errors: DeserializationError[]): DeserializationError[] {
  const map = new Map<string, DeserializationError>();
  for (const err of errors) {
    const existing = map.get(err.code);
    const increment = err.count ?? 1;
    if (existing) {
      existing.count = (existing.count ?? 1) + increment;
    } else {
      map.set(err.code, { ...err, count: increment });
    }
  }
  return Array.from(map.values());
}

/**
 * Deserializes a plain object back into a texture-map component.
 * Errors of the same category are tallied (see tallyErrors) so a single
 * texture-map with many malformed frames surfaces as one entry per code
 * rather than hundreds of near-identical messages.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deserialize(data: any): DeserializeResult<TextureMapT> {
  const errors: DeserializationError[] = [];

  if (!data || typeof data !== 'object') {
    return {
      component: null,
      errors: [
        {
          code: 'INVALID_DATA',
          message: 'texture-map deserialize received non-object data',
        },
      ],
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const {
    type,
    name,
    textureMapKey,
    filePath,
    imageType: imageTypeData,
  } = data;

  if (type !== 'texture-map') {
    errors.push({
      code: 'TYPE_MISMATCH',
      message: `type ${type} does not match "texture-map"`,
    });
  }
  if (!name) {
    errors.push({
      code: 'MISSING_NAME',
      message: 'texture-map requires a name',
    });
  }
  if (errors.length > 0) {
    return { component: null, errors: tallyErrors(errors) };
  }

  const componentName = name as string;

  let imageType: ImageType;

  if (imageTypeData && typeof imageTypeData === 'object') {
    if (
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      imageTypeData.mode === 'framemap' &&
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      Array.isArray(imageTypeData.frames)
    ) {
      // Reconstruct FrameMap (Vector4D[]), recording per-frame errors for
      // malformed entries. These will be tallied before returning.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      const frames = imageTypeData.frames as unknown[];
      const vectors: Vector4D[] = [];
      for (let i = 0; i < frames.length; i += 1) {
        const f = frames[i];
        if (!f || typeof f !== 'object') {
          errors.push({
            code: 'INVALID_FRAME',
            message: `texture-map "${componentName}" has a malformed framemap entry (not an object); defaulted to (0, 0, 0, 0)`,
          });
          vectors.push(new Vector4D(0, 0, 0, 0));
          continue;
        }
        const frame = f as {
          x?: unknown;
          y?: unknown;
          w?: unknown;
          h?: unknown;
        };
        const fields: Array<[keyof typeof frame, string]> = [
          ['x', 'x'],
          ['y', 'y'],
          ['w', 'w'],
          ['h', 'h'],
        ];
        const values: number[] = [0, 0, 0, 0];
        for (let fi = 0; fi < fields.length; fi += 1) {
          const [key] = fields[fi];
          const v = frame[key];
          if (typeof v !== 'number' || !Number.isFinite(v)) {
            errors.push({
              code: `INVALID_FRAME_${key.toString().toUpperCase()}`,
              message: `texture-map "${componentName}" framemap entries have a non-numeric "${key.toString()}" coordinate; defaulted to 0`,
            });
          } else {
            values[fi] = v;
          }
        }
        vectors.push(new Vector4D(values[0], values[1], values[2], values[3]));
      }
      imageType = vectors;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    } else if (imageTypeData.mode === 'grid') {
      const g = imageTypeData as {
        cellWidth?: unknown;
        cellHeight?: unknown;
        cols?: unknown;
        rows?: unknown;
        cellCount?: unknown;
      };
      const cellWidth =
        typeof g.cellWidth === 'number' && Number.isFinite(g.cellWidth)
          ? g.cellWidth
          : 0;
      if (cellWidth === 0 && g.cellWidth !== 0) {
        errors.push({
          code: 'INVALID_GRID_CELL_WIDTH',
          message: `texture-map "${componentName}" grid cellWidth is not a finite number; defaulted to 0`,
        });
      }
      const cellHeight =
        typeof g.cellHeight === 'number' && Number.isFinite(g.cellHeight)
          ? g.cellHeight
          : 0;
      if (cellHeight === 0 && g.cellHeight !== 0) {
        errors.push({
          code: 'INVALID_GRID_CELL_HEIGHT',
          message: `texture-map "${componentName}" grid cellHeight is not a finite number; defaulted to 0`,
        });
      }
      const cols =
        typeof g.cols === 'number' && Number.isFinite(g.cols) ? g.cols : 0;
      if (cols === 0 && g.cols !== 0) {
        errors.push({
          code: 'INVALID_GRID_COLS',
          message: `texture-map "${componentName}" grid cols is not a finite number; defaulted to 0`,
        });
      }
      const rows =
        typeof g.rows === 'number' && Number.isFinite(g.rows) ? g.rows : 0;
      if (rows === 0 && g.rows !== 0) {
        errors.push({
          code: 'INVALID_GRID_ROWS',
          message: `texture-map "${componentName}" grid rows is not a finite number; defaulted to 0`,
        });
      }
      imageType = {
        cellSize: new Vector2D(cellWidth, cellHeight),
        gridSize: new Vector2D(cols, rows),
        cellCount: g.cellCount,
      } as GridConfig;
    }
  }

  return {
    component: builder({
      name: componentName,
      textureMapKey: textureMapKey as string,
      filePath: filePath as string,
      imageType,
    }),
    errors: tallyErrors(errors),
  };
}

export const TextureMapSerializer: ComponentSerializer = {
  serialize,
  deserialize,
};
