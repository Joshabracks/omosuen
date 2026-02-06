import {
  ComponentData,
  ComponentOptions,
  ComponentSerializer,
  ComponentUnique,
  ComponentInstanceMethods,
} from '../types';
import type { NexusMethods } from './methods';

export interface nexus
  extends ComponentData, ComponentInstanceMethods<NexusMethods> {
  type: 'nexus';
  unique: ComponentUnique.FALSE;
  components: ComponentData[];
  paused: boolean;
}

export function builder(options: ComponentOptions): nexus {
  // Create data-only object. Methods will be added by Proxy wrapper in newComponent()
  const nexus = {
    type: 'nexus' as const,
    name: options.name,
    unique: ComponentUnique.FALSE,
    parent: null,
    _disposed: false,
    components: [],
    paused: false,
  };
  return nexus as unknown as nexus;
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
    type: 'nexus',
    name: nexus.name,
    unique: ComponentUnique.FALSE,
    components: serializedComponents,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deserialize(data: any): nexus {
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

/**
 * Allowlist of nexus-specific properties accessible via component Proxy.
 * These properties can be accessed directly without triggering method lookup.
 */
export const PROPERTY_ALLOWLIST: string[] = ['components', 'paused'];
