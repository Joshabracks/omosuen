/**
 * Render System (Stub)
 *
 * This module will handle scene rendering in the future. Currently
 * it's a stub to earmark the rendering phase in the game loop.
 */

import type { CameraT } from '../component/camera/data';
import type { NexusT } from '../component/nexus/data';
import { Nexus } from '../component/nexus/methods';

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

  // Find all camera components in the scene (recursive search)
  const cameras = Nexus.getComponentsByType(scene, 'camera', true) as CameraT[];

  // Render from each camera
  for (const camera of cameras) {
    // Each camera has a render() method that handles its own rendering
    // Delta time is not needed for rendering (only for animations/updates)
    // @ts-expect-error - camera has proxy for render
    camera.render(0);
  }
}
