import { Component, ComponentOptions, ComponentSerializer } from '../'

export interface Nexus extends Component {
  type: 'nexus';
  unique: false;
  components: Component[];
  paused: boolean;
  addComponent: (component: Component) => void;
  addComponents: (components: Component[]) => void;
  getComponentById: (id: number, recursive?: boolean) => Component | undefined;
  getComponentsById: (id: number, recursive?: boolean) => Component[]
  getComponentByType: (type: string, recursive?: boolean) => Component | undefined;
  getComponentsByType: (type: string, recursive?: boolean) => Component[];
  getComponentByName: (name: string, recursive?: boolean) => Component | undefined;
  getComponentsByName: (name: string, recursive?: boolean) => Component[];
  getComponentByTypeAndName: (
    type: string,
    name: string,
    recursive?: boolean
  ) => Component | undefined;
  getComponentsByTypeAndName: (type: string, name: string, recursive?: boolean) => Component[];
  dispose: () => void;
}

export function builder(options: ComponentOptions): Nexus {
  const nexus: Nexus = {
    type: 'nexus',
    name: options.name,
    unique: false,
    parent: null,
    _disposed: false,
    components: [],
    paused: false,
    addComponent: (component: Component) => {
      if (component.unique) {
        // Find and dispose existing components of the same type
        const existing = nexus.components.filter((c) => c.type === component.type);
        existing.forEach((c) => {
          if (c.dispose && typeof c.dispose === 'function') {
            c.dispose();
          }
        });

        // Remove them from the components array
        nexus.components = nexus.components.filter((c) => c.type !== component.type);
      }
      component.parent = nexus;
      nexus.components.push(component);
    },
    addComponents: (components: Component[] | { [index: string]: Component }) => {
      switch (components.constructor.name) {
        case 'object':
          for (const key in components) {
            // @ts-ignore
            nexus.addComponent(components[key]);
          }
          break;
        case 'Array':
          (components as Component[]).forEach((component: Component) =>
            nexus.addComponent(component)
          );
          break;
        default:
          throw new Error(`Invalid components type: ${components.constructor.name}`);
      }
    },
    getComponentByType: (type: string, recursive: boolean = false) => {
      const match = nexus.components.find((c) => c.type === type);
      if (match || !recursive) return match;

      const childNexuses = nexus.components.filter((c) => c.type === 'nexus') as Nexus[];
      for (let i = 0; i < childNexuses.length; i++) {
        const childMatch = childNexuses[i].getComponentByType(type, true);
        if (childMatch) return childMatch;
      }
      return undefined;
    },
    getComponentsByType: (type: string, recursive: boolean = false) => {
      const matches = nexus.components.filter((c) => c.type === type);
      if (!recursive) return matches;

      const childNexuses = nexus.components.filter((c) => c.type === 'nexus') as Nexus[];
      for (const childNexus of childNexuses) {
        matches.push(...childNexus.getComponentsByType(type, true));
      }
      return matches;
    },
    getComponentByName: (name: string, recursive: boolean = false) => {
      const match = nexus.components.find((c) => c.name === name);
      if (match || !recursive) return match;

      const childNexuses = nexus.components.filter((c) => c.type === 'nexus') as Nexus[];
      for (let i = 0; i < childNexuses.length; i++) {
        const childMatch = childNexuses[i].getComponentByName(name, true);
        if (childMatch) return childMatch;
      }
      return undefined;
    },
    getComponentsByName: (name: string, recursive: boolean = false) => {
      const matches = nexus.components.filter((c) => c.name === name);
      if (!recursive) return matches;

      const childNexuses = nexus.components.filter((c) => c.type === 'nexus') as Nexus[];
      for (const childNexus of childNexuses) {
        matches.push(...childNexus.getComponentsByName(name, true));
      }
      return matches;
    },
    getComponentByTypeAndName: (type: string, name: string, recursive: boolean = false) => {
      const match = nexus.components.find((c) => c.type === type && (c.name === name));
      if (match || !recursive) return match;

      const childNexuses = nexus.components.filter((c) => c.type === 'nexus') as Nexus[];
      for (let i = 0; i < childNexuses.length; i++) {
        const childMatch = childNexuses[i].getComponentByTypeAndName(type, name, true);
        if (childMatch) return childMatch;
      }
      return undefined;
    },
    getComponentsByTypeAndName: (type: string, name: string, recursive: boolean = false) => {
      const matches = nexus.components.filter((c) => c.type === type && (c.name === name));
      if (!recursive) return matches;

      const childNexuses = nexus.components.filter((c) => c.type === 'nexus') as Nexus[];
      for (const childNexus of childNexuses) {
        matches.push(...childNexus.getComponentsByTypeAndName(type, name, true));
      }
      return matches;
    },
    getComponentById: (id: number, recursive: boolean = false) => {
      const match = nexus.components.find((c) => c.id === id)
      if (match || !recursive) return match;
      const childNexuses = nexus.components.filter((c) => c.type === 'nexus') as Nexus[];
      for (let i = 0; i < childNexuses.length; i++) {
        const childMatch = childNexuses[i].getComponentById(id, true);
        if (childMatch) return childMatch;
      }
      return undefined;
    },
    getComponentsById: (id: number, recursive: boolean = false) => {
      const matches = nexus.components.filter((c) => c.id === id);
      if (matches.length && !recursive) return matches;
      const childNexuses = nexus.components.filter((c) => c.type === 'nexus') as Nexus[];
      for (const childNexus of childNexuses) {
        matches.push(...childNexus.getComponentsById(id, true))
      }
      return matches;
    },
    dispose: () => {
      // Recursively dispose all child components (depth-first)
      nexus.components.forEach((component) => {
        if (component.dispose) {
          component.dispose();
        } else {
          component._disposed = true;
        }
      });

      // Clear the components array
      nexus.components = [];

      // Mark this Nexus as disposed
      nexus._disposed = true;
    },
  };
  return nexus;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serialize(component: Component): any {
  const nexus = component as Nexus;

  const serializedComponents = [];
  // We'll handle recursive serialization at the main Serializer level
  for (const child of nexus.components) {
    // Just include the component data, main serializer will handle recursion
    serializedComponents.push(child);
  }

  return {
    type: 'nexus',
    name: nexus.name,
    unique: false,
    components: serializedComponents,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deserialize(data: any): Nexus {
  const { type, name } = data;
  const errors = [];
  if (type !== 'nexus') errors.push(`type ${type} does not match "nexus"`);
  if (!name) errors.push(`Nexus requires a name`);
  if (errors.length) throw new Error(errors.join('\n'));

  const nexus = builder({ name });

  // Components will be added separately by the main deserializer
  return nexus;
}

export const NexusSerializer: ComponentSerializer = {
  serialize,
  deserialize,
};
