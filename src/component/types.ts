import { BUILDERS, MethodRegistry, PROPERTY_ALLOWLIST } from './registry';
import { queueInit } from '../loop/init';

let COMPONENT_COUNT = 0;

/**
 * Resets the component ID counter.
 * Used when loading serialized scenes to ensure predictable IDs.
 */
export function resetComponentCount(): void {
  COMPONENT_COUNT = 0;
}

/**
 * Sets the component ID counter to a specific value.
 * Used after deserialization to continue ID generation from the highest deserialized ID.
 *
 * @param count - The new counter value
 */
export function setComponentCount(count: number): void {
  COMPONENT_COUNT = count;
}

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
  | 'image-registry'
  | 'atlas-manager'
  | 'sprite'
  | 'transform'
  | 'animation-controller';

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
}

export interface ComponentMethods {
  type: COMPONENT_TYPE;
  dispose?: (component: ComponentData) => void;
  update?: (component: ComponentData, deltaTime: number) => void;
  init?: (component: ComponentData) => void;
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
    component: ComponentData,
    ...args: infer Args
  ) => infer Return
    ? (...args: Args) => Return
    : never;
};

export async function newComponent(
  type: COMPONENT_TYPE,
  options: ComponentOptions,
): Promise<ComponentData | null> {
  const builder = BUILDERS[type];
  if (!builder) {
    console.error(
      `[NEW COMPONENT ERROR] component type ${type} does not exist`,
    );
    return null;
  }
  const component = (await builder(options)) as ComponentData;
  if (!component) {
    console.error(
      `[NEW COMPONENT ERROR] component named ${options.name} failed to build`,
    );
    return null;
  }
  component.id = COMPONENT_COUNT++;

  // Preserve ComponentData base fields from options
  if (options.overrideKey !== undefined) {
    component.overrideKey = options.overrideKey;
  }
  if (options.updateOverride !== undefined) {
    component.updateOverride = options.updateOverride;
  }

  // Automatically queue for initialization
  queueInit(component.id);

  const proxyKeys = Object.keys(MethodRegistry[component.type]);

  // Base ComponentData properties (always allowed)
  const baseProperties = [
    'name',
    'type',
    'id',
    'parent',
    '_disposed',
    'loader',
    'unique',
    'overrideKey',
    'updateOverride',
    '_initialized',
  ];

  // Component-specific properties
  const componentAllowlist = PROPERTY_ALLOWLIST[component.type] || [];

  const handler = {
    get: function (c: ComponentData, prop: string) {
      // Handle Promise detection (JavaScript checks for .then when awaiting)
      if (prop === 'then' || prop === 'catch' || prop === 'finally') {
        return undefined;
      }

      // Check if property is allowed (base or component-specific)
      if (baseProperties.includes(prop) || componentAllowlist.includes(prop)) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        return c[prop];
      }

      // Check if it's a method
      if (proxyKeys.indexOf(prop) === -1) {
        console.error(
          `${c.type} has no method named ${prop}. Available methods: ${proxyKeys.join(', ')}`,
        );
        // return do nothing func for graceful failure
        return () => {};
      }

      // Return method wrapper
      return (...args: unknown[]) => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
        return MethodRegistry[c.type][prop](c, ...args);
      };
    },
  };

  const proxy = new Proxy(component, handler);
  return proxy;
}

// Type alias for serialized component data
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SerializedData = Record<string, any>;

export interface ComponentSerializer {
  serialize(component: ComponentData): SerializedData;
  deserialize(data: SerializedData): ComponentData | Promise<ComponentData>;
}
