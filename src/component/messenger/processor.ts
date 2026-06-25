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

// Reused scratch buffers to avoid per-frame / per-message array allocation.
// Each is consumed synchronously before the next (re)use at the same nesting
// level, so sharing is safe (processMessageQueue is not reentrant).
const processingBuffer: MessageEnvelope[] = [];
const listenerMatches: ListenerEntry[] = [];
const candidateBuffer: ComponentData[] = [];
const componentMatches: ComponentData[] = [];

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
  const matches = listenerMatches;
  matches.length = 0;

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

  const hasNames = !!names?.length;
  const hasTypes = !!types?.length;
  const hasIds = !!ids?.length;

  if (mode === 'match-all') {
    // AND: an omitted dimension is neutral (true) and does not constrain.
    // ids are intentionally ignored in match-all (see validateReceiverOptions).
    const nameMatch = !hasNames || names!.includes(component.name);
    const typeMatch = !hasTypes || types!.includes(component.type);
    return nameMatch && typeMatch;
  }

  // match-any (OR): only the dimensions the caller actually provided can
  // produce a match. An omitted dimension is neutral (false) for OR, so it
  // can't force a match against every component. (No filters → matches nothing;
  // use broadcast/null to target all.)
  const nameMatch = hasNames && names!.includes(component.name);
  const typeMatch = hasTypes && types!.includes(component.type);
  const idMatch = hasIds && ids!.includes(component.id!);
  return nameMatch || typeMatch || idMatch;
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

  // Build candidate list: parent Nexus + all siblings (reused buffer).
  // The messenger lives in `nexus.components`, so iterating that already
  // includes it — pushing it explicitly too would double-count it (a targeted
  // send matching the messenger would otherwise fire its listener twice).
  const candidates = candidateBuffer;
  candidates.length = 0;
  candidates.push(parent); // Parent Nexus (not in its own components array)

  if (parent.type === 'nexus') {
    const nexus = parent as NexusT;
    for (let i = 0; i < nexus.components.length; i++) {
      candidates.push(nexus.components[i]); // siblings — already includes the messenger itself
    }
  } else {
    candidates.push(messenger); // fallback: messenger not reachable via parent
  }

  const options = envelope.receiverOptions;

  // ALL_MESSAGES: Skip filter check, return all candidates
  if (listener.pattern === ALL_MESSAGES) {
    return candidates;
  }

  const matches = componentMatches;
  matches.length = 0;

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
 * Invokes a single listener callback with the envelope, setting the receiver and
 * owning messenger. Wraps the call so one throwing listener can't abort delivery
 * to the rest.
 *
 * @param callback - The resolved message-listener callback
 * @param envelope - The message envelope being delivered
 * @param receiver - The component to expose as `envelope.receiver`
 * @param listener - The listener entry (for error context)
 */
function invokeListener(
  callback: MessageCallback,
  envelope: MessageEnvelope,
  receiver: ComponentData,
  listener: ListenerEntry,
): void {
  try {
    callback({
      ...envelope,
      receiver,
      messenger: listener.messenger,
    });
  } catch (error) {
    console.error(
      `[messenger] Error in callback "${listener.callbackKey}":`,
      error,
    );
  }
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
  // Nothing to do — avoid allocating on quiet frames (the common case).
  if (MESSAGE_QUEUE.length === 0) return;

  // Drain the queue into a reused buffer instead of copying with a spread.
  // New messages queued by callbacks during processing land in the (now empty)
  // MESSAGE_QUEUE and are handled on the next pass — same deferral as the old
  // copy-and-clear.
  const messages = processingBuffer;
  for (let i = 0; i < MESSAGE_QUEUE.length; i++) {
    messages.push(MESSAGE_QUEUE[i]);
  }
  MESSAGE_QUEUE.length = 0;

  // Process each message
  for (const envelope of messages) {
    // Find listeners matching message pattern
    const listeners = findMatchingListeners(envelope.message);

    // For each matching listener
    for (const listener of listeners) {
      // Look up callback in registry once per listener
      const callback = MethodRegistry['message-listener'][
        listener.callbackKey
      ] as MessageCallback | undefined;

      if (!callback) {
        console.warn(
          `[messenger] Callback "${listener.callbackKey}" not found in MethodRegistry['message-listener']. Skipping listener (id: ${listener.id}).`,
        );
        continue;
      }

      if (envelope.receiverOptions?.mode === 'broadcast') {
        // Broadcast (and null-receiver sends) are a single logical event:
        // deliver to each listener exactly ONCE — not once per scene component.
        // The per-component fan-out below is reserved for targeted (filtered)
        // sends where addressing multiple receivers is the intent.
        invokeListener(callback, envelope, listener.messenger, listener);
      } else {
        // Targeted send: deliver once per component matching the receiver filters.
        const matchedComponents = findMatchingComponents(listener, envelope);
        for (const matchedComponent of matchedComponents) {
          invokeListener(callback, envelope, matchedComponent, listener);
        }
      }
    }
  }

  // Release references held in the reused buffer.
  messages.length = 0;
}
