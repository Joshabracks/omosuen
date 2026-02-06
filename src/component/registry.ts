import { Nexus, builder as nexusBuilder, PROPERTY_ALLOWLIST as NexusPropertyAllowlist } from "./nexus";
import { UIOverlay, builder as uiOverlayBuilder, PROPERTY_ALLOWLIST as UIOverlayPropertyAllowlist } from "./ui-overlay";
import { DataLayer, builder as dataLayerBuilder, PROPERTY_ALLOWLIST as DataLayerPropertyAllowlist } from "./data-layer";
import { FlagManager, builder as flagManagerBuilder, PROPERTY_ALLOWLIST as FlagManagerPropertyAllowlist } from "./flag-manager";
import type {
  COMPONENT_TYPE,
  ComponentMethods,
} from "./types";


export const BUILDERS: Record<COMPONENT_TYPE, Function> = {
  nexus: nexusBuilder,
  "ui-overlay": uiOverlayBuilder,
  "data-layer": dataLayerBuilder,
  "flag-manager": flagManagerBuilder,
};

export const ComponentMethod: Record<COMPONENT_TYPE, ComponentMethods> = {
  nexus: Nexus,
  "ui-overlay": UIOverlay,
  "data-layer": DataLayer,
  "flag-manager": FlagManager,
};

/**
 * Registry of component-specific property allowlists.
 * Used by the component Proxy wrapper to distinguish data properties from methods.
 */
export const PROPERTY_ALLOWLIST: Record<COMPONENT_TYPE, string[]> = {
  nexus: NexusPropertyAllowlist,
  "ui-overlay": UIOverlayPropertyAllowlist,
  "data-layer": DataLayerPropertyAllowlist,
  "flag-manager": FlagManagerPropertyAllowlist,
};

const methodTypeCache: Record<string, Record<string, Function>> = {};

export function invalidateMethodCache(): void {
  for (let key in methodTypeCache) {
    delete methodTypeCache[key];
  }
}

/**
 * Registers a custom method for a specific component type.
 * This allows developers to add custom override methods (e.g., custom show/hide for ui-overlay)
 * that can be shared across multiple component instances via an overrideKey.
 *
 * @param type - The component type to register the method for
 * @param key - The unique key for this method (e.g., "fadeButton-show")
 * @param func - The function implementation
 *
 * @example
 * ```typescript
 * registerComponentMethod('ui-overlay', 'fadeButton-show', (u) => {
 *   // Custom fade-in animation
 *   u.container.style.opacity = '0';
 *   u.container.style.display = 'block';
 *   // ... fade animation
 * });
 * ```
 */
export function registerComponentMethod(
  type: COMPONENT_TYPE,
  key: string,
  func: Function,
): void {
  if (!ComponentMethod[type]) {
    console.error(
      `Cannot register method '${key}': component type '${type}' does not exist`,
    );
    return;
  }
  // @ts-ignore - Dynamic method registration
  ComponentMethod[type][key] = func;
  invalidateMethodCache();
}

/**
 * Unregisters a custom method for a specific component type.
 * Use this to clean up custom override methods when they are no longer needed.
 *
 * @param type - The component type to unregister the method from
 * @param key - The unique key for the method to remove
 *
 * @example
 * ```typescript
 * unregisterComponentMethod('ui-overlay', 'fadeButton-show');
 * ```
 */
export function unregisterComponentMethod(
  type: COMPONENT_TYPE,
  key: string,
): void {
  if (!ComponentMethod[type]) {
    console.error(
      `Cannot unregister method '${key}': component type '${type}' does not exist`,
    );
    return;
  }
  // @ts-ignore - Dynamic method access
  delete ComponentMethod[type][key];
  invalidateMethodCache();
}

/**
 * Checks if a custom method exists for a specific component type.
 *
 * @param type - The component type to check
 * @param key - The unique key for the method
 * @returns True if the method exists, false otherwise
 *
 * @example
 * ```typescript
 * if (hasComponentMethod('ui-overlay', 'fadeButton-show')) {
 *   // Method is registered and ready to use
 * }
 * ```
 */
export function hasComponentMethod(type: COMPONENT_TYPE, key: string): boolean {
  if (!ComponentMethod[type]) {
    return false;
  }
  // @ts-ignore - Dynamic method access
  return typeof ComponentMethod[type][key] === "function";
}
