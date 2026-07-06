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
 * Per-cycle `id → component` index and a "queue is sorted" flag. The queue is
 * resolved + sorted ONCE per cycle (rebuilt only when new items are queued
 * mid-cycle), instead of re-sorting every frame with O(scene) lookups in the
 * comparator — which was O(Q² log Q) per frame and dominated large scene loads.
 */
let ID_TO_COMPONENT: Map<number, ComponentData> | null = null;
let QUEUE_SORTED = false;

/**
 * The component whose init is currently running (or paused mid-progressive-init),
 * exposed via getInitializingComponent() so a loading UI can show what's loading.
 */
let CURRENT_INIT: ComponentData | null = null;

/**
 * Active progressive-init generator, persisted across frames so a heavy init can
 * be advanced in per-frame slices (resumed where it left off) instead of blocking
 * the game loop for its full duration.
 */
let ACTIVE_GEN: AsyncGenerator<void> | null = null;

/**
 * id → resolver for the awaitable `component.ready` promise (see
 * attachReady/markInitialized). Keyed by id (not the component object) so it
 * works across the raw/proxy identity split — newComponent holds the raw
 * object while the scheduler holds the proxy.
 */
const READY_RESOLVERS = new Map<number, (ready: boolean) => void>();

/**
 * Attaches an awaitable `ready` promise that resolves true when the component's
 * init completes. Called by newComponent so the promise exists before init runs
 * (init is queued and runs frame-budgeted on a later frame).
 */
export function attachReady(component: ComponentData): void {
  if (component.id === undefined || component._initialized) return;
  component.ready = new Promise<boolean>((resolve) => {
    READY_RESOLVERS.set(component.id!, resolve);
  });
}

/** Sets _initialized and resolves the component's ready promise (if any). */
function markInitialized(component: ComponentData): void {
  component._initialized = true;
  if (component.id === undefined) return;
  const resolve = READY_RESOLVERS.get(component.id);
  if (resolve) {
    resolve(true);
    READY_RESOLVERS.delete(component.id);
  }
}

/**
 * Indexes every component in the scene tree by id (single O(scene) walk), so the
 * init cycle can resolve queued ids in O(1) instead of recursive getComponentById.
 */
function indexScene(n: NexusT, map: Map<number, ComponentData>): void {
  if (n.id !== undefined) map.set(n.id, n);
  for (let i = 0; i < n.components.length; i++) {
    const c = n.components[i];
    if (c.id !== undefined) map.set(c.id, c);
    if (c.type === 'nexus') {
      indexScene(c as NexusT, map);
    }
  }
}

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
  // Force a re-index + re-sort on the next processInitQueue (handles components
  // created mid-cycle by another component's init()).
  QUEUE_SORTED = false;
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
export async function processInitQueue(
  scene: NexusT,
  targetFrameTime: number,
): Promise<void> {
  // Start new init cycle
  if (INIT_QUEUE_LENGTH === -1 && INIT_QUEUE.length > 0) {
    INIT_QUEUE_LENGTH = INIT_QUEUE.length;
  }

  const deadline = performance.now() + targetFrameTime;

  // Resume a progressive init that paused on a previous frame.
  if (ACTIVE_GEN) {
    let done: boolean;
    try {
      done = await pumpGenerator(ACTIVE_GEN, deadline);
    } catch (error) {
      resetInitState();
      throw error;
    }
    if (!done) {
      INITIALIZATION_IN_PROGRESS = true;
      return; // still initializing — continue next frame
    }
    if (CURRENT_INIT) markInitialized(CURRENT_INIT);
    ACTIVE_GEN = null;
    CURRENT_INIT = null;
  }

  // Nothing to initialize
  if (INIT_QUEUE.length === 0) {
    resetInitState();
    return;
  }

  // Budget already spent this frame (e.g. by the resumed generator) — yield.
  if (performance.now() >= deadline) {
    INITIALIZATION_IN_PROGRESS = true;
    return;
  }

  // Resolve + sort ONCE per cycle (rebuilt only when items are queued mid-cycle,
  // flagged by queueInit). The id index makes both the defer-sort comparator and
  // the per-component fetch O(1) instead of O(scene). Previously this sort ran
  // every frame with two recursive getComponentById calls per comparison.
  if (!QUEUE_SORTED) {
    const idx = new Map<number, ComponentData>();
    indexScene(scene, idx);
    ID_TO_COMPONENT = idx;
    INIT_QUEUE.sort((a, b) => {
      const deferA = idx.get(a)?._initDefer || 0;
      const deferB = idx.get(b)?._initDefer || 0;
      return deferA - deferB;
    });
    QUEUE_SORTED = true;
  }

  const index = ID_TO_COMPONENT!;

  while (INIT_QUEUE.length > 0) {
    const id = INIT_QUEUE.shift()!;
    const component: ComponentData | null =
      index.get(id) ?? scene.getComponentById(id, true);

    if (!component) {
      console.warn(`[INIT] Component ID ${id} not found in scene`);
      continue;
    }

    // Skip if already initialized
    if (component._initialized) {
      continue;
    }

    const method = MethodRegistry[component.type];
    CURRENT_INIT = component;

    if (
      method.initProgressive &&
      typeof method.initProgressive === 'function'
    ) {
      // Resumable init: drive the generator within the frame budget. If it
      // doesn't finish this frame, it's persisted in ACTIVE_GEN and resumed
      // next frame (the loop keeps rendering in between).
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
      const gen: AsyncGenerator<void> = method.initProgressive(component);
      ACTIVE_GEN = gen;
      let done: boolean;
      try {
        done = await pumpGenerator(gen, deadline);
      } catch (error) {
        resetInitState();
        throw error;
      }
      if (!done) {
        INITIALIZATION_IN_PROGRESS = true;
        return; // paused — resume next frame
      }
      markInitialized(component);
      ACTIVE_GEN = null;
      CURRENT_INIT = null;
    } else {
      // Call init if it exists (async)
      if (method.init && typeof method.init === 'function') {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        await method.init(component);
      }

      // Call instance-specific init override if set
      if (component.initOverride) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const overrideMethod = method[component.initOverride];
        if (overrideMethod && typeof overrideMethod === 'function') {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-call
          await overrideMethod(component);
        } else {
          console.warn(
            `[INIT] Custom init method '${component.initOverride}' not found for component '${component.name}'`,
          );
        }
      }

      markInitialized(component);
      CURRENT_INIT = null;
    }

    // Check time budget
    if (performance.now() >= deadline) {
      INITIALIZATION_IN_PROGRESS = true;
      return; // Exit early, continue next frame
    }
  }

  // All done
  resetInitState();
}

/**
 * Advances a progressive-init generator until it completes or the per-frame
 * deadline is reached. Always runs at least one step so progress is guaranteed.
 * Returns true when the generator is done.
 */
async function pumpGenerator(
  gen: AsyncGenerator<void>,
  deadline: number,
): Promise<boolean> {
  for (;;) {
    const res = await gen.next();
    if (res.done) return true;
    if (performance.now() >= deadline) return false;
  }
}

/** Resets the scheduler to idle (no cycle in progress). */
function resetInitState(): void {
  INITIALIZATION_IN_PROGRESS = false;
  INIT_QUEUE_LENGTH = -1;
  ID_TO_COMPONENT = null;
  QUEUE_SORTED = false;
  ACTIVE_GEN = null;
  CURRENT_INIT = null;
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
 * Returns the component currently being initialized (running, or paused
 * mid-progressive-init), or null when idle. Lets a loading UI show what's
 * loading, e.g. `Omosuen.getInitializingComponent()?.name`.
 */
export function getInitializingComponent(): ComponentData | null {
  return CURRENT_INIT;
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
  READY_RESOLVERS.clear();
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
