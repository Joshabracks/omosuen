import { CellMapT } from '../../cell-map';
import { NexusT } from '../../nexus';
import { SpriteT } from '../../sprite';
import { getProxiedComponent } from '../../types';
import { CameraT } from '../data';

/**
 * Collects all renderable components (sprites and cell maps) from the render tree.
 *
 * @param camera - The camera component
 * @returns Object containing arrays of sprites and cell maps
 */
export function collectRenderables(camera: CameraT): {
  sprites: SpriteT[];
  cellMaps: CellMapT[];
} {
  if (!camera.parent || camera.parent.type !== 'nexus') {
    return { sprites: [], cellMaps: [] };
  }

  const parentNexus = getProxiedComponent(camera.parent!) as unknown as NexusT;

  // Search from scene root to find ALL sprites in the entire scene tree
  // This allows the camera to find sprites in sibling branches, not just children
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

  return { sprites, cellMaps };
}
