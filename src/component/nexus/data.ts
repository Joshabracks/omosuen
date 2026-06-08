import {
  ComponentData,
  ComponentOptions,
  ComponentSerializer,
  ComponentUnique,
  ComponentInstanceMethods,
  DeserializationError,
  DeserializeResult,
} from '../types';
import type { NexusMethods } from './methods';

export interface NexusT
  extends ComponentData, ComponentInstanceMethods<NexusMethods> {
  type: 'nexus';
  unique: ComponentUnique.FALSE;
  components: ComponentData[];
  paused: boolean;
  script?: string;
}

export function builder(options: ComponentOptions): NexusT {
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
  return nexus as unknown as NexusT;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serialize(component: ComponentData): any {
  const nexus = component as NexusT;

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
    script: nexus.script || undefined,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deserialize(data: any): DeserializeResult<NexusT> {
  const errors: DeserializationError[] = [];

  if (!data || typeof data !== 'object') {
    return {
      component: null,
      errors: [
        {
          code: 'INVALID_DATA',
          message: 'nexus deserialize received non-object data',
        },
      ],
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const { type, name } = data;

  if (type !== 'nexus') {
    errors.push({
      code: 'TYPE_MISMATCH',
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      message: `type ${type} does not match "nexus"`,
    });
  }
  if (!name) {
    errors.push({
      code: 'MISSING_NAME',
      message: 'nexus requires a name',
    });
  }
  if (errors.length > 0) {
    return { component: null, errors };
  }

  const nexus = builder({ name: name as string });

  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  if (data.script !== undefined) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    if (typeof data.script !== 'string') {
      errors.push({
        code: 'INVALID_SCRIPT',
        message: `nexus "${name as string}" script field is not a string; ignored`,
      });
    } else {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      nexus.script = data.script;
    }
  }

  // Child components are walked separately by the recursive deserializer.
  return { component: nexus, errors };
}

export const NexusSerializer: ComponentSerializer = {
  serialize,
  deserialize,
};

/**
 * Allowlist of nexus-specific properties accessible via component Proxy.
 * These properties can be accessed directly without triggering method lookup.
 */
export const PROPERTY_ALLOWLIST: string[] = ['components', 'paused', 'script'];
