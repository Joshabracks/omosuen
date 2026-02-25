/**
 * Omosuen Engine
 * An axonometric game engine with a static z-axis camera.
 */

import { setConfig as applyConfig } from './config';
import {
  getActiveScene,
  serializeComponentRecursive,
  deserializeComponentRecursive,
} from './scene';
import {
  pause,
  resume,
  getFPS,
  isPaused,
  isRunning,
  getFrameTime,
  markForDisposal,
} from './loop';
import { setComponentCount } from './component';
import { Vector2D, Vector3D, Vector4D } from './math';

// ============================================================================
// Component Exports
// ============================================================================
export * from './component';

// ============================================================================
// Math Exports
// ============================================================================
export * from './math';

// ============================================================================
// Scene Exports
// ============================================================================
export * from './scene';

// ============================================================================
// Loop Exports
// ============================================================================
export * from './loop';

// ============================================================================
// Config Exports
// ============================================================================
export { getConfig, setConfig } from './config';
export type { OmosuenConfig } from './config';

// ============================================================================
// Engine Core
// ============================================================================

/**
 * Engine version — injected at build time by webpack DefinePlugin from package.json
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
declare const __ENGINE_VERSION__: string;
export const version = __ENGINE_VERSION__;

/**
 * Engine name
 */
export const name = 'Omosuen';

/**
 * Initialize the Omosuen engine
 * @param config - Optional global configuration
 */
export function init(config?: import('./config').OmosuenConfig): void {
  if (config) {
    applyConfig(config);
  }
  console.log(`${name} Engine v${version} initialized`);
}

/**
 * Start the Omosuen game loop
 *
 * This function starts the main game loop using requestAnimationFrame.
 * It should be called after loading the initial scene.
 *
 * @param targetFPS - Target frames per second (default: 60)
 *
 * @example
 * ```typescript
 * import Omosuen from 'omosuen';
 *
 * // Load initial scene
 * await Omosuen.switchScene("MainMenu");
 *
 * // Start game loop
 * Omosuen.start(60);
 * ```
 */
export { start } from './loop/manager';

// ============================================================================
// Editor Bridge
// ============================================================================

/**
 * Expose engine APIs on `globalThis.Omosuen` for the editor overlay script.
 * Call this in your game's entry point to enable live editing from the
 * Omosuen Editor VS Code extension.
 *
 * @example
 * ```typescript
 * import { init, exposeEditorAPI } from 'omosuen';
 * init();
 * exposeEditorAPI();
 * ```
 */
export function exposeEditorAPI(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  (globalThis as any).Omosuen = {
    version,
    // Scene management
    getActiveScene,
    serializeComponentRecursive,
    deserializeComponentRecursive,
    // Loop control
    pause,
    resume,
    getFPS,
    isPaused,
    isRunning,
    getFrameTime,
    // Component lifecycle
    markForDisposal,
    setComponentCount,
    // Math constructors (for value reconstruction)
    Vector2D,
    Vector3D,
    Vector4D,
  };
}

/**
 * Default export for backward compatibility
 * Contains core engine properties and methods
 */
export default {
  version,
  name,
  init,
  setConfig: applyConfig,
};
