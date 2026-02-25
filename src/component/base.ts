/**
 * Base component type definitions.
 *
 * This is a LEAF module with zero imports from other component modules.
 * All component data.ts files import from here instead of types.ts,
 * which prevents circular dependencies with the registry.
 */

/**
 * Defines the uniqueness constraints for components.
 *
 * - FALSE (0): Multiple instances allowed per Nexus
 * - LOCAL (1): Only one instance per parent Nexus (replaces boolean true)
 * - GLOBAL (2): Only one instance per entire scene hierarchy
 */
export enum ComponentUnique {
  FALSE = 0,
  LOCAL = 1,
  GLOBAL = 2,
}

export type COMPONENT_TYPE =
  | 'nexus'
  | 'ui-overlay'
  | 'data-layer'
  | 'flag-manager'
  | 'messenger'
  | 'viewport'
  | 'texture-map'
  | 'atlas-manager'
  | 'sprite'
  | 'transform'
  | 'animation-controller'
  | 'cell-map'
  | 'camera'
  | 'input-controller'
  | 'collider'
  | 'event-collider'
  | 'timer'
  | 'light'
  | 'audio-manager'
  | 'audio-controller';

export interface ComponentOptions {
  name: string;
  overrideKey?: string;
  updateOverride?: string;
}

export interface ComponentData {
  name: string;
  type: COMPONENT_TYPE;
  id?: number;
  parent: ComponentData | null;
  _disposed?: boolean;
  loader?: boolean;
  unique?: ComponentUnique;
  overrideKey?: string;
  updateOverride?: string;
  _initialized?: boolean;
  _initDefer?: number;
}

export interface ComponentMethods {
  type: COMPONENT_TYPE;
  dispose?: (component: ComponentData) => void;
  update?: (component: ComponentData, deltaTime: number) => void;
  init?: (component: ComponentData) => Promise<void>;
}

/**
 * Converts a component methods interface into instance method signatures.
 * Removes the first parameter (the component itself) from each method,
 * transforming static methods into instance methods for TypeScript typing.
 *
 * This enables full IDE autocomplete and type safety for component method calls
 * (e.g., `nexus.addComponent()`) while maintaining the DOD architecture where
 * methods are stored centrally and dispatched via Proxy at runtime.
 *
 * @example
 * ```typescript
 * // Input: addComponent: (n: nexus, component: ComponentData) => void
 * // Output: addComponent: (component: ComponentData) => void
 * ```
 */
export type ComponentInstanceMethods<T extends ComponentMethods> = {
  [K in keyof T as K extends 'type' ? never : K]: T[K] extends (
    first: infer _First,
    ...args: infer Args
  ) => infer Return
    ? (...args: Args) => Return
    : never;
};

// Type alias for serialized component data
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SerializedData = Record<string, any>;

export interface ComponentSerializer {
  serialize(component: ComponentData): SerializedData;
  deserialize(data: SerializedData): ComponentData | Promise<ComponentData>;
}
