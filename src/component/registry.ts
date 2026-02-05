import { Nexus, builder as nexusBuilder } from "./nexus";
import type { NexusMethods } from "./nexus/methods";
import { UIOverlay, builder as uiOverlayBuilder } from "./ui-overlay";
import type { UIOverlayMethods } from "./ui-overlay";
import type {
  COMPONENT_TYPE,
  ComponentData,
  ComponentMethods,
} from "./types";

/**
 * Extract method signatures from component methods (exclude 'type' property)
 * This utility type removes the 'type' property and keeps all method signatures
 */
type ExtractMethods<T> = {
  [K in keyof T as K extends "type" ? never : K]: T[K];
};

/**
 * Union of all component method signatures available through the $ Proxy helper
 * As new components are added, their method types should be added to this intersection
 */
type ProxyMethodSignatures = ExtractMethods<NexusMethods> &
  ExtractMethods<UIOverlayMethods>;

export const BUILDERS: Record<COMPONENT_TYPE, Function> = {
  nexus: nexusBuilder,
  "ui-overlay": uiOverlayBuilder,
};

export const ComponentMethod: Record<COMPONENT_TYPE, ComponentMethods> = {
  nexus: Nexus,
  "ui-overlay": UIOverlay,
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

const methodHandler = {
  get: function (
    methodMap: Record<COMPONENT_TYPE, ComponentMethods>,
    prop: string,
  ) {
    if (!methodTypeCache[prop]) {
      const methodTypeMap: Record<string, Function> = {};
      for (let key in methodMap) {
        const methods: ComponentMethods = methodMap[key as COMPONENT_TYPE];
        if (prop in methods) {
          // @ts-ignore
          methodTypeMap[key] = methods[prop];
        }
      }
      methodTypeCache[prop] = methodTypeMap;
    }
    const cachedMethodMap = methodTypeCache[prop];
    const func = <T extends ComponentData>(c: T, ...args: any[]) => {
      const method: Function = cachedMethodMap[c.type];
      if (!method) {
        console.error(
          `Method '${prop}' not found for component type '${c.type}'`,
        );
        return null;
      }
      return method(c, ...args);
    };
    return func;
  },
};

/**
 * Type-safe Proxy helper for calling component methods across all component types.
 * Provides a unified API: $.methodName(component, ...args)
 *
 * The Proxy dynamically routes method calls to the appropriate component implementation
 * based on the component's type property. TypeScript cannot infer this behavior, so we
 * explicitly type it with the union of all component method signatures.
 *
 * @example
 * ```typescript
 * const myNexus = builder({ name: "Player" });
 * $.addComponent(myNexus, childComponent);
 * const found = $.getComponentByName(myNexus, "Enemy", true);
 * ```
 */
export const $ = new Proxy(
  ComponentMethod,
  methodHandler,
) as unknown as ProxyMethodSignatures;
