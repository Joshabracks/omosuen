/**
 * Render System (Stub)
 *
 * This module will handle scene rendering in the future. Currently
 * it's a stub to earmark the rendering phase in the game loop.
 */

import type { NexusT } from '../component/nexus/data';

/**
 * Renders the active scene by calling render() on all camera components.
 *
 * Cameras are responsible for:
 * - Collecting renderable components (sprites, cell maps)
 * - Managing WebGL state and shaders
 * - Rendering to their assigned viewports
 *
 * FUTURE ENHANCEMENTS:
 * - Sprite batching for performance
 * - Depth sorting for proper rendering order
 * - Render layer management
 * - Post-processing effects
 *
 * @param scene - The scene to render
 *
 * @example
 * ```typescript
 * // Called automatically by game loop
 * renderScene(activeScene);
 * ```
 */
export function renderScene(scene: NexusT): void {
  // Import nexus methods dynamically to avoid circular dependencies
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getComponentsByType } = require('../component/nexus/methods').Nexus;

  // Find all camera components in the scene (recursive search)
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  const cameras = getComponentsByType(scene, 'camera', true);

  // Render from each camera
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  for (const camera of cameras) {
    // Each camera has a render() method that handles its own rendering
    // Delta time is not needed for rendering (only for animations/updates)
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    camera.render(0);
  }
}
