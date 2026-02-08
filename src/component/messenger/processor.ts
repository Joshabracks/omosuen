/**
 * Message Queue Processor
 *
 * Processes queued messages and delivers them to matching listeners.
 * Called at the start of each update loop via pollMessages().
 */

import { ComponentData } from '../types';
import { MethodRegistry } from '../registry';
import type { NexusT } from '../nexus/data';
import type {
  MessageEnvelope,
  MessageReceiverOptions,
  ListenerEntry,
  MessageCallback,
} from './types';
import { ALL_MESSAGES, ANY_MESSAGES } from './types';
import { MESSAGE_QUEUE, MESSAGE_LISTENERS } from './methods';

/**
 * Finds all listeners that match the given message pattern.
 *
 * Performs pattern matching optimization by checking message identifier
 * against listener patterns before filter matching.
 *
 * @param message - The message identifier to match
 * @returns Array of matching listener entries
 */
function findMatchingListeners(message: string): ListenerEntry[] {
  const matches: ListenerEntry[] = [];

  // Iterate through all registered listeners
  for (const [_messengerId, listeners] of MESSAGE_LISTENERS) {
    for (const listener of listeners) {
      // ALL_MESSAGES: Always match (greedy listener)
      if (listener.pattern === ALL_MESSAGES) {
        matches.push(listener);
      }
      // ANY_MESSAGES: Match with filter check (handled in findMatchingComponents)
      else if (listener.pattern === ANY_MESSAGES) {
        matches.push(listener);
      }
      // String: Exact match
      else if (typeof listener.pattern === 'string') {
        if (listener.pattern === message) {
          matches.push(listener);
        }
      }
      // RegExp: Pattern match
      else if (listener.pattern instanceof RegExp) {
        if (listener.pattern.test(message)) {
          matches.push(listener);
        }
      }
    }
  }

  return matches;
}

/**
 * Matches a component against receiver filter options.
 *
 * Implements match-any (OR) and match-all (AND) logic for name/type/id filtering.
 *
 * @param component - The component to check
 * @param options - The receiver filter options
 * @returns True if component matches filters, false otherwise
 */
function matchesFilters(
  component: ComponentData,
  options?: MessageReceiverOptions,
): boolean {
  if (!options) return true; // No filters = match all

  const { mode, names, types, ids } = options;

  // Broadcast mode: Always match
  if (mode === 'broadcast') return true;

  // Check each filter type
  const nameMatch = !names?.length || names.includes(component.name);
  const typeMatch = !types?.length || types.includes(component.type);
  const idMatch = !ids?.length || ids.includes(component.id!);

  if (mode === 'match-all') {
    // ALL criteria must match (ignore ids)
    return nameMatch && typeMatch;
  } else {
    // match-any: ANY criteria must match (OR logic)
    return nameMatch || typeMatch || idMatch;
  }
}

/**
 * Finds all components in the messenger's scope that match receiver filters.
 *
 * Checks parent Nexus, messenger itself, and all sibling components against filters.
 * Uses direct references (no tree traversal) for performance.
 *
 * @param listener - The listener entry containing messenger reference
 * @param envelope - The message envelope containing receiver options
 * @returns Array of components that match the filters
 */
function findMatchingComponents(
  listener: ListenerEntry,
  envelope: MessageEnvelope,
): ComponentData[] {
  const messenger = listener.messenger;
  const parent = messenger.parent;

  // No parent means messenger is not in a Nexus (shouldn't happen normally)
  if (!parent) {
    console.warn(
      `[messenger] Messenger "${messenger.name}" (id: ${messenger.id}) has no parent. Messages cannot be routed without a parent Nexus.`,
    );
    return [];
  }

  // Build candidate list: parent, messenger, and all siblings
  const candidates: ComponentData[] = [
    parent, // Parent Nexus
    messenger, // Messenger itself
  ];

  // Add siblings (all components in parent, including messenger)
  if (parent.type === 'nexus') {
    const nexus = parent as NexusT;
    candidates.push(...nexus.components);
  }

  const matches: ComponentData[] = [];
  const options = envelope.receiverOptions;

  // ALL_MESSAGES: Skip filter check, return all candidates
  if (listener.pattern === ALL_MESSAGES) {
    return candidates;
  }

  // ANY_MESSAGES: Only filter check, message pattern already matched
  // Regular patterns: Message pattern AND filter check
  for (const component of candidates) {
    if (matchesFilters(component, options)) {
      matches.push(component);
    }
  }

  return matches;
}

/**
 * Processes the message queue.
 *
 * Called at the start of each update loop (via pollMessages in loop/messaging.ts).
 * Iterates through queued messages, finds matching listeners, filters by receiver
 * options, and invokes callbacks.
 *
 * Performance Optimizations:
 * - Message pattern matching first (narrow search space)
 * - Direct component references (no tree traversal)
 * - Batch processing (all messages in single loop pass)
 *
 * @example
 * ```typescript
 * // Called automatically by game loop
 * processMessageQueue();
 * ```
 */
export function processMessageQueue(): void {
  // Copy queue and clear (allows new messages to be queued during processing)
  const messages = [...MESSAGE_QUEUE];
  MESSAGE_QUEUE.length = 0;

  // Process each message
  for (const envelope of messages) {
    // Find listeners matching message pattern
    const listeners = findMatchingListeners(envelope.message);

    // For each matching listener
    for (const listener of listeners) {
      // Find components in messenger's scope that match receiver filters
      const matchedComponents = findMatchingComponents(listener, envelope);

      // Invoke callback once per matched component
      for (const matchedComponent of matchedComponents) {
        // Look up callback in registry
        const callback = MethodRegistry['message-listener'][
          listener.callbackKey
        ] as MessageCallback | undefined;

        if (!callback) {
          console.warn(
            `[messenger] Callback "${listener.callbackKey}" not found in MethodRegistry['message-listener']. Skipping listener (id: ${listener.id}).`,
          );
          continue;
        }

        // Invoke callback with envelope (set receiver and messenger)
        try {
          callback({
            ...envelope,
            receiver: matchedComponent,
            messenger: listener.messenger,
          });
        } catch (error) {
          console.error(
            `[messenger] Error in callback "${listener.callbackKey}":`,
            error,
          );
        }
      }
    }
  }
}

/**
 * Gets the current size of the message queue.
 *
 * Useful for debugging and monitoring message throughput.
 *
 * @returns The number of messages pending processing
 *
 * @example
 * ```typescript
 * const pending = getMessageQueueSize();
 * console.log(`${pending} messages pending`);
 * ```
 */
export function getMessageQueueSize(): number {
  return MESSAGE_QUEUE.length;
}

/**
 * Gets the number of registered listeners across all messengers.
 *
 * Useful for debugging and monitoring listener registration.
 *
 * @returns The total number of registered listeners
 *
 * @example
 * ```typescript
 * const count = getListenerCount();
 * console.log(`${count} listeners registered`);
 * ```
 */
export function getListenerCount(): number {
  let count = 0;
  for (const [_messengerId, listeners] of MESSAGE_LISTENERS) {
    count += listeners.length;
  }
  return count;
}

/**
 * Clears the message queue without processing.
 *
 * This is primarily used for testing or when resetting game state.
 *
 * @example
 * ```typescript
 * clearMessageQueue();
 * ```
 */
export function clearMessageQueue(): void {
  MESSAGE_QUEUE.length = 0;
}
