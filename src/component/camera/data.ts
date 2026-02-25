import {
  ComponentData,
  ComponentOptions,
  ComponentSerializer,
  ComponentInstanceMethods,
} from '../types';
import { ComponentUnique } from '../constants';
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
   * Zoom target in viewport-local coordinates.
   * When set, setZoom adjusts the camera position so the world point
   * under this screen coordinate stays fixed during zoom changes.
   * null = viewport center (no camera position adjustment on zoom).
   */
  zoomTarget: { x: number; y: number } | null;

  /**
   * Y-slice reveal target in world-space coordinates.
   * When set, cell geometry above target.y + revealYOffset is clipped
   * within the reveal region (radius or volume).
   * null = disabled, all geometry renders normally.
   */
  revealTarget: { x: number; y: number; z: number } | null;

  /** World-space offset above revealTarget.y where clipping begins. Default: 16.0 */
  revealYOffset: number;

  /** Height of dither fade zone below clip plane. 0 = hard cut. Default: 8.0 */
  revealFadeHeight: number;

  /** Cylindrical reveal radius in world units (used when no volume is set). Default: 256.0 */
  revealRadius: number;

  /**
   * Optional AABB volume override. When set, only cells inside this box are
   * clipped (instead of the cylindrical radius). null = use radius mode.
   */
  revealVolume: {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  } | null;

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

    // Cell solidity texture for per-fragment line-of-sight raycasting
    visibilityTexture: WebGLTexture | null;
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

  /** World-space offset above revealTarget.y where clipping begins (default: 16.0) */
  revealYOffset?: number;

  /** Height of dither fade zone below clip plane (default: 8.0) */
  revealFadeHeight?: number;

  /** Cylindrical reveal radius in world units (default: 256.0) */
  revealRadius?: number;
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
    zoomTarget: null,

    revealTarget: null,
    revealYOffset: options.revealYOffset ?? 16.0,
    revealFadeHeight: options.revealFadeHeight ?? 8.0,
    revealRadius: options.revealRadius ?? 256.0,
    revealVolume: null,

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
      visibilityTexture: null,
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
    revealYOffset: c.revealYOffset,
    revealFadeHeight: c.revealFadeHeight,
    revealRadius: c.revealRadius,
  };
}

/**
 * Deserializes a plain object back into a camera component.
 * WebGL resources will be recreated during init.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deserialize(data: any): CameraT {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const {
    type,
    name,
    zoom,
    pixelScale,
    axonometricAngle,
    viewportRef,
    revealYOffset,
    revealFadeHeight,
    revealRadius,
  } = data;

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
    revealYOffset: revealYOffset as number | undefined,
    revealFadeHeight: revealFadeHeight as number | undefined,
    revealRadius: revealRadius as number | undefined,
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
  'zoomTarget',
  'glResources',
  'revealTarget',
  'revealYOffset',
  'revealFadeHeight',
  'revealRadius',
  'revealVolume',
];
