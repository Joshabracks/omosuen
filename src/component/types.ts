import { Nexus, builder as nexusBuilder } from "./nexus";
import type { NexusMethods } from "./nexus/methods";
import { UIOverlay, builder as uiOverlayBuilder } from "./ui-overlay";
import type { UIOverlayMethods } from "./ui-overlay";

let COMPONENT_COUNT = 0;

export type COMPONENT_TYPE = "nexus" | "ui-overlay";

export interface ComponentOptions {
  name: string;
}

type builder = (options: ComponentOptions) => ComponentData;

const BUILDERS: Record<COMPONENT_TYPE, builder> = {
  nexus: nexusBuilder,
  "ui-overlay": uiOverlayBuilder
};

export const ComponentMethod: Record<COMPONENT_TYPE, ComponentMethods> = {
  nexus: Nexus,
  "ui-overlay": UIOverlay
};

/**
 * Extract method signatures from component methods (exclude 'type' property)
 * This utility type removes the 'type' property and keeps all method signatures
 */
type ExtractMethods<T> = {
  [K in keyof T as K extends "type" ? never : K]: T[K];
};

/**
 * Union of all component method signatures available through the $ Proxy helper
 * As new components are added, their method types should be added to this union
 */
type ProxyMethodSignatures = ExtractMethods<NexusMethods>;

const methodTypeCache: Record<string, Record<string, Function>> = {};

export function invalidateMethodCache(): void {
  for (let key in methodTypeCache) {
    delete methodTypeCache[key];
  }
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

export interface ComponentData {
  name: string;
  type: COMPONENT_TYPE;
  id?: number;
  parent: ComponentData | null;
  _disposed?: boolean;
  unique?: boolean;
}

export interface ComponentMethods {
  type: COMPONENT_TYPE;
  dispose?: (component: ComponentData) => void;
  update?: (component: ComponentData) => void;
  init?: (component: ComponentData) => void;
}

export async function newComponent(
  type: COMPONENT_TYPE,
  options: ComponentOptions,
) {
  const builder = BUILDERS[type];
  if (!builder) {
    console.error(
      `[NEW COMPONENT ERROR] component type ${type} does not exist`,
    );
    return null;
  }
  const component = await builder(options);
  if (!component) {
    console.error(
      `[NEW COMPONENT ERROR] component named ${options.name} failed to build`,
    );
    return null;
  }
  component.id = COMPONENT_COUNT++;
  return component;
}

// Type alias for serialized component data
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SerializedData = Record<string, any>;

export interface ComponentSerializer {
  serialize(component: ComponentData): SerializedData;
  deserialize(data: SerializedData): ComponentData | Promise<ComponentData>;
}
