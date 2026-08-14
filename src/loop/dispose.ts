/**
 * Disposal Queue System
 *
 * Manages batched component disposal at the end of each frame to prevent
 * mid-update errors when components are removed from the scene.
 */

import type { ComponentData } from '../component/types';
import type { NexusT } from '../component/nexus/data';
import { disposeComponent } from '../component/registry';

/**
 * Component IDs flagged for disposal, mapped to a reference if one was
 * available at enqueue time (`null` otherwise). Using a `Map` still prevents
 * duplicate disposal attempts (same dedup-by-id behavior a `Set` gave), but
 * also lets `processDisposeQueue` skip the recursive `getComponentById`
 * search for anything queued via `markForDisposal` -- which already has the
 * live reference in hand and would otherwise pay a full tree search just to
 * re-find what it already had. Entries queued via the public `queueDispose(id)`
 * (no reference available) fall back to that search, same as before.
 */
const DISPOSE_QUEUE = new Map<number, ComponentData | null>();

/**
 * Adds a component ID to the disposal queue.
 *
 * The component will be disposed at the end of the current frame. Prefer
 * `markForDisposal(component)` when you have the component reference in
 * hand -- it avoids a tree search during processing. This id-only entry
 * point stays available for callers that only have the id (e.g. external
 * code), at the cost of `processDisposeQueue` needing to look it up.
 *
 * @param id - The ID of the component to dispose
 *
 * @example
 * ```typescript
 * queueDispose(component.id);
 * ```
 */
export function queueDispose(id: number): void {
  // Don't clobber an existing reference-bearing entry (e.g. if markForDisposal
  // already queued this same id this frame) with a reference-less one.
  if (!DISPOSE_QUEUE.has(id)) {
    DISPOSE_QUEUE.set(id, null);
  }
}

/**
 * Marks a component for disposal by setting the _disposed flag
 * and adding it to the disposal queue.
 *
 * This is the recommended way to dispose components during gameplay,
 * as it ensures disposal happens at a safe time (end of frame). Caches the
 * component reference in the queue, so `processDisposeQueue` doesn't need
 * to search the tree for it later.
 *
 * @param component - The component to mark for disposal
 *
 * @example
 * ```typescript
 * markForDisposal(enemy);
 * // Enemy will be disposed at end of current frame
 * ```
 */
export function markForDisposal(component: ComponentData): void {
  component._disposed = true;
  if (component.id !== undefined) {
    DISPOSE_QUEUE.set(component.id, component);
  }
}

/**
 * Processes all components in the disposal queue.
 *
 * This function is called automatically at the end of each frame
 * by the game loop manager. It performs the following:
 * 1. Retrieves all components from the disposal queue
 * 2. Clears the queue
 * 3. Calls the dispose method for each component (if it exists)
 * 4. Ensures _disposed flag is set even if no custom dispose method
 *
 * Performance: O(n) where n is the number of components to dispose, plus a
 * tree search only for entries that were queued without a reference already
 * in hand (see `DISPOSE_QUEUE`'s doc comment).
 * Uses batched processing for efficiency.
 *
 * @param scene - The active scene to search for components without a cached reference
 *
 * @example
 * ```typescript
 * // Called automatically by game loop
 * processDisposeQueue(activeScene);
 * ```
 */
export function processDisposeQueue(scene: NexusT): void {
  if (DISPOSE_QUEUE.size === 0) {
    return;
  }

  // Convert to array for processing (same re-entrancy safety as before: a
  // disposal triggered mid-processing queues into a fresh, now-empty map
  // instead of the batch already being drained here).
  const entries = Array.from(DISPOSE_QUEUE);
  DISPOSE_QUEUE.clear();

  // Process each disposal
  for (let i = 0; i < entries.length; i++) {
    const [id, ref] = entries[i];
    const component = ref ?? scene.getComponentById(id, true);

    if (!component) {
      continue;
    }

    disposeComponent(component);
  }
}

/**
 * Clears the disposal queue without processing.
 *
 * This is primarily used for testing or when resetting the game state.
 *
 * @example
 * ```typescript
 * clearDisposeQueue();
 * ```
 */
export function clearDisposeQueue(): void {
  DISPOSE_QUEUE.clear();
}

/**
 * Gets the current size of the disposal queue.
 *
 * Useful for debugging and monitoring disposal backlog.
 *
 * @returns The number of components waiting for disposal
 *
 * @example
 * ```typescript
 * const pending = getDisposeQueueSize();
 * console.log(`${pending} components pending disposal`);
 * ```
 */
export function getDisposeQueueSize(): number {
  return DISPOSE_QUEUE.size;
}
