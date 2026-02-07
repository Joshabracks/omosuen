/**
 * Progressive Initialization System
 *
 * Manages time-limited component initialization to prevent frame drops
 * during scene loading. Initialization is spread across multiple frames
 * if necessary to maintain target frame rate.
 */

import { ComponentData } from '../component';
import type { NexusT } from '../component/nexus/data';
import { MethodRegistry } from '../component/registry';

/**
 * Queue of component IDs awaiting initialization.
 * Components are initialized in FIFO order.
 */
const INIT_QUEUE: number[] = [];

/**
 * Total number of components to initialize in the current cycle.
 * Set to -1 when idle (no initialization in progress).
 */
let INIT_QUEUE_LENGTH = -1;

/**
 * Flag indicating whether initialization is currently in progress.
 * When true, only components with loader=true will be updated.
 */
let INITIALIZATION_IN_PROGRESS = false;

/**
 * Adds a component ID to the initialization queue.
 *
 * This function is called automatically by newComponent() when a
 * component is created. Components are initialized at the start of
 * the next frame.
 *
 * @param id - The ID of the component to initialize
 *
 * @example
 * ```typescript
 * const component = await newComponent("sprite", { name: "Player" });
 * // Component is automatically queued for init
 * ```
 */
export function queueInit(id: number): void {
  INIT_QUEUE.push(id);
}

/**
 * Processes the initialization queue with time-limited execution.
 *
 * This function is called automatically at the start of each frame.
 * It initializes as many components as possible within the target
 * frame time budget. If the budget is exceeded, initialization
 * continues in the next frame.
 *
 * Algorithm:
 * 1. If starting a new cycle, record total queue length
 * 2. Record start time
 * 3. Process components from queue until:
 *    - Queue is empty (all done), OR
 *    - Time budget exceeded (continue next frame)
 * 4. Set INITIALIZATION_IN_PROGRESS flag accordingly
 *
 * Performance: O(n) where n is number of components initialized
 * per frame. Time-limited to maintain target FPS.
 *
 * @param scene - The active scene to search for components
 * @param targetFrameTime - Target frame time in milliseconds (e.g., 16.67 for 60fps)
 *
 * @example
 * ```typescript
 * // Called automatically by game loop
 * processInitQueue(activeScene, 16.67);
 * ```
 */
export function processInitQueue(scene: NexusT, targetFrameTime: number): void {
  // Start new init cycle
  if (INIT_QUEUE_LENGTH === -1 && INIT_QUEUE.length > 0) {
    INIT_QUEUE_LENGTH = INIT_QUEUE.length;
    console.info(
      `[INIT] Starting initialization of ${INIT_QUEUE_LENGTH} components`,
    );
  }

  // Nothing to initialize
  if (INIT_QUEUE.length === 0) {
    if (INITIALIZATION_IN_PROGRESS) {
      console.info(
        `[INIT] Completed initialization of ${INIT_QUEUE_LENGTH} components`,
      );
    }
    INITIALIZATION_IN_PROGRESS = false;
    INIT_QUEUE_LENGTH = -1;
    return;
  }

  const startTime = performance.now();
  let componentsInitialized = 0;

  while (INIT_QUEUE.length > 0) {
    const id = INIT_QUEUE.shift()!;
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
    const component: ComponentData | null = scene.getComponentById(id, true);

    if (!component) {
      console.warn(`[INIT] Component ID ${id} not found in scene`);
      continue;
    }

    // Skip if already initialized
    if (component._initialized) {
      continue;
    }

    // Call init if it exists
    const method = MethodRegistry[component.type];
    if (method.init && typeof method.init === 'function') {
      method.init(component);
    }

    // Mark as initialized
    component._initialized = true;
    componentsInitialized++;

    // Check time budget
    const elapsed = performance.now() - startTime;
    if (elapsed >= targetFrameTime) {
      INITIALIZATION_IN_PROGRESS = true;
      const remaining = INIT_QUEUE.length;
      const total = INIT_QUEUE_LENGTH;
      const completed = total - remaining;
      console.info(
        `[INIT] Initialized ${componentsInitialized} components this frame (${completed}/${total} total, ${remaining} remaining)`,
      );
      return; // Exit early, continue next frame
    }
  }

  // All done
  console.info(
    `[INIT] Completed initialization of ${componentsInitialized} components (${INIT_QUEUE_LENGTH} total)`,
  );
  INITIALIZATION_IN_PROGRESS = false;
  INIT_QUEUE_LENGTH = -1;
}

/**
 * Checks if progressive initialization is currently in progress.
 *
 * When initialization is in progress, only components with loader=true
 * will be updated, allowing loading screens and progress indicators to
 * function during large scene loads.
 *
 * @returns True if initialization is in progress, false otherwise
 *
 * @example
 * ```typescript
 * if (isInitializing()) {
 *   // Only update loader components
 *   if (component.loader) {
 *     updateLoadingBar();
 *   }
 * }
 * ```
 */
export function isInitializing(): boolean {
  return INITIALIZATION_IN_PROGRESS;
}

/**
 * Clears the initialization queue without processing.
 *
 * This is primarily used for testing or when resetting the game state.
 *
 * @example
 * ```typescript
 * clearInitQueue();
 * ```
 */
export function clearInitQueue(): void {
  INIT_QUEUE.length = 0;
  INIT_QUEUE_LENGTH = -1;
  INITIALIZATION_IN_PROGRESS = false;
}

/**
 * Gets the current size of the initialization queue.
 *
 * Useful for debugging and monitoring initialization progress.
 *
 * @returns The number of components waiting for initialization
 *
 * @example
 * ```typescript
 * const pending = getInitQueueSize();
 * console.log(`${pending} components pending initialization`);
 * ```
 */
export function getInitQueueSize(): number {
  return INIT_QUEUE.length;
}

/**
 * Gets the total number of components to initialize in the current cycle.
 *
 * Returns -1 if no initialization cycle is active.
 *
 * @returns Total components in current init cycle, or -1 if idle
 *
 * @example
 * ```typescript
 * const total = getInitQueueLength();
 * const remaining = getInitQueueSize();
 * const progress = (total - remaining) / total;
 * ```
 */
export function getInitQueueLength(): number {
  return INIT_QUEUE_LENGTH;
}
