/**
 * Omosuen Engine
 * An axonometric game engine with a static z-axis camera.
 */

import { setConfig as applyConfig } from './config';

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
 * Engine version
 */
export const version = '0.1.1';

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
