import { ComponentData, ComponentMethods } from '../types';
import { DataLayerT, DataLayerType } from './data';
import { Vector2D, Vector3D, Vector4D } from '../../math';

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
    const existingType = d.typeMap.get(key);
    if (existingType && existingType !== typeName) {
      console.error(
        `[data-layer] Type mismatch for key '${key}': ` +
          `expected ${existingType}, got ${typeName}`,
      );
      return false;
    }

    // Store value and type
    d.storage.set(key, value);
    if (!existingType) {
      d.typeMap.set(key, typeName);
    }

    return true;
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
