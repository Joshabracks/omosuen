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
function deserialize(data: SerializedData): MessengerT {
  const { type, name, listeners } = data;

  // Validate required fields
  const errors: string[] = [];
  if (type !== 'messenger') {
    errors.push(`type ${type} does not match "messenger"`);
  }
  if (!name) {
    errors.push('messenger requires a name');
  }
  if (errors.length) {
    throw new Error(
      `[messenger] Deserialization failed:\n${errors.join('\n')}`,
    );
  }

  // Reconstruct listeners
  const reconstructedListeners: ListenerConfig[] = [];
  if (listeners && Array.isArray(listeners)) {
    for (const listener of listeners) {
      if (!listener.pattern || !listener.callbackKey) {
        console.warn(
          `[messenger] Skipping invalid listener during deserialization:`,
          listener,
        );
        continue;
      }

      let pattern: string | RegExp | typeof ALL_MESSAGES | typeof ANY_MESSAGES;

      // Reconstruct RegExp
      if (typeof listener.pattern === 'object' && 'regex' in listener.pattern) {
        pattern = new RegExp(listener.pattern.regex, listener.pattern.flags);
      }
      // Reconstruct Symbols (note: can't truly reconstruct symbol identity, but functionality preserved)
      else if (typeof listener.pattern === 'string') {
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

  // Create messenger using builder
  return builder({
    name,
    listeners: reconstructedListeners,
  });
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
