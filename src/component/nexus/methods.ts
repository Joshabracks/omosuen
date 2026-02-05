import {
  ComponentData,
  ComponentMethods,
} from "../types";
import { ComponentMethod } from "../registry";
import { nexus } from "./data";

/**
 * Helper function to extract child nexus components from a nexus.
 * Used by recursive query methods to traverse the hierarchy.
 */
function getChildNexuses(n: nexus): nexus[] {
  return n.components.filter((c) => c.type === "nexus") as nexus[];
}

export interface NexusMethods extends ComponentMethods {
  addComponent: (n: nexus, component: ComponentData) => void;
  addComponents: (
    n: nexus,
    components: ComponentData[] | { [index: string]: ComponentData },
  ) => void;
  getComponentById: (
    n: nexus,
    id: number,
    recursive?: boolean,
  ) => ComponentData | null;
  getComponentsById: (
    n: nexus,
    id: number,
    recursive?: boolean,
  ) => ComponentData[];
  getComponentByType: (
    n: nexus,
    type: string,
    recursive?: boolean,
  ) => ComponentData | null;
  getComponentsByType: (
    n: nexus,
    type: string,
    recursive?: boolean,
  ) => ComponentData[];
  getComponentByName: (
    n: nexus,
    name: string,
    recursive?: boolean,
  ) => ComponentData | null;
  getComponentsByName: (
    n: nexus,
    name: string,
    recursive?: boolean,
  ) => ComponentData[];
  getComponentByTypeAndName: (
    n: nexus,
    type: string,
    name: string,
    recursive?: boolean,
  ) => ComponentData | null;
  getComponentsByTypeAndName: (
    n: nexus,
    type: string,
    name: string,
    recursive?: boolean,
  ) => ComponentData[];
  dispose: (component: ComponentData) => void;
}

export const Nexus: NexusMethods = {
  type: "nexus",
  addComponent: (n: nexus, component: ComponentData) => {
    if (component.unique) {
      // Find and dispose existing components of the same type
      const existing = n.components.filter((c) => c.type === component.type);
      existing.forEach((c) => {
        const C = ComponentMethod[c.type];
        if (C.dispose && typeof C.dispose === "function") {
          C.dispose(c);
        }
      });

      // Remove them from the components array
      n.components = n.components.filter((c) => c.type !== component.type);
    }
    component.parent = n;
    n.components.push(component);
  },
  addComponents: (
    n: nexus,
    components: ComponentData[] | { [index: string]: ComponentData },
  ) => {
    switch (components.constructor.name) {
      case "Object":
        for (const key in components) {
          // @ts-ignore
          Nexus.addComponent(n, components[key]);
        }
        break;
      case "Array":
        (components as ComponentData[]).forEach((component: ComponentData) =>
          Nexus.addComponent(n, component),
        );
        break;
      default:
        throw new Error(
          `Invalid components type: ${components.constructor.name}`,
        );
    }
  },
  getComponentByType: (n: nexus, type: string, recursive: boolean = false) => {
    const match = n.components.find((c) => c.type === type);
    if (match || !recursive) return match ?? null;

    const childNexuses = getChildNexuses(n);
    for (let i = 0; i < childNexuses.length; i++) {
      const childMatch = Nexus.getComponentByType(childNexuses[i], type, true);
      if (childMatch) return childMatch;
    }
    return null;
  },
  getComponentsByType: (n: nexus, type: string, recursive: boolean = false) => {
    const matches = n.components.filter((c) => c.type === type);
    if (!recursive) return matches;

    const childNexuses = getChildNexuses(n);
    for (const childNexus of childNexuses) {
      matches.push(...Nexus.getComponentsByType(childNexus, type, true));
    }
    return matches;
  },
  getComponentByName: (n: nexus, name: string, recursive: boolean = false) => {
    const match = n.components.find((c) => c.name === name);
    if (match || !recursive) return match ?? null;

    const childNexuses = getChildNexuses(n);
    for (let i = 0; i < childNexuses.length; i++) {
      const childMatch = Nexus.getComponentByName(childNexuses[i], name, true);
      if (childMatch) return childMatch;
    }
    return null;
  },
  getComponentsByName: (n: nexus, name: string, recursive: boolean = false) => {
    const matches = n.components.filter((c) => c.name === name);
    if (!recursive) return matches;

    const childNexuses = getChildNexuses(n);
    for (const childNexus of childNexuses) {
      matches.push(...Nexus.getComponentsByName(childNexus, name, true));
    }
    return matches;
  },
  getComponentByTypeAndName: (
    n: nexus,
    type: string,
    name: string,
    recursive: boolean = false,
  ) => {
    const match = n.components.find(
      (c) => c.type === type && c.name === name,
    );
    if (match || !recursive) return match ?? null;

    const childNexuses = getChildNexuses(n);
    for (let i = 0; i < childNexuses.length; i++) {
      const childMatch = Nexus.getComponentByTypeAndName(
        childNexuses[i],
        type,
        name,
        true,
      );
      if (childMatch) return childMatch;
    }
    return null;
  },
  getComponentsByTypeAndName: (
    n: nexus,
    type: string,
    name: string,
    recursive: boolean = false,
  ) => {
    const matches = n.components.filter(
      (c) => c.type === type && c.name === name,
    );
    if (!recursive) return matches;

    const childNexuses = getChildNexuses(n);
    for (const childNexus of childNexuses) {
      matches.push(...Nexus.getComponentsByTypeAndName(childNexus, type, name, true));
    }
    return matches;
  },
  getComponentById: (n: nexus, id: number, recursive: boolean = false) => {
    const match = n.components.find((c) => c.id === id);
    if (match || !recursive) return match ?? null;

    const childNexuses = getChildNexuses(n);
    for (let i = 0; i < childNexuses.length; i++) {
      const childMatch = Nexus.getComponentById(childNexuses[i], id, true);
      if (childMatch) return childMatch;
    }
    return null;
  },
  getComponentsById: (n: nexus, id: number, recursive: boolean = false) => {
    const matches = n.components.filter((c) => c.id === id);
    if (!recursive) return matches;

    const childNexuses = getChildNexuses(n);
    for (const childNexus of childNexuses) {
      matches.push(...Nexus.getComponentsById(childNexus, id, true));
    }
    return matches;
  },
  dispose: (component: ComponentData) => {
    const n = component as nexus;
    // Recursively dispose all child components (depth-first)
    n.components.forEach((c) => {
      const C = ComponentMethod[c.type];
      if (C.dispose && typeof C.dispose === "function") {
        C.dispose(c);
      } else {
        c._disposed = true;
      }
    });

    // Clear the components array
    n.components = [];

    // Mark this Nexus as disposed
    n._disposed = true;
  },
};
