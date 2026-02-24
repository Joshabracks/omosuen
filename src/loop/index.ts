/**
 * Game Loop System
 *
 * Manages the main game loop, component lifecycle, and frame timing.
 */

// ============================================================================
// Loop Control
// ============================================================================
export {
  start,
  stop,
  pause,
  resume,
  isRunning,
  isPaused,
  getFrameTime,
  getFPS,
  getTargetFPS,
} from './manager';

// ============================================================================
// Initialization System
// ============================================================================
export {
  queueInit,
  processInitQueue,
  isInitializing,
  clearInitQueue,
  getInitQueueSize,
  getInitQueueLength,
} from './init';

// ============================================================================
// Update System
// ============================================================================
export { updateScene } from './update';

// ============================================================================
// Disposal System
// ============================================================================
export {
  queueDispose,
  markForDisposal,
  processDisposeQueue,
  clearDisposeQueue,
  getDisposeQueueSize,
} from './dispose';

// ============================================================================
// Render System (Stub)
// ============================================================================
export { renderScene } from './render';

// ============================================================================
// Messaging System (Stub)
// ============================================================================
export { pollMessages } from './messaging';

// ============================================================================
// Flag System (Stub)
// ============================================================================
export { pollFlags } from './flags';
