import { builder as nexus } from './nexus'
let COMPONENT_COUNT = 0;

export type COMPONENT_TYPE = "nexus";
type builder = (options: ComponentOptions) => Component;

const BUILDERS: Record<COMPONENT_TYPE, builder> = {
  nexus
};

export interface ComponentOptions {
  name: string;
}

export interface Component {
  name: string;
  type: COMPONENT_TYPE;
  id?: number;
  parent: Component | null;
  _disposed?: boolean;
  unique?: boolean;
  dispose?: () => void;
  update?: () => void;
  init?: () => void;
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
  serialize(component: Component): SerializedData;
  deserialize(data: SerializedData): Component | Promise<Component>;
}
