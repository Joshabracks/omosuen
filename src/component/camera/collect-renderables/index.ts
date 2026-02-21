import { CellMapT } from '../../cell-map';
import { LightT } from '../../light';
import { NexusT } from '../../nexus';
import { SpriteT } from '../../sprite';
import { getProxiedComponent } from '../../types';
import { CameraT } from '../data';

/**
 * Collects all renderable components (sprites, cell maps, and lights) from the render tree.
 *
 * @param camera - The camera component
 * @returns Object containing arrays of sprites, cell maps, and lights
 */
export function collectRenderables(camera: CameraT): {
  sprites: SpriteT[];
  cellMaps: CellMapT[];
  lights: LightT[];
} {
  if (!camera.parent || camera.parent.type !== 'nexus') {
    return { sprites: [], cellMaps: [], lights: [] };
  }

  const parentNexus = getProxiedComponent(camera.parent!) as unknown as NexusT;

  // Search from scene root to find ALL components in the entire scene tree
  // This allows the camera to find components in sibling branches, not just children
  const sceneRoot = getProxiedComponent(
    parentNexus.parent!,
  ) as unknown as NexusT;

  // Recursively collect all sprites from the scene root
  // @ts-expect-error - Proxy methods exist at runtime but TypeScript can't infer them
  const sprites = sceneRoot.getComponentsByType('sprite', true) as SpriteT[];

  // Recursively collect all cell maps from the scene root
  // @ts-expect-error - Proxy methods exist at runtime but TypeScript can't infer them
  const cellMaps = sceneRoot.getComponentsByType(
    'cell-map',
    true,
  ) as CellMapT[];

  // Recursively collect all lights from the scene root
  // @ts-expect-error - Proxy methods exist at runtime but TypeScript can't infer them
  const lights = sceneRoot.getComponentsByType('light', true) as LightT[];

  return { sprites, cellMaps, lights };
}
