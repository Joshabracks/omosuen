/**
 * Messenger Component Types
 *
 * Type definitions, interfaces, and constants for the messenger component.
 * The messenger system provides global message queue with per-component agents
 * for inter-component communication, multiplayer/websocket integration, and
 * large-scale event handling.
 */

import type { ComponentData, COMPONENT_TYPE } from '../types';

/**
 * Symbol for greedy message listeners.
 * Listeners registered with ALL_MESSAGES receive every message in the queue
 * regardless of message pattern or receiver filters.
 *
 * Use case: Message logging, debugging, audit trails
 *
 * @example
 * ```typescript
 * messenger.on(ALL_MESSAGES, "logAllMessages");
 * // This listener receives every message sent in the system
 * ```
 */
export const ALL_MESSAGES = Symbol('ALL_MESSAGES');

/**
 * Symbol for filter-based message listeners.
 * Listeners registered with ANY_MESSAGES receive all messages that match
 * the receiver filters, regardless of the message identifier string.
 *
 * Use case: Component-specific event logs, monitoring all events for a specific entity
 *
 * @example
 * ```typescript
 * // Listen for all messages sent to components named "Event Log"
 * messenger.on(ANY_MESSAGES, "logFilteredMessages");
 * // Will receive messages with any identifier ("attack", "dialogue", etc.)
 * // as long as receiver filters match
 * ```
 */
export const ANY_MESSAGES = Symbol('ANY_MESSAGES');

/**
 * Listener configuration declared in messenger builder.
 * Specifies message pattern and callback key for listener registration.
 */
export interface ListenerConfig {
  /**
   * Message pattern to match:
   * - String: Exact match (e.g., "attack")
   * - RegExp: Pattern match (e.g., `/damage:.* /`)
   * - ALL_MESSAGES: Receive all messages regardless of pattern/filters
   * - ANY_MESSAGES: Receive all messages matching filters (any pattern)
   */
  pattern: string | RegExp | typeof ALL_MESSAGES | typeof ANY_MESSAGES;

  /**
   * Key referencing callback in MethodRegistry['message-listener'].
   * Callback signature: (envelope: MessageEnvelope) => void
   */
  callbackKey: string;
}

/**
 * Message payload type.
 * Contains arbitrary data passed with the message.
 */
export type MessageBody = Record<string, unknown>;

/**
 * Message envelope structure.
 * Contains all information about a message including sender, receiver,
 * payload, and routing metadata.
 *
 * Note: sender and messenger are ComponentData typed here to avoid circular
 * dependencies. They will always be MessengerT at runtime.
 */
export interface MessageEnvelope {
  /** Message identifier/routing key (e.g., "attack", "dialogue:start") */
  message: string;

  /** The messenger component that sent this message */
  sender: ComponentData;

  /**
   * The component that matched receiver filters.
   * Can be parent Nexus, messenger itself, or a sibling component.
   */
  receiver: ComponentData;

  /** The messenger component handling this message (owns the listener) */
  messenger: ComponentData;

  /** Message payload data */
  body: MessageBody;

  /** Receiver filter options (used for filter matching during processing) */
  receiverOptions?: MessageReceiverOptions;
}

/**
 * Receiver filtering options for targeted message delivery.
 *
 * Determines which components receive the message based on name, type, and ID matching.
 * Filters are checked against parent Nexus, messenger itself, and all sibling components.
 */
export interface MessageReceiverOptions {
  /**
   * Filter matching mode:
   * - 'match-any': Match if ANY filter criteria passes (OR logic)
   * - 'match-all': Match if ALL filter criteria pass (AND logic, ignores ids)
   * - 'broadcast': Send to all components (ignores all filters)
   */
  mode: 'match-any' | 'match-all' | 'broadcast';

  /** Match components with these names (checked against component.name) */
  names?: string[];

  /** Match components with these types (checked against component.type) */
  types?: COMPONENT_TYPE[];

  /**
   * Match components with these IDs (checked against component.id).
   * Note: Ignored when mode is 'match-all' (triggers warning)
   */
  ids?: number[];
}

/**
 * Internal listener entry stored in MESSAGE_LISTENERS registry.
 * Extends ListenerConfig with runtime metadata.
 *
 * Note: messenger is ComponentData typed here to avoid circular dependencies.
 * It will always be MessengerT at runtime.
 */
export interface ListenerEntry extends ListenerConfig {
  /** Unique listener ID for removal */
  id: number;

  /** Direct reference to owning messenger (optimization: avoid tree traversal) */
  messenger: ComponentData;
}

/**
 * Handle returned by on() method for listener removal.
 */
export interface ListenerHandle {
  /** Unique listener ID */
  id: number;
}

/**
 * Message listener callback function signature.
 * Registered in MethodRegistry['message-listener'][callbackKey].
 *
 * @param envelope - The message envelope containing all message data
 *
 * @example
 * ```typescript
 * registerMethod('message-listener', 'handleAttack', (envelope) => {
 *   const damage = envelope.body.data?.damage ?? 0;
 *   console.log(`${envelope.receiver.name} received ${damage} damage`);
 * });
 * ```
 */
export type MessageCallback = (envelope: MessageEnvelope) => void;
