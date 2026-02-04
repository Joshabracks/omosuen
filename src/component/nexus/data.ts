import { ComponentData, ComponentOptions, ComponentSerializer } from "../types";

export interface nexus extends ComponentData {
  type: "nexus";
  unique: false;
  components: ComponentData[];
  paused: boolean;
}

export function builder(options: ComponentOptions): nexus {
  const nexus: nexus = {
    type: "nexus",
    name: options.name,
    unique: false,
    parent: null,
    _disposed: false,
    components: [],
    paused: false,
  };
  return nexus;
}


// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serialize(component: ComponentData): any {
  const nexus = component as nexus;

  const serializedComponents = [];
  // We'll handle recursive serialization at the main Serializer level
  for (const child of nexus.components) {
    // Just include the component data, main serializer will handle recursion
    serializedComponents.push(child);
  }

  return {
    type: "nexus",
    name: nexus.name,
    unique: false,
    components: serializedComponents,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deserialize(data: any): nexus {
  const { type, name } = data;
  const errors = [];
  if (type !== "nexus") errors.push(`type ${type} does not match "nexus"`);
  if (!name) errors.push(`Nexus requires a name`);
  if (errors.length) throw new Error(errors.join("\n"));

  const nexus = builder({ name });

  // Components will be added separately by the main deserializer
  return nexus;
}

export const NexusSerializer: ComponentSerializer = {
  serialize,
  deserialize,
};
