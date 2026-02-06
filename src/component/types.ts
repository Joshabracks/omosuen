import { BUILDERS } from "./registry";
import { queueInit } from "../loop/init";

let COMPONENT_COUNT = 0;

export type COMPONENT_TYPE = "nexus" | "ui-overlay";

export interface ComponentOptions {
  name: string;
  overrideKey?: string;
}

export interface ComponentData {
  name: string;
  type: COMPONENT_TYPE;
  id?: number;
  parent: ComponentData | null;
  _disposed?: boolean;
  loader?: boolean;
  unique?: boolean;
  overrideKey?: string;
  _initialized?: boolean;
}

export interface ComponentMethods {
  type: COMPONENT_TYPE;
  dispose?: (component: ComponentData) => void;
  update?: (component: ComponentData, deltaTime: number) => void;
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
  const component = await builder(options) as ComponentData;
  if (!component) {
    console.error(
      `[NEW COMPONENT ERROR] component named ${options.name} failed to build`,
    );
    return null;
  }
  component.id = COMPONENT_COUNT++;

  // Automatically queue for initialization
  queueInit(component.id);

  return component;
}

// Type alias for serialized component data
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SerializedData = Record<string, any>;

export interface ComponentSerializer {
  serialize(component: ComponentData): SerializedData;
  deserialize(data: SerializedData): ComponentData | Promise<ComponentData>;
}
