/**
 * Omosuen Engine
 * An axonometric game engine with a static z-axis camera.
 */

import { setConfig as applyConfig } from './config';
import {
  Vector2D,
  Vector3D,
  Vector4D,
  Array2D,
  Array3D,
  Array3Dc,
  Array3Di,
  Array3Dic,
  lerp,
} from './math';
import {
  ComponentUnique,
  ALL_MESSAGES,
  ANY_MESSAGES,
  createDefaultCellData,
  packCell,
  unpackCell,
} from './component';

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

  // Expose runtime exports for dynamically loaded .omo scripts
  (globalThis as Record<string, unknown>).__omosuen_exports = {
    Vector2D,
    Vector3D,
    Vector4D,
    Array2D,
    Array3D,
    Array3Dc,
    Array3Di,
    Array3Dic,
    lerp,
    ComponentUnique,
    ALL_MESSAGES,
    ANY_MESSAGES,
    createDefaultCellData,
    packCell,
    unpackCell,
  };

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
