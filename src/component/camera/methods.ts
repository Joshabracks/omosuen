import { ComponentData, ComponentMethods } from '../types';
import { CameraT } from './data';
import { NexusT } from '../nexus/data';
import { TransformT } from '../transform/data';
import { ViewportT } from '../viewport/data';
import { SpriteT } from '../sprite/data';
import { CellMapT } from '../cell-map/data';

export interface CameraMethods extends ComponentMethods {
  render: (camera: CameraT, deltaTime: number) => void;
  collectRenderables: (
    camera: CameraT,
  ) => { sprites: SpriteT[]; cellMaps: CellMapT[] };
  pan: (camera: CameraT, offsetX: number, offsetY: number) => void;
  setZoom: (camera: CameraT, zoom: number) => void;
  init: (component: ComponentData) => void;
  dispose: (component: ComponentData) => void;
}

/**
 * Renders the scene from the camera's perspective.
 * This is called by the main render loop.
 *
 * @param camera - The camera component
 * @param deltaTime - Time elapsed since last frame in milliseconds
 */
function render(camera: CameraT, deltaTime: number): void {
  if (!camera.parent || camera.parent.type !== 'nexus') {
    console.warn(
      `[camera] Camera '${camera.name}' has no parent nexus, cannot render`,
    );
    return;
  }

  const parentNexus = camera.parent as NexusT;

  // Get sibling transform for camera position
  // @ts-expect-error - getComponentByType exists at runtime via Proxy
  const transform = parentNexus.getComponentByType('transform', false) as
    | TransformT
    | null;

  if (!transform) {
    console.warn(
      `[camera] Camera '${camera.name}' has no sibling transform component`,
    );
    return;
  }

  // Get viewport to render to
  // @ts-expect-error - getComponentByName exists at runtime via Proxy
  const viewport = parentNexus.getComponentByName(camera.viewportRef, false) as
    | ViewportT
    | null;

  if (!viewport || !viewport.gl) {
    console.warn(
      `[camera] Camera '${camera.name}' cannot find viewport '${camera.viewportRef}' or WebGL context`,
    );
    return;
  }

  // Skip rendering if no redraw needed (optimization for future)
  if (!camera.needsRedraw) {
    return;
  }

  // Collect all renderable components from the tree
  const { sprites, cellMaps } = Camera.collectRenderables(camera);

  // TODO: Implement actual rendering
  // For now, this is a stub that will be filled in with:
  // 1. Set up projection matrices (axonometric)
  // 2. Clear the viewport
  // 3. Render cell maps (instanced rendering)
  // 4. Render sprites (billboarded quads)
  // 5. Handle depth sorting

  const gl = viewport.gl;

  // Clear the canvas
  gl.clearColor(
    viewport.backgroundColor.x,
    viewport.backgroundColor.y,
    viewport.backgroundColor.z,
    viewport.backgroundColor.w,
  );
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  // Mark as rendered
  camera.needsRedraw = false;

  // Log rendering info for debugging (will be removed in production)
  if (sprites.length > 0 || cellMaps.length > 0) {
    console.debug(
      `[camera] Rendered ${sprites.length} sprites and ${cellMaps.length} cell maps from position (${transform.position.x}, ${transform.position.y}) at zoom ${camera.zoom}`,
    );
  }
}

/**
 * Collects all renderable components (sprites and cell maps) from the render tree.
 *
 * @param camera - The camera component
 * @returns Object containing arrays of sprites and cell maps
 */
function collectRenderables(
  camera: CameraT,
): { sprites: SpriteT[]; cellMaps: CellMapT[] } {
  if (!camera.parent || camera.parent.type !== 'nexus') {
    return { sprites: [], cellMaps: [] };
  }

  const parentNexus = camera.parent as NexusT;

  // Recursively collect all sprites from the tree
  // @ts-expect-error - getComponentsByType exists at runtime via Proxy
  const sprites = parentNexus.getComponentsByType('sprite', true) as SpriteT[];

  // Recursively collect all cell maps from the tree
  // @ts-expect-error - getComponentsByType exists at runtime via Proxy
  const cellMaps = parentNexus.getComponentsByType(
    'cell-map',
    true,
  ) as CellMapT[];

  return { sprites, cellMaps };
}

/**
 * Pans the camera by updating the sibling transform's position.
 *
 * @param camera - The camera component
 * @param offsetX - X offset to pan by
 * @param offsetY - Y offset to pan by
 */
function pan(camera: CameraT, offsetX: number, offsetY: number): void {
  if (!camera.parent || camera.parent.type !== 'nexus') {
    console.warn(
      `[camera] Camera '${camera.name}' has no parent nexus, cannot pan`,
    );
    return;
  }

  const parentNexus = camera.parent as NexusT;
  // @ts-expect-error - getComponentByType exists at runtime via Proxy
  const transform = parentNexus.getComponentByType('transform', false) as
    | TransformT
    | null;

  if (!transform) {
    console.warn(
      `[camera] Camera '${camera.name}' has no sibling transform component, cannot pan`,
    );
    return;
  }

  // Update transform position
  transform.position.x += offsetX;
  transform.position.y += offsetY;

  // Mark for redraw
  camera.needsRedraw = true;
}

/**
 * Sets the camera zoom level.
 *
 * @param camera - The camera component
 * @param zoom - New zoom level (1.0 = normal, 2.0 = 2x zoom, etc.)
 */
function setZoom(camera: CameraT, zoom: number): void {
  if (zoom <= 0) {
    console.warn(`[camera] Invalid zoom level ${zoom}, must be > 0`);
    return;
  }

  camera.zoom = zoom;
  camera.needsRedraw = true;
}

/**
 * Initializes WebGL resources for the camera (shader programs, buffers).
 * Called automatically when the component is added to the scene.
 *
 * @param component - The camera component
 */
function init(component: ComponentData): void {
  const camera = component as CameraT;
  if (!camera.parent || camera.parent.type !== 'nexus') {
    console.warn(
      `[camera] Camera '${camera.name}' has no parent nexus, cannot initialize`,
    );
    return;
  }

  const parentNexus = camera.parent as NexusT;
  // @ts-expect-error - getComponentByName exists at runtime via Proxy
  const viewport = parentNexus.getComponentByName(camera.viewportRef, false) as
    | ViewportT
    | null;

  if (!viewport || !viewport.gl) {
    console.warn(
      `[camera] Camera '${camera.name}' cannot find viewport '${camera.viewportRef}' or WebGL context, cannot initialize`,
    );
    return;
  }

  const gl = viewport.gl;

  // TODO: Initialize shader programs
  // For now, this is a stub that will be filled in with:
  // 1. Compile vertex and fragment shaders for cell maps
  // 2. Compile vertex and fragment shaders for sprites
  // 3. Create uniform locations
  // 4. Create vertex buffers

  console.log(
    `[camera] Camera '${camera.name}' initialized with WebGL context`,
  );

  camera.needsRedraw = true;
}

/**
 * Disposes WebGL resources when the camera is removed.
 *
 * @param component - The camera component
 */
function dispose(component: ComponentData): void {
  const camera = component as CameraT;
  // TODO: Clean up WebGL resources
  // For now, this is a stub that will be filled in with:
  // 1. Delete shader programs
  // 2. Delete buffers
  // 3. Release GPU resources

  if (camera.glResources.cellMapProgram) {
    camera.glResources.cellMapProgram = null;
  }

  if (camera.glResources.spriteProgram) {
    camera.glResources.spriteProgram = null;
  }

  camera._disposed = true;

  console.log(`[camera] Camera '${camera.name}' disposed`);
}

export const Camera: CameraMethods = {
  type: 'camera',
  render,
  collectRenderables,
  pan,
  setZoom,
  init,
  dispose,
};
