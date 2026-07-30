/**
 * Game Loop Manager
 *
 * Central controller for the game loop using requestAnimationFrame.
 * Manages frame timing, delta time calculation, and orchestrates
 * all game loop phases (init, update, dispose, render, messaging, flags).
 */

import { getActiveScene } from '../scene/loader';
import { processInitQueue } from './init';
import { updateScene } from './update';
import { processDisposeQueue } from './dispose';
import { renderScene } from './render';
import { pollMessages } from './messaging';
import { pollFlags } from './flags';
import { updateWorldTransforms } from '../component/transform/world';
import { beginFrame, endFrame, isProfilingEnabled, recordPhase } from './profile';

/**
 * Whether the game loop is currently running
 */
let loopRunning = false;

/**
 * Whether updates are paused (loop continues but updates are skipped)
 */
let loopPaused = false;

/**
 * Timestamp of the last frame in milliseconds
 */
let lastFrameTime = 0;

/**
 * Time elapsed since last frame in milliseconds
 */
let deltaTime = 0;

/**
 * Current frames per second
 */
let currentFPS = 0;

/**
 * Target frames per second (used for init time budget)
 */
let targetFPS = 60;

/**
 * RequestAnimationFrame handle for cancellation
 */
let animationFrameId = 0;

/**
 * Main game loop function.
 *
 * Called once per frame by requestAnimationFrame. Performs the following
 * operations in order:
 * 1. Calculate delta time and FPS
 * 2. Process initialization queue (progressive, time-limited, async)
 * 3. Update all components (respects pause state and loader flags)
 * 4. Process disposal queue (batched)
 * 5. Render scene
 * 6. Poll messages (stub)
 * 7. Poll flags (stub)
 * 8. Schedule next frame
 *
 * @param currentTime - Current timestamp from requestAnimationFrame
 */
async function gameLoop(currentTime: number): Promise<void> {
  // Calculate deltaTime (uncapped - reflects actual elapsed time)
  if (lastFrameTime === 0) {
    // First frame - initialize lastFrameTime
    lastFrameTime = currentTime;
    deltaTime = 0;
  } else {
    deltaTime = currentTime - lastFrameTime;
    lastFrameTime = currentTime;
  }

  // Calculate FPS
  currentFPS = deltaTime > 0 ? 1000 / deltaTime : 0;

  const profiling = isProfilingEnabled();
  if (profiling) beginFrame();

  // Get active scene
  const activeScene = getActiveScene();
  if (!activeScene) {
    // No scene loaded - skip to next frame
    animationFrameId = requestAnimationFrame(gameLoop);
    return;
  }

  // Calculate target frame time for progressive init
  const targetFrameTime = 1000 / targetFPS; // e.g., 16.67ms for 60fps

  // 1. Progressive initialization (time-limited, async)
  let t0 = profiling ? performance.now() : 0;
  await processInitQueue(activeScene, targetFrameTime);
  if (profiling) recordPhase('init', performance.now() - t0);

  // 2. Update components (skip if paused)
  if (!loopPaused) {
    t0 = profiling ? performance.now() : 0;
    updateScene(activeScene, deltaTime);
    if (profiling) recordPhase('update', performance.now() - t0);
  }

  // 3. Process disposal queue
  t0 = profiling ? performance.now() : 0;
  processDisposeQueue(activeScene);
  if (profiling) recordPhase('dispose', performance.now() - t0);

  // 3.5 Refresh cached world transforms (parent→child) after logic has set locals,
  // before render reads them. Runs even while paused, since render does.
  t0 = profiling ? performance.now() : 0;
  updateWorldTransforms(activeScene);
  if (profiling) recordPhase('transforms', performance.now() - t0);

  // 4. Render (stub)
  t0 = profiling ? performance.now() : 0;
  renderScene(activeScene);
  if (profiling) recordPhase('render', performance.now() - t0);

  // 5. Poll messages (stub)
  t0 = profiling ? performance.now() : 0;
  pollMessages();

  // 6. Poll flags (stub)
  pollFlags();
  if (profiling) recordPhase('messages', performance.now() - t0);

  if (profiling) endFrame(deltaTime, currentFPS);

  // Schedule next frame (wrap async gameLoop to handle errors)
  animationFrameId = requestAnimationFrame((time) => {
    gameLoop(time).catch((err) => {
      console.error('[GAME LOOP] Async error in game loop:', err);
    });
  });
}

/**
 * Starts the game loop.
 *
 * This function should be called after loading the initial scene.
 * The loop will run continuously until stop() is called.
 *
 * @param fps - Target frames per second (default: 60)
 *
 * @example
 * ```typescript
 * import { start } from 'omosuen';
 *
 * // Load initial scene
 * await switchScene("MainMenu");
 *
 * // Start game loop
 * start(60);
 * ```
 */
export function start(fps: number = 60): void {
  if (loopRunning) {
    console.warn('[GAME LOOP] Loop is already running');
    return;
  }

  targetFPS = fps;
  loopRunning = true;
  loopPaused = false;
  lastFrameTime = 0;
  deltaTime = 0;

  console.info(`[GAME LOOP] Starting game loop (target: ${targetFPS} FPS)`);

  // Start the loop (wrap async gameLoop to handle errors)
  animationFrameId = requestAnimationFrame((time) => {
    gameLoop(time).catch((err) => {
      console.error('[GAME LOOP] Async error in game loop:', err);
    });
  });
}

/**
 * Stops the game loop completely.
 *
 * This cancels the requestAnimationFrame and resets loop state.
 * To temporarily pause updates while keeping the loop running,
 * use pause() instead.
 *
 * @example
 * ```typescript
 * import { stop } from 'omosuen';
 *
 * stop();
 * console.log("Game loop stopped");
 * ```
 */
export function stop(): void {
  if (!loopRunning) {
    console.warn('[GAME LOOP] Loop is not running');
    return;
  }

  cancelAnimationFrame(animationFrameId);
  loopRunning = false;
  loopPaused = false;
  lastFrameTime = 0;
  deltaTime = 0;

  console.info('[GAME LOOP] Game loop stopped');
}

/**
 * Pauses component updates.
 *
 * The game loop continues to run, but component update() methods are
 * not called. Components with loader=true will still update during
 * initialization phases. Use this for pause menus and similar features.
 *
 * @example
 * ```typescript
 * import { pause } from 'omosuen';
 *
 * // Show pause menu
 * pause();
 * ```
 */
export function pause(): void {
  if (!loopRunning) {
    console.warn('[GAME LOOP] Cannot pause - loop is not running');
    return;
  }

  if (loopPaused) {
    console.warn('[GAME LOOP] Loop is already paused');
    return;
  }

  loopPaused = true;
  console.info('[GAME LOOP] Game loop paused');
}

/**
 * Resumes component updates after pause().
 *
 * @example
 * ```typescript
 * import { resume } from 'omosuen';
 *
 * // Hide pause menu
 * resume();
 * ```
 */
export function resume(): void {
  if (!loopRunning) {
    console.warn('[GAME LOOP] Cannot resume - loop is not running');
    return;
  }

  if (!loopPaused) {
    console.warn('[GAME LOOP] Loop is not paused');
    return;
  }

  loopPaused = false;
  console.info('[GAME LOOP] Game loop resumed');
}

/**
 * Checks if the game loop is currently running.
 *
 * @returns True if the loop is active, false otherwise
 *
 * @example
 * ```typescript
 * import { isRunning } from 'omosuen';
 *
 * if (!isRunning()) {
 *   start();
 * }
 * ```
 */
export function isRunning(): boolean {
  return loopRunning;
}

/**
 * Checks if component updates are currently paused.
 *
 * @returns True if updates are paused, false otherwise
 *
 * @example
 * ```typescript
 * import { isPaused } from 'omosuen';
 *
 * if (isPaused()) {
 *   resume();
 * }
 * ```
 */
export function isPaused(): boolean {
  return loopPaused;
}

/**
 * Gets the time elapsed since the last frame.
 *
 * This value is not capped and reflects the actual time that passed.
 * Components should multiply time-based values by deltaTime to ensure
 * frame-rate independent behavior.
 *
 * @returns Delta time in milliseconds
 *
 * @example
 * ```typescript
 * import { getFrameTime } from 'omosuen';
 *
 * const dt = getFrameTime();
 * console.log(`Last frame took ${dt.toFixed(2)}ms`);
 * ```
 *
 * @example
 * ```typescript
 * // In component update method
 * update: (component: ComponentData, deltaTime: number) => {
 *   const s = component as sprite;
 *   // Move at 100 pixels per second, regardless of frame rate
 *   s.position.x += 100 * (deltaTime / 1000);
 * }
 * ```
 */
export function getFrameTime(): number {
  return deltaTime;
}

/**
 * Gets the current frames per second.
 *
 * This is calculated based on the actual delta time and represents
 * the instantaneous FPS (not averaged).
 *
 * @returns Current FPS
 *
 * @example
 * ```typescript
 * import { getFPS } from 'omosuen';
 *
 * const fps = getFPS();
 * console.log(`Running at ${fps.toFixed(1)} FPS`);
 * ```
 */
export function getFPS(): number {
  return currentFPS;
}

/**
 * Gets the target frames per second.
 *
 * This is the target FPS set when start() was called. It's used
 * to calculate the time budget for progressive initialization.
 *
 * @returns Target FPS
 *
 * @example
 * ```typescript
 * import { getTargetFPS } from 'omosuen';
 *
 * const target = getTargetFPS();
 * console.log(`Target FPS: ${target}`);
 * ```
 */
export function getTargetFPS(): number {
  return targetFPS;
}
