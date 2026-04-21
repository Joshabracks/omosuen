/**
 * Messenger Component Data
 *
 * Defines the messenger component interface, builder function, and serializer.
 * Messengers act as communication agents for their parent Nexus and sibling components.
 */

import {
  ComponentData,
  ComponentOptions,
  ComponentSerializer,
  ComponentUnique,
  ComponentInstanceMethods,
  SerializedData,
  DeserializationError,
  DeserializeResult,
} from '../types';
import type { MessengerMethods } from './methods';
import type { ListenerConfig } from './types';
import { ALL_MESSAGES, ANY_MESSAGES } from './types';

/**
 * Messenger component interface.
 *
 * Messengers act as message hubs for their parent Nexus and sibling components.
 * They route messages based on filters (names, types, ids) and deliver them to
 * registered listener callbacks.
 *
 * Key Features:
 * - Send targeted messages to specific components
 * - Broadcast messages to all listeners
 * - Register listeners with patterns (string, RegExp, ALL_MESSAGES, ANY_MESSAGES)
 * - Filter-based routing (match parent, self, or sibling components)
 * - Off-scene support (manually initialized messengers can function outside activeScene)
 *
 * @example
 * ```typescript
 * // Register a message listener callback
 * registerMethod('message-listener', 'handleAttack', (envelope) => {
 *   console.log(`${envelope.receiver.name} took ${envelope.body.data.damage} damage`);
 * });
 *
 * // Create messenger with listeners
 * const messenger = await newComponent('messenger', {
 *   name: "Player Messenger",
 *   listeners: [
 *     { pattern: "attack", callbackKey: "handleAttack" },
 *     { pattern: `/damage:.* /`, callbackKey: "handleDamage" }
 *   ]
 * });
 *
 * // Send targeted message
 * messenger.send("attack", {
 *   mode: 'match-any',
 *   names: ["Enemy"]
 * }, { data: { damage: 10 } });
 *
 * // Broadcast to all
 * messenger.broadcast("gameStart", { data: { level: 1 } });
 * ```
 */
export interface MessengerT
  extends ComponentData, ComponentInstanceMethods<MessengerMethods> {
  /** Component type identifier */
  type: 'messenger';

  /** Multiple messengers allowed per Nexus */
  unique: ComponentUnique.FALSE;

  /**
   * Listener configurations to register on init().
   * Listeners are registered when the messenger is initialized,
   * not when it's created.
   */
  listeners: ListenerConfig[];
}

/**
 * Extends ComponentOptions to include messenger-specific properties.
 */
export interface MessengerOptions extends ComponentOptions {
  /** Listener configurations (optional, can be empty array) */
  listeners?: ListenerConfig[];
}

/**
 * Builder function for messenger component.
 * Creates a new messenger with the specified listener configurations.
 *
 * Listeners are declared here but registered during init() to support
 * off-scene messengers and prevent premature listener activation.
 *
 * @param options - Component creation options
 * @returns A new messenger component instance (data-only, methods added by Proxy)
 *
 * @example
 * ```typescript
 * const messenger = await newComponent('messenger', {
 *   name: "Player Messenger",
 *   listeners: [
 *     { pattern: "attack", callbackKey: "handleAttack" },
 *     { pattern: ALL_MESSAGES, callbackKey: "logAll" }
 *   ]
 * });
 * ```
 */
export function builder(options: MessengerOptions): MessengerT {
  // Create data-only object. Methods will be added by Proxy wrapper in newComponent()
  return {
    type: 'messenger' as const,
    name: options.name,
    unique: ComponentUnique.FALSE,
    parent: null,
    _disposed: false,
    listeners: options.listeners ?? [],
  } as unknown as MessengerT;
}

/**
 * Serializes a messenger component to a plain object.
 * Converts RegExp patterns to serializable format.
 *
 * @param component - The messenger component to serialize
 * @returns Serialized messenger data
 */
function serialize(component: ComponentData): SerializedData {
  const m = component as MessengerT;

  return {
    type: 'messenger',
    name: m.name,
    listeners: m.listeners.map((listener) => {
      // Handle RegExp serialization
      if (listener.pattern instanceof RegExp) {
        return {
          pattern: {
            regex: listener.pattern.source,
            flags: listener.pattern.flags,
          },
          callbackKey: listener.callbackKey,
        };
      }

      // Handle Symbol serialization
      if (typeof listener.pattern === 'symbol') {
        return {
          pattern: listener.pattern.toString(), // "Symbol(ALL_MESSAGES)" or "Symbol(ANY_MESSAGES)"
          callbackKey: listener.callbackKey,
        };
      }

      // String patterns
      return {
        pattern: listener.pattern,
        callbackKey: listener.callbackKey,
      };
    }),
  };
}

/**
 * Deserializes a plain object back into a messenger component.
 * Reconstructs RegExp patterns and validates data.
 *
 * @param data - The serialized messenger data
 * @returns A new messenger component instance
 * @throws Error if validation fails
 */
function deserialize(data: SerializedData): DeserializeResult<MessengerT> {
  const errors: DeserializationError[] = [];

  if (!data || typeof data !== 'object') {
    return {
      component: null,
      errors: [
        {
          code: 'INVALID_DATA',
          message: 'messenger deserialize received non-object data',
        },
      ],
    };
  }

  const { type, name, listeners } = data;

  if (type !== 'messenger') {
    errors.push({
      code: 'TYPE_MISMATCH',
      message: `type ${type} does not match "messenger"`,
    });
  }
  if (!name) {
    errors.push({
      code: 'MISSING_NAME',
      message: 'messenger requires a name',
    });
  }
  if (errors.length > 0) {
    return { component: null, errors };
  }

  const componentName = name as string;

  const reconstructedListeners: ListenerConfig[] = [];
  if (listeners !== undefined) {
    if (!Array.isArray(listeners)) {
      errors.push({
        code: 'INVALID_LISTENERS',
        message: `messenger "${componentName}" listeners field is not an array; ignored`,
      });
    } else {
      for (let i = 0; i < listeners.length; i += 1) {
        const listener = listeners[i];
        if (!listener || typeof listener !== 'object') {
          errors.push({
            code: 'INVALID_LISTENER_ENTRY',
            message: `messenger "${componentName}" listeners[${i}] is not an object; skipped`,
          });
          continue;
        }
        if (!listener.pattern || !listener.callbackKey) {
          errors.push({
            code: 'INVALID_LISTENER',
            message: `messenger "${componentName}" listeners[${i}] missing pattern or callbackKey; skipped`,
          });
          continue;
        }

        let pattern:
          | string
          | RegExp
          | typeof ALL_MESSAGES
          | typeof ANY_MESSAGES;

        if (
          typeof listener.pattern === 'object' &&
          'regex' in listener.pattern
        ) {
          pattern = new RegExp(listener.pattern.regex, listener.pattern.flags);
        } else if (typeof listener.pattern === 'string') {
          if (listener.pattern.includes('ALL_MESSAGES')) {
            pattern = ALL_MESSAGES;
          } else if (listener.pattern.includes('ANY_MESSAGES')) {
            pattern = ANY_MESSAGES;
          } else {
            pattern = listener.pattern;
          }
        } else {
          pattern = listener.pattern as string;
        }

        reconstructedListeners.push({
          pattern,
          callbackKey: listener.callbackKey as string,
        });
      }
    }
  }

  return {
    component: builder({
      name: componentName,
      listeners: reconstructedListeners,
    }),
    errors,
  };
}

/**
 * Messenger component serializer.
 * Handles conversion between messenger components and JSON-compatible objects.
 */
export const MessengerSerializer: ComponentSerializer = {
  serialize,
  deserialize,
};

/**
 * Allowlist of messenger-specific properties accessible via component Proxy.
 * These properties can be accessed directly without triggering method lookup.
 */
export const PROPERTY_ALLOWLIST: string[] = ['listeners'];
