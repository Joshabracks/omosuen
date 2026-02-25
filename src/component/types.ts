import { BUILDERS, MethodRegistry, PROPERTY_ALLOWLIST } from './registry';
import { queueInit } from '../loop/init';
import { Nexus, NexusT } from './nexus';
import { CameraT } from './camera';
import { CellMapT } from './cell-map';
import { ColliderT } from './collider';
import { DataLayerT } from './data-layer';
import { FlagManagerT } from './flag-manager';
import { InputControllerT } from './input-controller';
import { LightT } from './light';
import { MessengerT } from './messenger';
import { SpriteT } from './sprite';
import { TextureMapT } from './texture-map';
import { TimerT } from './timer';
import { TransformT } from './transform';
import { UIOverlayT } from './ui-overlay';
import { ViewportT } from './viewport';
import { AtlasManagerT } from './atlas-manager';
import { AnimationControllerT } from './animation-controller';
import { AudioManagerT } from './audio-manager';
import { AudioControllerT } from './audio-controller';
import { EventColliderT } from './event-collider';

export type ComponentDataType =
  | AnimationControllerT
  | AtlasManagerT
  | AudioManagerT
  | AudioControllerT
  | CameraT
  | CellMapT
  | ColliderT
  | DataLayerT
  | FlagManagerT
  | InputControllerT
  | LightT
  | MessengerT
  | NexusT
  | SpriteT
  | TextureMapT
  | TimerT
  | TransformT
  | UIOverlayT
  | ViewportT
  | EventColliderT;

/**
 * Registry mapping raw component objects to their Proxy wrappers.
 * This solves the JavaScript limitation where Proxy wrappers are lost
 * when stored as object properties (like component.parent).
 *
 * Using WeakMap ensures:
 * - No memory leaks (entries are GC'd when components are disposed)
 * - Fast O(1) lookup
 * - Components can be used as keys
 */
const PROXY_REGISTRY = new WeakMap<ComponentData, ComponentData>();

/**
 * Gets the Proxy wrapper for a component.
 *
 * This function is needed because when components store references to other
 * components (like parent), the Proxy wrapper is lost and only the raw target
 * object remains. This function retrieves the original Proxy wrapper.
 *
 * @param component - The component (may be raw or already proxied)
 * @returns The proxied version of the component
 *
 * @example
 * ```typescript
 * // In camera init:
 * const parentNexus = castTo<NexusT>(camera.parent!);
 * const viewport = parentNexus.getComponentByName('My Viewport', false);
 * ```
 */
export function castTo<T extends ComponentDataType>(
  component: ComponentData,
): T {
  // Look up in registry - if not found, component might already be a Proxy or never registered
  const proxy = PROXY_REGISTRY.get(component);
  return (proxy || component) as unknown as T;
}

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

import { ComponentUnique } from './constants';
export { ComponentUnique };

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

/**
 * Wraps a raw component object in a Proxy that enables method dispatch
 * via MethodRegistry and property access control via PROPERTY_ALLOWLIST.
 * Registers the proxy in PROXY_REGISTRY for later retrieval via castTo().
 *
 * @param component - Raw component data object (from builder or deserializer)
 * @returns Proxy-wrapped component
 */
export function wrapInProxy(component: ComponentData): ComponentData {
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
    '_initDefer',
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

  // Register the proxy in the registry so it can be retrieved later
  // This is crucial for components that store references to other components
  PROXY_REGISTRY.set(component, proxy);

  return proxy;
}

export async function newComponent(
  type: COMPONENT_TYPE,
  options: ComponentOptions,
  parent: NexusT | null = null,
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

  const proxy = wrapInProxy(component);
  if (parent) {
    Nexus.addComponent(parent, proxy);
  }

  return proxy;
}

// Type alias for serialized component data
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SerializedData = Record<string, any>;

export interface ComponentSerializer {
  serialize(component: ComponentData): SerializedData;
  deserialize(data: SerializedData): ComponentData | Promise<ComponentData>;
}
