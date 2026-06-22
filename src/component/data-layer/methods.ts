import { ComponentData, ComponentMethods } from '../types';
import {
  DataLayerT,
  DataLayerType,
  DataLayerScalar,
  getTypeName,
  getScalarTypeName,
  elementTypeOf,
  setDataLayerValue,
} from './data';

/**
 * Methods interface for data-layer component.
 * Provides type-safe method signatures for the $ Proxy.
 */
export interface DataLayerMethods extends ComponentMethods {
  set: (d: DataLayerT, key: string, value: DataLayerType) => boolean;
  get: (d: DataLayerT, key: string) => DataLayerType | null;
  has: (d: DataLayerT, key: string) => boolean;
  delete: (d: DataLayerT, key: string) => boolean;
  setAll: (d: DataLayerT, data: Record<string, unknown>) => void;
  getAll: (d: DataLayerT, keys: string[]) => Record<string, DataLayerType>;
  push: (d: DataLayerT, key: string, value: DataLayerScalar) => boolean;
  setAt: (
    d: DataLayerT,
    key: string,
    index: number,
    value: DataLayerScalar,
  ) => boolean;
  getAt: (d: DataLayerT, key: string, index: number) => DataLayerScalar | null;
  removeAt: (d: DataLayerT, key: string, index: number) => boolean;
  arrayLength: (d: DataLayerT, key: string) => number | null;
  dispose: (component: ComponentData) => void;
}

/**
 * Static methods object for data-layer component.
 * Provides explicit method-based access to data-layer functionality.
 *
 * @example
 * ```typescript
 * const dataLayer = await newComponent("data-layer", { name: "Stats" });
 *
 * // Set values
 * DataLayer.set(dataLayer, "health", 100);
 * DataLayer.set(dataLayer, "position", new Vector3D(10, 20, 30));
 *
 * // Get values
 * const health = DataLayer.get(dataLayer, "health");
 *
 * // Check existence
 * if (DataLayer.has(dataLayer, "health")) { }
 *
 * // Batch operations
 * DataLayer.setAll(dataLayer, { health: 100, speed: 5.5 });
 * const stats = DataLayer.getAll(dataLayer, ["health", "speed"]);
 *
 * // Homogeneous arrays (one level deep, single element type):
 * DataLayer.set(dataLayer, "tags", ["fire", "ice"]); // locked to string[]
 * DataLayer.push(dataLayer, "tags", "lightning");     // validated append
 * DataLayer.setAt(dataLayer, "tags", 0, "water");     // validated element set
 * DataLayer.getAt(dataLayer, "tags", 1);              // "ice"
 * DataLayer.removeAt(dataLayer, "tags", 0);
 * DataLayer.arrayLength(dataLayer, "tags");           // 2
 *
 * // Note: an empty array can only be assigned once an element type is known.
 * // The first set of a fresh key must be a non-empty array.
 * // Use push/setAt/removeAt rather than mutating arrays in place via $data,
 * // which bypasses type validation.
 *
 * // Delete
 * DataLayer.delete(dataLayer, "health");
 *
 * // Or use via $ Proxy
 * $.set(dataLayer, "health", 100);
 * ```
 */
export const DataLayer: DataLayerMethods = {
  type: 'data-layer',

  /**
   * Sets a value in the data-layer.
   * Validates type and enforces type consistency for each key.
   *
   * @param d - The data-layer component
   * @param key - The key to set
   * @param value - The value to store (must be a valid DataLayerType)
   * @returns true if successful, false if type validation fails
   *
   * @example
   * ```typescript
   * DataLayer.set(dataLayer, "health", 100);  // ✓ Sets health to 100
   * DataLayer.set(dataLayer, "health", "text");  // ✗ Fails - type mismatch
   * ```
   */
  set: (d: DataLayerT, key: string, value: DataLayerType): boolean => {
    return setDataLayerValue(d, key, value);
  },

  /**
   * Gets a value from the data-layer.
   *
   * @param d - The data-layer component
   * @param key - The key to retrieve
   * @returns The stored value, or null if the key doesn't exist
   *
   * @example
   * ```typescript
   * const health = DataLayer.get(dataLayer, "health");
   * if (health !== null) {
   *   console.log("Health:", health);
   * }
   * ```
   */
  get: (d: DataLayerT, key: string): DataLayerType | null => {
    return d.storage.get(key) ?? null;
  },

  /**
   * Checks if a key exists in the data-layer.
   *
   * @param d - The data-layer component
   * @param key - The key to check
   * @returns true if the key exists, false otherwise
   *
   * @example
   * ```typescript
   * if (DataLayer.has(dataLayer, "health")) {
   *   console.log("Player has health stat");
   * }
   * ```
   */
  has: (d: DataLayerT, key: string): boolean => {
    return d.storage.has(key);
  },

  /**
   * Deletes a key-value pair from the data-layer.
   *
   * @param d - The data-layer component
   * @param key - The key to delete
   * @returns true if the key was deleted, false if it didn't exist
   *
   * @example
   * ```typescript
   * DataLayer.delete(dataLayer, "health");
   * ```
   */
  delete: (d: DataLayerT, key: string): boolean => {
    const existed = d.storage.has(key);
    d.storage.delete(key);
    d.typeMap.delete(key);
    return existed;
  },

  /**
   * Sets multiple key-value pairs at once.
   * Invalid entries are logged as warnings and skipped.
   *
   * @param d - The data-layer component
   * @param data - Record of key-value pairs to set
   *
   * @example
   * ```typescript
   * DataLayer.setAll(dataLayer, {
   *   health: 100,
   *   speed: 5.5,
   *   isAlive: true,
   *   position: new Vector3D(10, 20, 30)
   * });
   * ```
   */
  setAll: (d: DataLayerT, data: Record<string, unknown>): void => {
    for (const key in data) {
      const value = data[key];
      const typeName = getTypeName(value);

      if (typeName === null) {
        console.warn(
          `[data-layer] Skipping key '${key}' in setAll: invalid type`,
        );
        continue;
      }

      // Use the set method for type enforcement
      DataLayer.set(d, key, value as DataLayerType);
    }
  },

  /**
   * Gets multiple values at once, returning a record of key-value pairs.
   * Keys that don't exist are omitted from the result.
   *
   * @param d - The data-layer component
   * @param keys - Array of keys to retrieve
   * @returns Record containing the requested key-value pairs
   *
   * @example
   * ```typescript
   * const stats = DataLayer.getAll(dataLayer, ["health", "speed", "nonexistent"]);
   * // Returns: { health: 100, speed: 5.5 }
   * // "nonexistent" is omitted
   * ```
   */
  getAll: (d: DataLayerT, keys: string[]): Record<string, DataLayerType> => {
    const result: Record<string, DataLayerType> = {};

    for (const key of keys) {
      const value = d.storage.get(key);
      if (value !== undefined) {
        result[key] = value;
      }
    }

    return result;
  },

  /**
   * Appends an element to an array-valued key (the validated mutation path).
   * If the key is new, it is created as an array locked to the element's type.
   * Rejects elements whose type does not match the key's locked element type.
   *
   * @param d - The data-layer component
   * @param key - The array key to append to
   * @param value - The scalar/vector element to append
   * @returns true if appended, false on a type mismatch or non-array key
   *
   * @example
   * ```typescript
   * DataLayer.push(dataLayer, "tags", "fire");   // creates string[]
   * DataLayer.push(dataLayer, "tags", "ice");    // ["fire", "ice"]
   * DataLayer.push(dataLayer, "tags", 42);       // ✗ rejected (expects string)
   * ```
   */
  push: (d: DataLayerT, key: string, value: DataLayerScalar): boolean => {
    const elementType = getScalarTypeName(value);
    if (elementType === null) {
      console.error(
        `[data-layer] Cannot push to '${key}': value is not a valid ` +
          `scalar/vector element.`,
      );
      return false;
    }

    const existingType = d.typeMap.get(key);
    if (existingType) {
      if (!existingType.endsWith('[]')) {
        console.error(
          `[data-layer] Cannot push to '${key}': key is not an array ` +
            `(type ${existingType}).`,
        );
        return false;
      }
      if (elementTypeOf(existingType) !== elementType) {
        console.error(
          `[data-layer] Type mismatch pushing to '${key}': ` +
            `expected ${elementTypeOf(existingType)}, got ${elementType}`,
        );
        return false;
      }
      (d.storage.get(key) as DataLayerScalar[]).push(value);
      return true;
    }

    // New key: create the array and lock it to this element type.
    d.storage.set(key, [value] as DataLayerType);
    d.typeMap.set(key, `${elementType}[]`);
    return true;
  },

  /**
   * Sets the element at `index` of an array-valued key, validating the element
   * type and bounds. Does not grow the array (use push to append).
   *
   * @param d - The data-layer component
   * @param key - The array key
   * @param index - The index to set (must be within bounds)
   * @param value - The scalar/vector element to store
   * @returns true if set, false on type mismatch, non-array key, or bad index
   */
  setAt: (
    d: DataLayerT,
    key: string,
    index: number,
    value: DataLayerScalar,
  ): boolean => {
    const existingType = d.typeMap.get(key);
    if (!existingType || !existingType.endsWith('[]')) {
      console.error(
        `[data-layer] Cannot setAt on '${key}': key is not an array.`,
      );
      return false;
    }

    const arr = d.storage.get(key) as DataLayerScalar[] | undefined;
    if (!arr || index < 0 || index >= arr.length) {
      console.error(
        `[data-layer] setAt index ${index} out of bounds for '${key}'.`,
      );
      return false;
    }

    const elementType = getScalarTypeName(value);
    if (elementType !== elementTypeOf(existingType)) {
      console.error(
        `[data-layer] Type mismatch in setAt '${key}': ` +
          `expected ${elementTypeOf(existingType)}, got ${elementType}`,
      );
      return false;
    }

    arr[index] = value;
    return true;
  },

  /**
   * Reads the element at `index` of an array-valued key.
   *
   * @param d - The data-layer component
   * @param key - The array key
   * @param index - The index to read
   * @returns The element, or null if the key is not an array or index is out of bounds
   */
  getAt: (
    d: DataLayerT,
    key: string,
    index: number,
  ): DataLayerScalar | null => {
    const arr = d.storage.get(key);
    if (!Array.isArray(arr) || index < 0 || index >= arr.length) {
      return null;
    }
    return arr[index] as DataLayerScalar;
  },

  /**
   * Removes the element at `index` of an array-valued key, shifting the rest down.
   *
   * @param d - The data-layer component
   * @param key - The array key
   * @param index - The index to remove
   * @returns true if removed, false on non-array key or bad index
   */
  removeAt: (d: DataLayerT, key: string, index: number): boolean => {
    const arr = d.storage.get(key);
    if (!Array.isArray(arr) || index < 0 || index >= arr.length) {
      console.error(
        `[data-layer] removeAt index ${index} out of bounds for '${key}'.`,
      );
      return false;
    }
    arr.splice(index, 1);
    return true;
  },

  /**
   * Returns the length of an array-valued key, or null if the key is not an array.
   *
   * @param d - The data-layer component
   * @param key - The array key
   * @returns The array length, or null
   */
  arrayLength: (d: DataLayerT, key: string): number | null => {
    const arr = d.storage.get(key);
    return Array.isArray(arr) ? arr.length : null;
  },

  /**
   * Disposes the data-layer component, clearing all stored data.
   *
   * @param component - The component to dispose
   */
  dispose: (component: ComponentData): void => {
    const d = component as DataLayerT;

    // Clear all storage
    d.storage.clear();
    d.typeMap.clear();

    // Mark as disposed
    d._disposed = true;
  },
};
