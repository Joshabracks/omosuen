import { ComponentData, ComponentMethods, ComponentUnique } from '../types';
import { MethodRegistry } from '../registry';
import { NexusT } from './data';

export interface NexusMethods extends ComponentMethods {
  addComponent: (n: NexusT, component: ComponentData) => void;
  addComponents: (
    n: NexusT,
    components: ComponentData[] | { [index: string]: ComponentData },
  ) => void;
  getComponentById: (
    n: NexusT,
    id: number,
    recursive?: boolean,
  ) => ComponentData | null;
  getComponentByType: (
    n: NexusT,
    type: string,
    recursive?: boolean,
  ) => ComponentData | null;
  getComponentsByType: (
    n: NexusT,
    type: string,
    recursive?: boolean,
  ) => ComponentData[];
  getComponentByName: (
    n: NexusT,
    name: string,
    recursive?: boolean,
  ) => ComponentData | null;
  getComponentsByName: (
    n: NexusT,
    name: string,
    recursive?: boolean,
  ) => ComponentData[];
  getComponentByTypeAndName: (
    n: NexusT,
    type: string,
    name: string,
    recursive?: boolean,
  ) => ComponentData | null;
  getComponentsByTypeAndName: (
    n: NexusT,
    type: string,
    name: string,
    recursive?: boolean,
  ) => ComponentData[];
  dispose: (component: ComponentData) => void;
}

export const Nexus: NexusMethods = {
  type: 'nexus',
  addComponent: (n: NexusT, component: ComponentData) => {
    if (component.unique === ComponentUnique.LOCAL) {
      // LOCAL: Dispose existing components of same type in THIS Nexus only
      const existing = n.components.filter((c) => c.type === component.type);
      existing.forEach((c) => {
        const C = MethodRegistry[c.type];
        if (C.dispose && typeof C.dispose === 'function') {
          C.dispose(c);
        }
      });

      // Remove them from the components array
      n.components = n.components.filter((c) => c.type !== component.type);
    } else if (component.unique === ComponentUnique.GLOBAL) {
      // GLOBAL: Dispose ALL instances in entire scene hierarchy
      // Find root nexus by traversing up the parent chain
      let root: ComponentData = n;
      while (root.parent && root.parent.type === 'nexus') {
        root = root.parent;
      }

      // Recursively find and dispose all instances of this type in entire scene
      const allInstances = Nexus.getComponentsByType(
        root as NexusT,
        component.type,
        true,
      );
      allInstances.forEach((c) => {
        const C = MethodRegistry[c.type];
        if (C.dispose && typeof C.dispose === 'function') {
          C.dispose(c);
        }
      });

      // Note: Disposed components are automatically removed from their parent Nexus
      // during the dispose process or will be filtered out as _disposed
    }

    component.parent = n;
    n.components.push(component);
  },
  addComponents: (
    n: NexusT,
    components: ComponentData[] | { [index: string]: ComponentData },
  ) => {
    switch (components.constructor.name) {
      case 'Object':
        for (const key in components) {
          Nexus.addComponent(
            n,
            (components as Record<string, ComponentData>)[key],
          );
        }
        break;
      case 'Array':
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
  getComponentByType: (n: NexusT, type: string, recursive: boolean = false) => {
    const match = n.components.find((c) => c.type === type);
    if (match || !recursive) return match ?? null;

    // Recurse into child nexuses only (no intermediate array allocation)
    for (let i = 0; i < n.components.length; i++) {
      const c = n.components[i];
      if (c.type !== 'nexus') continue;
      const childMatch = Nexus.getComponentByType(c as NexusT, type, true);
      if (childMatch) return childMatch;
    }
    return null;
  },
  getComponentsByType: (
    n: NexusT,
    type: string,
    recursive: boolean = false,
  ) => {
    const matches: ComponentData[] = [];

    // Collect matches in this nexus (no filter allocation)
    for (let i = 0; i < n.components.length; i++) {
      const c = n.components[i];
      if (c.type === type) matches.push(c);
    }

    if (!recursive) return matches;

    // Recurse into child nexuses only (no intermediate array, no spread operator)
    for (let i = 0; i < n.components.length; i++) {
      const c = n.components[i];
      if (c.type !== 'nexus') continue;
      const childMatches = Nexus.getComponentsByType(c as NexusT, type, true);
      for (let j = 0; j < childMatches.length; j++) {
        matches.push(childMatches[j]);
      }
    }
    return matches;
  },
  getComponentByName: (n: NexusT, name: string, recursive: boolean = false) => {
    const match = n.components.find((c) => c.name === name);
    if (match || !recursive) return match ?? null;

    // Recurse into child nexuses only (no intermediate array allocation)
    for (let i = 0; i < n.components.length; i++) {
      const c = n.components[i];
      if (c.type !== 'nexus') continue;
      const childMatch = Nexus.getComponentByName(c as NexusT, name, true);
      if (childMatch) return childMatch;
    }
    return null;
  },
  getComponentsByName: (
    n: NexusT,
    name: string,
    recursive: boolean = false,
  ) => {
    const matches: ComponentData[] = [];

    // Collect matches in this nexus (no filter allocation)
    for (let i = 0; i < n.components.length; i++) {
      const c = n.components[i];
      if (c.name === name) matches.push(c);
    }

    if (!recursive) return matches;

    // Recurse into child nexuses only (no intermediate array, no spread operator)
    for (let i = 0; i < n.components.length; i++) {
      const c = n.components[i];
      if (c.type !== 'nexus') continue;
      const childMatches = Nexus.getComponentsByName(c as NexusT, name, true);
      for (let j = 0; j < childMatches.length; j++) {
        matches.push(childMatches[j]);
      }
    }
    return matches;
  },
  getComponentByTypeAndName: (
    n: NexusT,
    type: string,
    name: string,
    recursive: boolean = false,
  ) => {
    const match = n.components.find((c) => c.type === type && c.name === name);
    if (match || !recursive) return match ?? null;

    // Recurse into child nexuses only (no intermediate array allocation)
    for (let i = 0; i < n.components.length; i++) {
      const c = n.components[i];
      if (c.type !== 'nexus') continue;
      const childMatch = Nexus.getComponentByTypeAndName(
        c as NexusT,
        type,
        name,
        true,
      );
      if (childMatch) return childMatch;
    }
    return null;
  },
  getComponentsByTypeAndName: (
    n: NexusT,
    type: string,
    name: string,
    recursive: boolean = false,
  ) => {
    const matches: ComponentData[] = [];

    // Collect matches in this nexus (no filter allocation)
    for (let i = 0; i < n.components.length; i++) {
      const c = n.components[i];
      if (c.type === type && c.name === name) matches.push(c);
    }

    if (!recursive) return matches;

    // Recurse into child nexuses only (no intermediate array, no spread operator)
    for (let i = 0; i < n.components.length; i++) {
      const c = n.components[i];
      if (c.type !== 'nexus') continue;
      const childMatches = Nexus.getComponentsByTypeAndName(
        c as NexusT,
        type,
        name,
        true,
      );
      for (let j = 0; j < childMatches.length; j++) {
        matches.push(childMatches[j]);
      }
    }
    return matches;
  },
  getComponentById: (n: NexusT, id: number, recursive: boolean = false) => {
    const match = n.components.find((c) => c.id === id);
    if (match || !recursive) return match ?? null;

    // Recurse into child nexuses only (no intermediate array allocation)
    for (let i = 0; i < n.components.length; i++) {
      const c = n.components[i];
      if (c.type !== 'nexus') continue;
      const childMatch = Nexus.getComponentById(c as NexusT, id, true);
      if (childMatch) return childMatch;
    }
    return null;
  },
  dispose: (component: ComponentData) => {
    const n = component as NexusT;
    // Recursively dispose all child components (depth-first)
    n.components.forEach((c) => {
      const C = MethodRegistry[c.type];
      if (C.dispose && typeof C.dispose === 'function') {
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
