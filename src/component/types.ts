import { Nexus, builder as nexusBuilder } from "./nexus";

let COMPONENT_COUNT = 0;

export type COMPONENT_TYPE = "nexus";

export interface ComponentOptions {
  name: string;
}

type builder = (options: ComponentOptions) => ComponentData;

const BUILDERS: Record<COMPONENT_TYPE, builder> = {
  nexus: nexusBuilder
};

export const ComponentMethod: Record<COMPONENT_TYPE, ComponentMethods> = {
  nexus: Nexus,
};

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
        console.error(`Method '${prop}' not found for component type '${c.type}'`);
        return null;
      }
      return method(c, ...args);
    };
    return func;
  },
};

export const $ = new Proxy(ComponentMethod, methodHandler);

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
