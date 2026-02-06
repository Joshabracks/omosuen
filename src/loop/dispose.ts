/**
 * Disposal Queue System
 *
 * Manages batched component disposal at the end of each frame to prevent
 * mid-update errors when components are removed from the scene.
 */

import type { ComponentData } from "../component/types";
import type { nexus } from "../component/nexus/data";
import { $ } from "../component/registry";
import { ComponentMethod } from "../component/registry";

/**
 * Set of component IDs flagged for disposal.
 * Using a Set prevents duplicate disposal attempts.
 */
const DISPOSE_QUEUE = new Set<number>();

/**
 * Adds a component ID to the disposal queue.
 *
 * The component will be disposed at the end of the current frame.
 *
 * @param id - The ID of the component to dispose
 *
 * @example
 * ```typescript
 * queueDispose(component.id);
 * ```
 */
export function queueDispose(id: number): void {
  DISPOSE_QUEUE.add(id);
}

/**
 * Marks a component for disposal by setting the _disposed flag
 * and adding it to the disposal queue.
 *
 * This is the recommended way to dispose components during gameplay,
 * as it ensures disposal happens at a safe time (end of frame).
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
    queueDispose(component.id);
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
 * Performance: O(n) where n is the number of components to dispose.
 * Uses batched processing for efficiency.
 *
 * @param scene - The active scene to search for components
 *
 * @example
 * ```typescript
 * // Called automatically by game loop
 * processDisposeQueue(activeScene);
 * ```
 */
export function processDisposeQueue(scene: nexus): void {
  if (DISPOSE_QUEUE.size === 0) {
    return;
  }

  // Convert to array for processing
  const ids = Array.from(DISPOSE_QUEUE);
  DISPOSE_QUEUE.clear();

  // Process each disposal
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const component = $.getComponentById(scene, id, true);

    if (!component) {
      continue;
    }

    const method = ComponentMethod[component.type];
    if (method.dispose && typeof method.dispose === "function") {
      method.dispose(component);
    } else {
      // Ensure _disposed flag is set even without custom dispose
      component._disposed = true;
    }
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
