/**
 * Update Traversal System
 *
 * Recursively traverses the component tree and calls update() on each
 * component, respecting pause states and loader flags.
 */

import type { ComponentData } from '../component/types';
import type { nexus } from '../component/nexus/data';
import { ComponentMethod } from '../component/registry';
import { isInitializing } from './init';

/**
 * Recursively traverses and updates a component and its children.
 *
 * This function performs depth-first traversal of the component tree,
 * calling the update() method on each component that meets the following
 * criteria:
 * - Not disposed (_disposed !== true)
 * - Not paused (respects parent nexus pause state)
 * - Either:
 *   - Initialization is complete, OR
 *   - Component has loader=true flag
 *
 * Pause Propagation:
 * If a nexus has paused=true, all descendants are skipped regardless
 * of their individual pause state. This allows entire subtrees to be
 * paused efficiently.
 *
 * Loader Mode:
 * During progressive initialization, only components with loader=true
 * are updated. This allows loading screens, progress bars, and other
 * UI elements to continue functioning during large scene loads.
 *
 * Performance: O(n) where n is the number of components in the scene.
 * Uses depth-first traversal for cache-friendly memory access.
 *
 * @param component - The component to update
 * @param deltaTime - Time elapsed since last frame in milliseconds
 * @param isPaused - Whether the parent is paused (propagated from ancestors)
 *
 * @example
 * ```typescript
 * // Called internally by updateScene()
 * traverseAndUpdate(scene, 16.67, false);
 * ```
 */
function traverseAndUpdate(
  component: ComponentData,
  deltaTime: number,
  isPaused: boolean,
): void {
  // Skip disposed components
  if (component._disposed) {
    return;
  }

  // Propagate pause state from nexus
  let shouldPause = isPaused;
  if (component.type === 'nexus') {
    const n = component as nexus;
    shouldPause = isPaused || n.paused;
  }

  // Skip paused components
  if (shouldPause) {
    return;
  }

  // During init, only update loader components
  if (isInitializing() && !component.loader) {
    return;
  }

  // Check for instance-specific update override first
  if (component.updateOverride) {
    const method = ComponentMethod[component.type];
    // @ts-ignore - Dynamic method access via registered override
    const overrideMethod = method[component.updateOverride];
    if (overrideMethod && typeof overrideMethod === 'function') {
      overrideMethod(component, deltaTime);
    } else {
      console.warn(
        `[UPDATE] Custom update method '${component.updateOverride}' not found for component '${component.name}'`,
      );
    }
  } else {
    // Fall back to type-level update
    const method = ComponentMethod[component.type];
    if (method.update && typeof method.update === 'function') {
      method.update(component, deltaTime);
    }
  }

  // Recurse into nexus children
  if (component.type === 'nexus') {
    const n = component as nexus;
    for (let i = 0; i < n.components.length; i++) {
      traverseAndUpdate(n.components[i], deltaTime, shouldPause);
    }
  }
}

/**
 * Updates the entire scene tree.
 *
 * This is the main entry point for the update cycle, called once per
 * frame by the game loop manager. It performs a depth-first traversal
 * of the component tree, calling update() on all active components.
 *
 * The deltaTime parameter represents the actual time elapsed since the
 * last frame, allowing for frame-rate independent updates. Components
 * should multiply velocities and other time-based values by deltaTime
 * to ensure consistent behavior regardless of frame rate.
 *
 * @param scene - The active scene (root nexus) to update
 * @param deltaTime - Time elapsed since last frame in milliseconds
 *
 * @example
 * ```typescript
 * // Called automatically by game loop
 * const scene = getActiveScene();
 * if (scene) {
 *   updateScene(scene, deltaTime);
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Example component update method
 * export const Sprite: SpriteMethods = {
 *   type: 'sprite',
 *   update: (component: ComponentData, deltaTime: number) => {
 *     const s = component as sprite;
 *     // Move at 100 pixels per second
 *     s.position.x += s.velocity.x * (deltaTime / 1000);
 *     s.position.y += s.velocity.y * (deltaTime / 1000);
 *   }
 * };
 * ```
 */
export function updateScene(scene: nexus, deltaTime: number): void {
  traverseAndUpdate(scene, deltaTime, false);
}
