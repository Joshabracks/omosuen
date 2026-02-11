import {
  ComponentData,
  ComponentOptions,
  ComponentSerializer,
  ComponentUnique,
  ComponentInstanceMethods,
} from '../types';
import type { CameraMethods } from './methods';

/**
 * Camera component for axonometric 3D rendering that appears 2D.
 * Renders cell maps and billboard sprites within the render tree.
 */
export interface CameraT
  extends ComponentData, ComponentInstanceMethods<CameraMethods> {
  type: 'camera';
  unique: ComponentUnique.LOCAL;

  /**
   * Zoom level for the camera.
   * 1.0 = normal, 2.0 = 2x zoom, 0.5 = zoomed out
   */
  zoom: number;

  /**
   * Axonometric projection angle in degrees.
   * Typically around 30 degrees for isometric-like appearance.
   */
  axonometricAngle: number;

  /**
   * Reference to the viewport component to render to.
   * Looked up by name in the parent nexus.
   */
  viewportRef: string;

  /**
   * Flag indicating the scene needs to be redrawn.
   */
  needsRedraw: boolean;

  /**
   * WebGL rendering resources (shader programs, buffers, etc.)
   */
  glResources: {
    cellMapProgram: WebGLProgram | null;
    spriteProgram: WebGLProgram | null;
  };
}

export interface CameraOptions extends ComponentOptions {
  /**
   * Initial zoom level (default: 1.0)
   */
  zoom?: number;

  /**
   * Axonometric angle in degrees (default: 30)
   */
  axonometricAngle?: number;

  /**
   * Name of the viewport component to render to (required)
   */
  viewportRef: string;
}

/**
 * Builder function for creating Camera components.
 */
export function builder(options: CameraOptions): CameraT {
  if (!options.viewportRef) {
    throw new Error('Camera requires a viewportRef');
  }

  const camera = {
    type: 'camera' as const,
    name: options.name,
    unique: ComponentUnique.LOCAL,
    parent: null,
    _disposed: false,

    zoom: options.zoom ?? 1.0,
    axonometricAngle: options.axonometricAngle ?? 30,
    viewportRef: options.viewportRef,
    needsRedraw: true,

    glResources: {
      cellMapProgram: null,
      spriteProgram: null,
    },
  };

  return camera as unknown as CameraT;
}

/**
 * Serializes a camera component to a plain object.
 * WebGL resources are not serialized - they will be recreated on init.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serialize(component: ComponentData): any {
  const c = component as CameraT;

  return {
    type: 'camera',
    name: c.name,
    unique: ComponentUnique.LOCAL,
    zoom: c.zoom,
    axonometricAngle: c.axonometricAngle,
    viewportRef: c.viewportRef,
  };
}

/**
 * Deserializes a plain object back into a camera component.
 * WebGL resources will be recreated during init.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deserialize(data: any): CameraT {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const { type, name, zoom, axonometricAngle, viewportRef } = data;

  const errors = [];
  if (type !== 'camera') {
    errors.push(`type ${type} does not match "camera"`);
  }
  if (!name) {
    errors.push('camera requires a name');
  }
  if (!viewportRef) {
    errors.push('camera requires a viewportRef');
  }
  if (errors.length) {
    throw new Error(errors.join('\n'));
  }

  return builder({
    name: name as string,
    zoom: zoom as number,
    axonometricAngle: axonometricAngle as number,
    viewportRef: viewportRef as string,
  });
}

export const CameraSerializer: ComponentSerializer = {
  serialize,
  deserialize,
};

/**
 * Allowlist of camera-specific properties accessible via component Proxy.
 */
export const PROPERTY_ALLOWLIST: string[] = [
  'zoom',
  'axonometricAngle',
  'viewportRef',
  'needsRedraw',
  'glResources',
];
