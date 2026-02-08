/**
 * Message System
 *
 * Processes inter-component messages via the messenger component system.
 * Messages are queued during component updates and processed here at the
 * start of each update loop.
 */

import { processMessageQueue } from '../component/messenger/processor';

/**
 * Polls and processes inter-component messages.
 *
 * Called automatically by the game loop at the start of each update cycle.
 * Processes all queued messages by finding matching listeners, filtering
 * by receiver options, and invoking registered callbacks.
 *
 * Features:
 * - Targeted message delivery (filter by names, types, ids)
 * - Broadcast messaging (send to all listeners)
 * - Pattern matching (string, RegExp, ALL_MESSAGES, ANY_MESSAGES)
 * - Off-scene messenger support (manually initialized messengers)
 * - Direct component references (no tree traversal)
 *
 * Use Cases:
 * - Inter-component communication (attack, damage, death events)
 * - Multiplayer/websocket messaging
 * - Large-scale event triggers (dialogue, cutscenes)
 * - UI state changes
 * - Game state transitions
 *
 * @example
 * ```typescript
 * // Called automatically by game loop
 * pollMessages();
 * ```
 *
 * @example
 * ```typescript
 * // Developer usage (in component code)
 * import { newComponent, registerMethod } from 'omosuen';
 *
 * // Register callback
 * registerMethod('message-listener', 'handleAttack', (envelope) => {
 *   console.log('Attack received!', envelope.body.data);
 * });
 *
 * // Create messenger with listener
 * const messenger = await newComponent('messenger', {
 *   name: "Player Messenger",
 *   listeners: [
 *     { pattern: "attack", callbackKey: "handleAttack" }
 *   ]
 * });
 *
 * // Send message
 * messenger.send("attack", {
 *   mode: 'match-any',
 *   names: ["Enemy"]
 * }, { data: { damage: 10 } });
 * ```
 */
export function pollMessages(): void {
  processMessageQueue();
}
