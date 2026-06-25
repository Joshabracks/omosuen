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
  TrackController,
  registerPluginComponent,
  PickBuffer,
  PickKind,
  createPickBuffer,
} from './component';
import type { ComponentTypeDefinition } from './component';

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
export async function init(
  config?: import('./config').OmosuenConfig,
): Promise<void> {
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
    TrackController,
    PickBuffer,
    PickKind,
    createPickBuffer,
  };

  // Register plugin components. Runs after the `Omosuen` global is mounted (the
  // UMD wrapper assigns it before user code calls init), so self-registering JS
  // plugin files can call window.Omosuen.registerPluginComponent themselves.
  await loadPlugins(config?.plugins);

  console.log(`${name} Engine v${version} initialized`);
}

/**
 * Registers each entry in the `plugins` init option: a ComponentTypeDefinition
 * is registered directly; a string is treated as a filepath to a JS file that is
 * executed (and self-registers). Unsupported entries are skipped with a warning.
 * A failed file load warns rather than throwing, so one bad plugin can't abort init.
 */
async function loadPlugins(
  plugins?: (ComponentTypeDefinition | string)[],
): Promise<void> {
  if (!plugins || plugins.length === 0) return;
  for (const entry of plugins) {
    if (typeof entry === 'string') {
      await runPluginFile(entry);
    } else if (entry && typeof entry === 'object') {
      registerPluginComponent(entry);
    } else {
      console.warn(
        '[plugin] unsupported plugins entry (expected ComponentTypeDefinition or filepath string)',
        entry,
      );
    }
  }
}

/**
 * Loads and executes a plugin JS file by appending a <script> tag (works under
 * file://). The file is expected to call Omosuen.registerPluginComponent itself.
 * Resolves on load or error (errors warn) so init never rejects on a bad plugin.
 */
function runPluginFile(path: string): Promise<void> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      console.warn(
        `[plugin] cannot load plugin file '${path}' — no document (non-browser environment)`,
      );
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = path;
    script.onload = () => resolve();
    script.onerror = () => {
      console.warn(`[plugin] failed to load plugin file '${path}'`);
      resolve();
    };
    document.head.appendChild(script);
  });
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
