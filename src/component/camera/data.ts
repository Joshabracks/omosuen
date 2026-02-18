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
   * Pixel scale for retro pixelation effect.
   * Controls how chunky the pixels appear (multiplies with zoom).
   * 1.0 = no extra pixelation, 2.0 = 2x2 pixel blocks, 4.0 = 4x4 pixel blocks
   * Higher values = chunkier, more retro look
   * Default: 2.0
   */
  pixelScale: number;

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
   * WebGL rendering resources (shader programs, buffers, etc.)
   */
  glResources: {
    unifiedProgram: WebGLProgram | null;
    renderModeLocation: WebGLUniformLocation | null;
    atlasTextures: (WebGLTexture | null)[];
    quadVertexBuffer: WebGLBuffer | null;
    quadUVBuffer: WebGLBuffer | null;
    // Post-processing framebuffer resources for pixel-perfect zoom
    framebuffer: WebGLFramebuffer | null;
    renderTexture: WebGLTexture | null;
    depthTexture: WebGLTexture | null;
    postProcessProgram: WebGLProgram | null;
    fullscreenQuadBuffer: WebGLBuffer | null;

    // Base rendering resolution (independent of canvas size, adjusted by zoom)
    baseResolution: { width: number; height: number };
  };
}

export interface CameraOptions extends ComponentOptions {
  /**
   * Initial zoom level (default: 1.0)
   */
  zoom?: number;

  /**
   * Pixel scale for retro pixelation effect (default: 2.0)
   * Controls how chunky pixels appear. Higher = more retro/chunky.
   */
  pixelScale?: number;

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
    _initDefer: 1,

    zoom: options.zoom ?? 1.0,
    pixelScale: options.pixelScale ?? 2.0,
    axonometricAngle: options.axonometricAngle ?? 30,
    viewportRef: options.viewportRef,

    glResources: {
      unifiedProgram: null,
      renderModeLocation: null,
      atlasTextures: [],
      quadVertexBuffer: null,
      quadUVBuffer: null,
      // Post-processing resources
      framebuffer: null,
      renderTexture: null,
      depthTexture: null,
      postProcessProgram: null,
      fullscreenQuadBuffer: null,
      baseResolution: { width: 800, height: 600 }, // Default, will be updated in init()
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
    pixelScale: c.pixelScale,
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
  const { type, name, zoom, pixelScale, axonometricAngle, viewportRef } = data;

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
    pixelScale: pixelScale as number,
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
  'pixelScale',
  'axonometricAngle',
  'viewportRef',
  'glResources',
];
