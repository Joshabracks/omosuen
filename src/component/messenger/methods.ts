/**
 * Messenger Component Methods
 *
 * Static methods for messenger component operations: sending messages,
 * registering listeners, and managing message lifecycle.
 */

import { ComponentData, ComponentMethods } from '../types';
import { MethodRegistry } from '../registry';
import type { MessengerT } from './data';
import type {
  MessageEnvelope,
  MessageBody,
  MessageReceiverOptions,
  ListenerEntry,
  ListenerHandle,
  ALL_MESSAGES,
  ANY_MESSAGES,
} from './types';

/**
 * Module-level message queue.
 * Messages added here are processed at the start of each update loop.
 */
export const MESSAGE_QUEUE: MessageEnvelope[] = [];

/**
 * Module-level listener registry.
 * Maps messenger component ID to array of listener entries.
 */
export const MESSAGE_LISTENERS: Map<number, ListenerEntry[]> = new Map();

/**
 * WeakSet for tracking warned receiver options.
 * Prevents console spam from repeated warnings about invalid options.
 */
const WARNED_OPTIONS: WeakSet<MessageReceiverOptions> = new WeakSet();

/**
 * Listener ID counter for unique listener identification.
 */
let LISTENER_ID_COUNTER = 0;

/**
 * Methods interface for messenger component.
 * Provides type-safe method signatures for the Proxy wrapper.
 */
export interface MessengerMethods extends ComponentMethods {
  send: (
    m: MessengerT,
    message: string,
    receiverOptions: MessageReceiverOptions | null | undefined,
    body?: MessageBody,
  ) => void;
  broadcast: (m: MessengerT, message: string, body?: MessageBody) => void;
  on: (
    m: MessengerT,
    pattern: string | RegExp | typeof ALL_MESSAGES | typeof ANY_MESSAGES,
    callbackKey: string,
  ) => ListenerHandle;
  removeListener: (m: MessengerT, handle: ListenerHandle) => void;
  init: (component: ComponentData) => Promise<void>;
  dispose: (component: ComponentData) => void;
}

/**
 * Validates receiver options and logs warnings for invalid configurations.
 * Uses WeakSet to ensure warnings are logged only once per unique options object.
 *
 * @param options - The receiver options to validate
 */
function validateReceiverOptions(
  options: MessageReceiverOptions | null | undefined,
): void {
  if (!options) return;
  if (WARNED_OPTIONS.has(options)) return; // Already warned about this object

  const warnings: string[] = [];

  // Warn if broadcast mode has filters
  if (options.mode === 'broadcast') {
    if (options.names?.length || options.types?.length || options.ids?.length) {
      warnings.push(
        '[messenger] broadcast mode ignores all filters (names, types, ids)',
      );
    }
  }

  // Warn if match-all mode has ids
  if (options.mode === 'match-all' && options.ids?.length) {
    warnings.push('[messenger] match-all mode ignores ids field');
  }

  // Warn if a targeted mode has no filters at all. match-any then matches
  // nothing and match-all matches everything — almost always a mistake; use
  // broadcast (or a null receiver) to intentionally target all components.
  if (
    (options.mode === 'match-any' || options.mode === 'match-all') &&
    !options.names?.length &&
    !options.types?.length &&
    !options.ids?.length
  ) {
    warnings.push(
      `[messenger] ${options.mode} with no name/type/id filters; use broadcast to target all components`,
    );
  }

  // Log warnings and mark as warned
  if (warnings.length > 0) {
    warnings.forEach((warning) => console.warn(warning, options));
    WARNED_OPTIONS.add(options);
  }
}

/**
 * Static methods object for messenger component.
 * All methods are stateless and operate on component data passed as first parameter.
 */
export const Messenger: MessengerMethods = {
  type: 'messenger',

  /**
   * Sends a message to specific receivers matching the filter options.
   *
   * Messages are queued and processed at the start of the next update loop.
   * Supports null/undefined receiverOptions to trigger broadcast mode.
   *
   * @param m - The messenger component sending the message
   * @param message - Message identifier (e.g., "attack", "dialogue:start")
   * @param receiverOptions - Filter options or null/undefined for broadcast
   * @param body - Optional message payload data
   *
   * @example
   * ```typescript
   * // Send to components named "Enemy"
   * messenger.send("attack", {
   *   mode: 'match-any',
   *   names: ["Enemy"]
   * }, { data: { damage: 10 } });
   *
   * // Send to data-layer named "Event Log"
   * messenger.send("event", {
   *   mode: 'match-all',
   *   names: ["Event Log"],
   *   types: ["data-layer"]
   * }, { data: { message: "Player won" } });
   *
   * // Broadcast via null
   * messenger.send("gameStart", null, { data: { level: 1 } });
   * ```
   */
  send: (
    m: MessengerT,
    message: string,
    receiverOptions: MessageReceiverOptions | null | undefined,
    body?: MessageBody,
  ): void => {
    // Convert null/undefined to broadcast mode
    if (receiverOptions === null || receiverOptions === undefined) {
      return Messenger.broadcast(m, message, body);
    }

    // Validate options (warns once per unique object)
    validateReceiverOptions(receiverOptions);

    // Create message envelope
    const envelope: MessageEnvelope = {
      message,
      sender: m,
      receiver: m, // Placeholder, will be set during processing
      messenger: m, // Placeholder, will be set during processing
      body: body ?? {},
      receiverOptions,
    };

    // Queue message for processing
    MESSAGE_QUEUE.push(envelope);
  },

  /**
   * Broadcasts a message to all messengers regardless of filters.
   *
   * Equivalent to calling send() with receiverOptions: { mode: 'broadcast' }.
   *
   * @param m - The messenger component sending the message
   * @param message - Message identifier
   * @param body - Optional message payload data
   *
   * @example
   * ```typescript
   * // Broadcast game state change
   * messenger.broadcast("gameStart", { data: { level: 1 } });
   *
   * // Broadcast without payload
   * messenger.broadcast("playerDied");
   * ```
   */
  broadcast: (m: MessengerT, message: string, body?: MessageBody): void => {
    const envelope: MessageEnvelope = {
      message,
      sender: m,
      receiver: m, // Placeholder
      messenger: m, // Placeholder
      body: body ?? {},
      receiverOptions: { mode: 'broadcast' },
    };

    MESSAGE_QUEUE.push(envelope);
  },

  /**
   * Registers a message listener for this messenger.
   *
   * Listeners are stored in the global MESSAGE_LISTENERS registry and invoked
   * when matching messages are processed. The callback must be pre-registered
   * in MethodRegistry['message-listener'][callbackKey].
   *
   * @param m - The messenger component
   * @param pattern - Message pattern to match (string, RegExp, ALL_MESSAGES, ANY_MESSAGES)
   * @param callbackKey - Key referencing callback in MethodRegistry['message-listener']
   * @returns ListenerHandle for removal via removeListener()
   *
   * @example
   * ```typescript
   * // Register callback first
   * registerMethod('message-listener', 'handleAttack', (envelope) => {
   *   console.log('Attack received!', envelope.body.data);
   * });
   *
   * // Register listener
   * const handle = messenger.on("attack", "handleAttack");
   *
   * // Register with RegExp
   * messenger.on(`/damage:.* /`, "handleDamage");
   *
   * // Register greedy listener
   * messenger.on(ALL_MESSAGES, "logAll");
   *
   * // Register filter-based listener
   * messenger.on(ANY_MESSAGES, "handleFiltered");
   * ```
   */
  on: (
    m: MessengerT,
    pattern: string | RegExp | typeof ALL_MESSAGES | typeof ANY_MESSAGES,
    callbackKey: string,
  ): ListenerHandle => {
    // Validate callback exists
    if (!MethodRegistry['message-listener'][callbackKey]) {
      console.warn(
        `[messenger] Callback key "${callbackKey}" not found in MethodRegistry['message-listener']. Listener will not function until callback is registered.`,
      );
      return { id: -1 }; // Invalid handle
    }

    // Create listener entry
    const entry: ListenerEntry = {
      id: LISTENER_ID_COUNTER++,
      pattern,
      callbackKey,
      messenger: m,
    };

    // Add to registry
    if (!MESSAGE_LISTENERS.has(m.id!)) {
      MESSAGE_LISTENERS.set(m.id!, []);
    }
    MESSAGE_LISTENERS.get(m.id!)!.push(entry);

    return { id: entry.id };
  },

  /**
   * Removes a registered listener.
   *
   * @param m - The messenger component
   * @param handle - The handle returned by on()
   *
   * @example
   * ```typescript
   * const handle = messenger.on("attack", "handleAttack");
   * // Later...
   * messenger.removeListener(handle);
   * ```
   */
  removeListener: (m: MessengerT, handle: ListenerHandle): void => {
    if (handle.id === -1) {
      console.warn('[messenger] Cannot remove invalid listener handle');
      return;
    }

    const listeners = MESSAGE_LISTENERS.get(m.id!);
    if (!listeners) return;

    const index = listeners.findIndex((entry) => entry.id === handle.id);
    if (index !== -1) {
      listeners.splice(index, 1);
    }
  },

  /**
   * Initializes the messenger component.
   *
   * Registers all listeners declared in the messenger's listeners array.
   * Called automatically when the component is added to the scene tree,
   * or can be called manually for off-scene messengers.
   *
   * @param component - The messenger component to initialize
   *
   * @example
   * ```typescript
   * // Called automatically by engine when messenger is added to scene
   * Nexus.addComponent(parent, messenger);
   *
   * // Or manually for off-scene messenger
   * Messenger.init(messenger);
   * ```
   */
  init: async (component: ComponentData): Promise<void> => {
    const m = component as MessengerT;

    // Register all declared listeners
    for (const listener of m.listeners) {
      Messenger.on(m, listener.pattern, listener.callbackKey);
    }

    m._initialized = true;
  },

  /**
   * Disposes the messenger component.
   *
   * Removes all registered listeners from MESSAGE_LISTENERS and clears
   * any queued messages referencing this messenger.
   *
   * @param component - The messenger component to dispose
   *
   * @example
   * ```typescript
   * // Called automatically by engine disposal system
   * Messenger.dispose(messenger);
   * ```
   */
  dispose: (component: ComponentData): void => {
    const m = component as MessengerT;

    // Remove all listeners for this messenger
    MESSAGE_LISTENERS.delete(m.id!);

    // Remove messages from queue where this messenger is sender or receiver
    // Note: We can't easily check receiver since it's set during processing,
    // so we only check sender. Disposed messengers won't match during processing anyway.
    for (let i = MESSAGE_QUEUE.length - 1; i >= 0; i--) {
      const envelope = MESSAGE_QUEUE[i];
      if (envelope.sender.id === m.id || envelope.messenger.id === m.id) {
        MESSAGE_QUEUE.splice(i, 1);
      }
    }

    m._disposed = true;
  },
};
