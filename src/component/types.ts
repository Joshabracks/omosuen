import { BUILDERS, registerComponentMethod } from "./registry";
import { queueInit } from "../loop/init";

let COMPONENT_COUNT = 0;

export type COMPONENT_TYPE = "nexus" | "ui-overlay" | "data-layer";

export interface ComponentOptions {
  name: string;
  overrideKey?: string;
  update?: (deltaTime: number) => void
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
  updateOverride?: string;
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

  // Register custom update method if provided
  if (options.update && typeof options.update === 'function') {
    // Generate unique key for this component's update method
    const updateKey = `${component.name}-${component.id}-update`;

    // Create wrapper that matches ComponentMethods.update signature
    const updateWrapper = (_comp: ComponentData, deltaTime: number) => {
      // Call the user's update function with deltaTime only
      // The component is available via closure
      options.update!(deltaTime);
    };

    // Register the method
    registerComponentMethod(type, updateKey, updateWrapper);

    // Store the key so we can find it later
    component.updateOverride = updateKey;
  }

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
