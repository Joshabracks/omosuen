import {
  ComponentData,
  ComponentOptions,
  ComponentSerializer,
  ComponentUnique,
  ComponentInstanceMethods,
  DeserializationError,
  DeserializeResult,
} from '../types';
import type { AsepriteMethods } from './methods';

/**
 * Declarative Aseprite source component. Stores a `.aseprite` file URL plus
 * import config; on init it statically fetches + parses the file and builds the
 * entity's sprites + animation-controller + texture-maps into its parent nexus
 * (all flagged transient/`_generated`). Same fully-static `filePath` convention
 * as audio-track / texture-map: scenes serialize only the URL + config, and the
 * pixels/atlas are regenerated on load.
 */
export interface AsepriteT
  extends ComponentData, ComponentInstanceMethods<AsepriteMethods> {
  type: 'aseprite';
  unique: ComponentUnique.LOCAL;

  /** URL/path to the `.aseprite` file (fetched at runtime). */
  filePath: string;

  /** Composite all layers into one sprite (true) vs one sprite per layer. */
  flatten: boolean;

  /** Only ingest layers whose Aseprite visible flag is set. */
  visibleOnly: boolean;

  /** Namespace for generated texture keys; defaults to the component name. */
  packageId: string;

  /**
   * Optional layer-name → slot map. Layers sharing a slot become mutually
   * exclusive toggles on the controller (e.g. hair A/B/C).
   */
  layerSlots?: Record<string, string>;
}

export interface AsepriteOptions extends ComponentOptions {
  filePath: string;
  flatten?: boolean;
  visibleOnly?: boolean;
  packageId?: string;
  layerSlots?: Record<string, string>;
}

/**
 * Builder for the aseprite component. Ingestion happens later, in init.
 */
export function builder(options: AsepriteOptions): AsepriteT {
  const aseprite = {
    type: 'aseprite' as const,
    name: options.name,
    unique: ComponentUnique.LOCAL,
    parent: null,
    _disposed: false,
    filePath: options.filePath,
    flatten: options.flatten ?? true,
    visibleOnly: options.visibleOnly ?? true,
    packageId: options.packageId ?? options.name,
    layerSlots: options.layerSlots,
  };

  return aseprite as unknown as AsepriteT;
}

/**
 * Serializes an aseprite component. Only the source declaration is stored — the
 * generated sprites/controller/texture-maps are skipped by the scene serializer
 * and rebuilt on load.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serialize(component: ComponentData): any {
  const a = component as AsepriteT;
  return {
    type: 'aseprite',
    name: a.name,
    unique: ComponentUnique.LOCAL,
    filePath: a.filePath,
    flatten: a.flatten,
    visibleOnly: a.visibleOnly,
    packageId: a.packageId,
    layerSlots: a.layerSlots,
  };
}

/**
 * Deserializes an aseprite component.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deserialize(data: any): DeserializeResult<AsepriteT> {
  const errors: DeserializationError[] = [];

  if (!data || typeof data !== 'object') {
    return {
      component: null,
      errors: [
        {
          code: 'INVALID_DATA',
          message: 'aseprite deserialize received non-object data',
        },
      ],
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const { type, name, filePath, flatten, visibleOnly, packageId, layerSlots } =
    data;

  if (type !== 'aseprite') {
    errors.push({
      code: 'TYPE_MISMATCH',
      message: `type ${type} does not match "aseprite"`,
    });
  }
  if (!name) {
    errors.push({ code: 'MISSING_NAME', message: 'aseprite requires a name' });
  }
  if (typeof filePath !== 'string' || filePath.length === 0) {
    errors.push({
      code: 'MISSING_FILEPATH',
      message: 'aseprite requires a filePath',
    });
  }
  if (errors.length > 0) {
    return { component: null, errors };
  }

  return {
    component: builder({
      name: name as string,
      filePath: filePath as string,
      flatten: flatten as boolean | undefined,
      visibleOnly: visibleOnly as boolean | undefined,
      packageId: packageId as string | undefined,
      layerSlots: layerSlots as Record<string, string> | undefined,
    }),
    errors,
  };
}

export const AsepriteSerializer: ComponentSerializer = {
  serialize,
  deserialize,
};

export const PROPERTY_ALLOWLIST: string[] = [
  'filePath',
  'flatten',
  'visibleOnly',
  'packageId',
  'layerSlots',
];
