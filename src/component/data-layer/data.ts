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
 * Allowed scalar/vector element types for data-layer storage.
 * Arrays (see DataLayerType) hold homogeneous lists of these.
 */
export type DataLayerScalar =
  | string
  | number
  | boolean
  | Vector2D
  | Vector3D
  | Vector4D;

/**
 * Allowed types for data-layer storage.
 * These types are strictly enforced - once a key is set with a type,
 * all future sets to that key must use the same type.
 *
 * Arrays are homogeneous and one level deep: every element shares the same
 * scalar/vector type (e.g. number[], Vector3D[]). Arrays of arrays and arrays
 * of arbitrary objects are not allowed, preserving the flat-data philosophy.
 */
export type DataLayerType =
  | DataLayerScalar
  | string[]
  | number[]
  | boolean[]
  | Vector2D[]
  | Vector3D[]
  | Vector4D[];

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
 * Returns the type name of a single scalar/vector value, or null if it is not
 * an allowed element type. Arrays are intentionally rejected here (no nesting).
 */
export function getScalarTypeName(value: unknown): string | null {
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (value instanceof Vector2D) return 'Vector2D';
  if (value instanceof Vector3D) return 'Vector3D';
  if (value instanceof Vector4D) return 'Vector4D';
  return null;
}

/**
 * Returns the type name of a value, including homogeneous array tags such as
 * "number[]". Returns null if the value is not an allowed DataLayerType:
 * an invalid scalar, an empty array (element type cannot be inferred), a
 * non-homogeneous array, or a nested array.
 */
export function getTypeName(value: unknown): string | null {
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    const elementType = getScalarTypeName(value[0]);
    if (elementType === null) return null;
    for (let i = 1; i < value.length; i += 1) {
      if (getScalarTypeName(value[i]) !== elementType) return null;
    }
    return `${elementType}[]`;
  }
  return getScalarTypeName(value);
}

/**
 * Strips the trailing "[]" from an array type tag ("number[]" -> "number").
 * Returns null if the tag is not an array tag.
 */
export function elementTypeOf(tag: string): string | null {
  return tag.endsWith('[]') ? tag.slice(0, -2) : null;
}

/**
 * Validates `value` against the type lock for `key` and stores it.
 * Shared by the Proxy set handler and DataLayer.set so validation lives in one
 * place. Logs and returns false on an invalid type, a type mismatch, or an
 * empty array assigned to a key whose array element type is not yet established.
 */
export function setDataLayerValue(
  d: DataLayerT,
  key: string,
  value: unknown,
): boolean {
  const existingType = d.typeMap.get(key);

  // Empty array: element type cannot be inferred, so it may only be assigned to
  // a key already locked to an array type (i.e. clearing an existing list).
  if (Array.isArray(value) && value.length === 0) {
    if (existingType && existingType.endsWith('[]')) {
      d.storage.set(key, [] as unknown as DataLayerType);
      return true;
    }
    console.error(
      `[data-layer] Cannot set '${key}' to an empty array: element type ` +
        `cannot be inferred. Set a non-empty array first to establish the type.`,
    );
    return false;
  }

  const typeName = getTypeName(value);
  if (typeName === null) {
    console.error(
      `[data-layer] Cannot set '${key}': value type is not allowed. ` +
        `Allowed types: string, number, boolean, Vector2D, Vector3D, Vector4D, ` +
        `or homogeneous arrays of those (e.g. number[]).`,
    );
    return false;
  }

  if (existingType && existingType !== typeName) {
    console.error(
      `[data-layer] Type mismatch for key '${key}': ` +
        `expected ${existingType}, got ${typeName}`,
    );
    return false;
  }

  d.storage.set(key, value as DataLayerType);
  if (!existingType) {
    d.typeMap.set(key, typeName);
  }
  return true;
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
      return setDataLayerValue(dataLayer, key, value);
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
 * // Homogeneous arrays are supported (one level deep, single element type):
 * dataLayer.$data.tags = ["fire", "ice"];   // locked to string[]
 * dataLayer.$data.waypoints = [new Vector3D(0, 0, 0)];
 * dataLayer.$data.childIds = [childA.id, childB.id]; // one-to-many via ids
 *
 * // Or use explicit methods
 * DataLayer.set(dataLayer, "health", 100);
 * const health = DataLayer.get(dataLayer, "health");
 *
 * // CAVEAT: assignment is type-validated, but raw in-place mutation through
 * // $data is NOT — e.g. `dataLayer.$data.tags.push(42)` bypasses validation
 * // and can corrupt the array's element type. Use the validated helpers
 * // (DataLayer.push / setAt / removeAt) to mutate stored arrays safely.
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
 * Serializes a single stored value. Vectors become tagged _vectorType objects;
 * arrays are serialized element-by-element; scalars pass through unchanged.
 */
function serializeValue(value: DataLayerType): unknown {
  if (value instanceof Vector2D) {
    return { _vectorType: 'Vector2D', x: value.x, y: value.y };
  }
  if (value instanceof Vector3D) {
    return { _vectorType: 'Vector3D', x: value.x, y: value.y, z: value.z };
  }
  if (value instanceof Vector4D) {
    return {
      _vectorType: 'Vector4D',
      x: value.x,
      y: value.y,
      z: value.z,
      w: value.w,
    };
  }
  if (Array.isArray(value)) {
    return value.map((element) => serializeValue(element as DataLayerType));
  }
  return value;
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
    storageObj[key] = serializeValue(value);
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
      // Reconstructs a serialized value: tagged vectors become Vector
      // instances, arrays are reconstructed element-by-element, scalars pass
      // through. Returns { ok: false } when a value must be skipped (an
      // UNKNOWN_VECTOR_TYPE error is pushed for the offending key).
      const reconstruct = (
        value: unknown,
        key: string,
      ): { ok: true; value: DataLayerType } | { ok: false } => {
        if (Array.isArray(value)) {
          const out: DataLayerType[] = [];
          for (const element of value) {
            const result = reconstruct(element, key);
            if (!result.ok) return { ok: false };
            out.push(result.value);
          }
          return { ok: true, value: out as DataLayerType };
        }

        if (value && typeof value === 'object' && '_vectorType' in value) {
          const vectorData = value as {
            _vectorType: string;
            x: number;
            y: number;
            z?: number;
            w?: number;
          };

          if (vectorData._vectorType === 'Vector2D') {
            return {
              ok: true,
              value: new Vector2D(vectorData.x, vectorData.y),
            };
          }
          if (vectorData._vectorType === 'Vector3D') {
            return {
              ok: true,
              value: new Vector3D(vectorData.x, vectorData.y, vectorData.z!),
            };
          }
          if (vectorData._vectorType === 'Vector4D') {
            return {
              ok: true,
              value: new Vector4D(
                vectorData.x,
                vectorData.y,
                vectorData.z!,
                vectorData.w!,
              ),
            };
          }

          errors.push({
            code: 'UNKNOWN_VECTOR_TYPE',
            message: `data-layer "${componentName}" key "${key}" has unknown vector type "${vectorData._vectorType}"; skipped`,
          });
          return { ok: false };
        }

        return { ok: true, value: value as DataLayerType };
      };

      for (const key in storage) {
        const result = reconstruct(storage[key], key);
        if (result.ok) {
          dataLayer.storage.set(key, result.value);
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
export const PROPERTY_ALLOWLIST: string[] = ['storage', 'typeMap', '$data'];
