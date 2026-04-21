import {
  ComponentData,
  ComponentOptions,
  ComponentSerializer,
  ComponentUnique,
  ComponentInstanceMethods,
  DeserializationError,
  DeserializeResult,
} from '../types';
import { Vector2D, Vector3D, Vector4D } from '../../math';
import type { DataLayerMethods } from './methods';

/**
 * Allowed types for data-layer storage.
 * These types are strictly enforced - once a key is set with a type,
 * all future sets to that key must use the same type.
 */
export type DataLayerType =
  | string
  | number
  | boolean
  | Vector2D
  | Vector3D
  | Vector4D;

/**
 * Data-layer component for storing typed key-value pairs.
 * Provides both Proxy-based property access and explicit method access.
 */
export interface DataLayerT
  extends ComponentData, ComponentInstanceMethods<DataLayerMethods> {
  type: 'data-layer';
  unique: ComponentUnique.FALSE;
  storage: Map<string, DataLayerType>;
  typeMap: Map<string, string>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $data: any;
}

/**
 * Helper function to get the type name of a value.
 * Returns null if the value is not an allowed DataLayerType.
 */
function getTypeName(value: unknown): string | null {
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (value instanceof Vector2D) return 'Vector2D';
  if (value instanceof Vector3D) return 'Vector3D';
  if (value instanceof Vector4D) return 'Vector4D';
  return null;
}

/**
 * Creates a Proxy handler for the data-layer component.
 * Enables direct property access: dataLayer.$data.health = 100
 */
function createProxyHandler(dataLayer: DataLayerT): ProxyHandler<object> {
  return {
    get(_target: object, key: string): DataLayerType | undefined {
      if (typeof key === 'symbol') return undefined;
      return dataLayer.storage.get(key);
    },

    set(_target: object, key: string, value: unknown): boolean {
      if (typeof key === 'symbol') return false;

      // Validate type
      const typeName = getTypeName(value);
      if (typeName === null) {
        console.error(
          `[data-layer] Cannot set '${key}': value type is not allowed. ` +
            `Allowed types: string, number, boolean, Vector2D, Vector3D, Vector4D`,
        );
        return false;
      }

      // Check type enforcement
      const existingType = dataLayer.typeMap.get(key);
      if (existingType && existingType !== typeName) {
        console.error(
          `[data-layer] Type mismatch for key '${key}': ` +
            `expected ${existingType}, got ${typeName}`,
        );
        return false;
      }

      // Store value and type
      dataLayer.storage.set(key, value as DataLayerType);
      if (!existingType) {
        dataLayer.typeMap.set(key, typeName);
      }

      return true;
    },

    has(_target: object, key: string): boolean {
      if (typeof key === 'symbol') return false;
      return dataLayer.storage.has(key);
    },

    deleteProperty(_target: object, key: string): boolean {
      if (typeof key === 'symbol') return false;
      dataLayer.storage.delete(key);
      dataLayer.typeMap.delete(key);
      return true;
    },
  };
}

/**
 * Builder function for data-layer component.
 * Creates a new data-layer with empty storage and a Proxy for property access.
 *
 * @param options - Component creation options
 * @returns A new data-layer component instance
 *
 * @example
 * ```typescript
 * const dataLayer = await newComponent("data-layer", { name: "Player Stats" });
 *
 * // Use Proxy for direct access
 * dataLayer.$data.health = 100;
 * dataLayer.$data.position = new Vector3D(10, 20, 30);
 * dataLayer.$data.position.x = 15;  // Direct mutation works!
 *
 * // Or use explicit methods
 * DataLayer.set(dataLayer, "health", 100);
 * const health = DataLayer.get(dataLayer, "health");
 * ```
 */
export function builder(options: ComponentOptions): DataLayerT {
  // Create data-only object. Methods will be added by Proxy wrapper in newComponent()
  const dataLayer = {
    type: 'data-layer' as const,
    name: options.name,
    unique: ComponentUnique.FALSE,
    parent: null,
    _disposed: false,
    storage: new Map<string, DataLayerType>(),
    typeMap: new Map<string, string>(),
    $data: null as unknown,
  };

  // Create Proxy for property access
  dataLayer.$data = new Proxy(
    {},
    createProxyHandler(dataLayer as unknown as DataLayerT),
  );

  return dataLayer as unknown as DataLayerT;
}

/**
 * Serializes a data-layer component to a plain object.
 * Vectors are serialized with a special _vectorType field for reconstruction.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serialize(component: ComponentData): any {
  const dl = component as DataLayerT;

  // Convert storage Map to plain object
  const storageObj: Record<string, unknown> = {};
  for (const [key, value] of dl.storage) {
    if (value instanceof Vector2D) {
      storageObj[key] = { _vectorType: 'Vector2D', x: value.x, y: value.y };
    } else if (value instanceof Vector3D) {
      storageObj[key] = {
        _vectorType: 'Vector3D',
        x: value.x,
        y: value.y,
        z: value.z,
      };
    } else if (value instanceof Vector4D) {
      storageObj[key] = {
        _vectorType: 'Vector4D',
        x: value.x,
        y: value.y,
        z: value.z,
        w: value.w,
      };
    } else {
      storageObj[key] = value;
    }
  }

  // Convert typeMap to plain object
  const typeMapObj: Record<string, string> = {};
  for (const [key, typeName] of dl.typeMap) {
    typeMapObj[key] = typeName;
  }

  return {
    type: 'data-layer',
    name: dl.name,
    unique: ComponentUnique.FALSE,
    storage: storageObj,
    typeMap: typeMapObj,
  };
}

/**
 * Deserializes a plain object back into a data-layer component.
 * Reconstructs Vector instances from serialized data.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deserialize(data: any): DeserializeResult<DataLayerT> {
  const errors: DeserializationError[] = [];

  if (!data || typeof data !== 'object') {
    return {
      component: null,
      errors: [
        {
          code: 'INVALID_DATA',
          message: 'data-layer deserialize received non-object data',
        },
      ],
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const { type, name, storage, typeMap } = data;

  if (type !== 'data-layer') {
    errors.push({
      code: 'TYPE_MISMATCH',
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      message: `type ${type} does not match "data-layer"`,
    });
  }
  if (!name) {
    errors.push({
      code: 'MISSING_NAME',
      message: 'data-layer requires a name',
    });
  }
  if (errors.length > 0) {
    return { component: null, errors };
  }

  const componentName = name as string;
  const dataLayer = builder({ name: componentName });

  if (storage !== undefined) {
    if (!storage || typeof storage !== 'object') {
      errors.push({
        code: 'INVALID_STORAGE',
        message: `data-layer "${componentName}" storage field is not an object; ignored`,
      });
    } else {
      for (const key in storage) {
        const value = storage[key];

        if (value && typeof value === 'object' && '_vectorType' in value) {
          const vectorData = value as {
            _vectorType: string;
            x: number;
            y: number;
            z?: number;
            w?: number;
          };

          let vectorInstance: Vector2D | Vector3D | Vector4D;
          if (vectorData._vectorType === 'Vector2D') {
            vectorInstance = new Vector2D(vectorData.x, vectorData.y);
          } else if (vectorData._vectorType === 'Vector3D') {
            vectorInstance = new Vector3D(
              vectorData.x,
              vectorData.y,
              vectorData.z!,
            );
          } else if (vectorData._vectorType === 'Vector4D') {
            vectorInstance = new Vector4D(
              vectorData.x,
              vectorData.y,
              vectorData.z!,
              vectorData.w!,
            );
          } else {
            errors.push({
              code: 'UNKNOWN_VECTOR_TYPE',
              message: `data-layer "${componentName}" key "${key}" has unknown vector type "${vectorData._vectorType}"; skipped`,
            });
            continue;
          }

          dataLayer.storage.set(key, vectorInstance);
        } else {
          dataLayer.storage.set(key, value as DataLayerType);
        }
      }
    }
  }

  if (typeMap !== undefined) {
    if (!typeMap || typeof typeMap !== 'object') {
      errors.push({
        code: 'INVALID_TYPEMAP',
        message: `data-layer "${componentName}" typeMap field is not an object; ignored`,
      });
    } else {
      for (const key in typeMap) {
        dataLayer.typeMap.set(key, typeMap[key]);
      }
    }
  }

  return { component: dataLayer, errors };
}

export const DataLayerSerializer: ComponentSerializer = {
  serialize,
  deserialize,
};

/**
 * Allowlist of data-layer-specific properties accessible via component Proxy.
 * These properties can be accessed directly without triggering method lookup.
 */
export const PROPERTY_ALLOWLIST: string[] = ['storage', 'typeMap', '$'];
