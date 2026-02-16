import {
  ComponentData,
  ComponentOptions,
  ComponentSerializer,
  ComponentUnique,
  ComponentInstanceMethods,
} from '../types';
import { Vector4D } from '../../math';
import type { ViewportMethods } from './methods';

/**
 * Viewport component for WebGL2 rendering.
 * Provides a canvas element with WebGL2 context for graphics rendering.
 */
export interface ViewportT
  extends ComponentData, ComponentInstanceMethods<ViewportMethods> {
  type: 'viewport';
  unique: ComponentUnique.FALSE;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  backgroundColor: Vector4D;
  canvas: HTMLCanvasElement | null;
  gl: WebGL2RenderingContext | null;
  container: HTMLElement;
}

export interface ViewportOptions extends ComponentOptions {
  width?: number;
  height?: number;
  offsetX?: number;
  offsetY?: number;
  backgroundColor?: Vector4D;
}

/**
 * Builder function for viewport component.
 * Creates a new viewport with canvas element and WebGL2 context.
 *
 * @param options - Component creation options
 * @returns A new viewport component instance
 *
 * @example
 * ```typescript
 * const viewport = await newComponent("viewport", {
 *   name: "Main Viewport",
 *   width: 800,
 *   height: 600,
 *   backgroundColor: new Vector4D(0.1, 0.1, 0.1, 1.0)
 * });
 * ```
 */
export function builder(options: ViewportOptions): ViewportT {
  // Create the canvas element
  const canvas = document.createElement('canvas');
  const width = options.width ?? 800;
  const height = options.height ?? 600;

  canvas.width = width;
  canvas.height = height;
  canvas.style.display = 'block';

  // Create container element for positioning
  const container = document.createElement('div');
  container.style.position = 'absolute';
  container.style.left = `${options.offsetX ?? 0}px`;
  container.style.top = `${options.offsetY ?? 0}px`;
  container.id = options.name.replace(/\s/g, '');

  container.appendChild(canvas);

  // Try to get WebGL2 context with explicit depth buffer request
  let gl: WebGL2RenderingContext | null = null;
  try {
    gl = canvas.getContext('webgl2', {
      depth: true,              // Explicitly request depth buffer for z-depth sorting
      stencil: false,           // Stencil buffer not needed
      alpha: true,              // Allow transparency
      antialias: false,         // Pixel-perfect rendering (no antialiasing)
      premultipliedAlpha: true, // Standard alpha blending
    });
    if (!gl) {
      console.error(
        `[viewport] Failed to get WebGL2 context for '${options.name}'. ` +
          `WebGL2 may not be supported in this browser.`,
      );
    }
  } catch (error) {
    console.error(
      `[viewport] Error getting WebGL2 context for '${options.name}':`,
      error,
    );
  }

  // Create data-only object. Methods will be added by Proxy wrapper in newComponent()
  const viewport = {
    type: 'viewport' as const,
    name: options.name,
    unique: ComponentUnique.FALSE,
    parent: null,
    _disposed: false,
    width,
    height,
    offsetX: options.offsetX ?? 0,
    offsetY: options.offsetY ?? 0,
    backgroundColor: options.backgroundColor ?? new Vector4D(0, 0, 0, 1),
    canvas,
    gl,
    container,
  };

  return viewport as unknown as ViewportT;
}

/**
 * Serializes a viewport component to a plain object.
 * Canvas and WebGL context are not serialized - they will be recreated on deserialize.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serialize(component: ComponentData): any {
  const v = component as ViewportT;

  return {
    type: 'viewport',
    name: v.name,
    unique: ComponentUnique.FALSE,
    width: v.width,
    height: v.height,
    offsetX: v.offsetX,
    offsetY: v.offsetY,
    backgroundColor: {
      _vectorType: 'Vector4D',
      x: v.backgroundColor.x,
      y: v.backgroundColor.y,
      z: v.backgroundColor.z,
      w: v.backgroundColor.w,
    },
  };
}

/**
 * Deserializes a plain object back into a viewport component.
 * Recreates the canvas and WebGL2 context.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deserialize(data: any): ViewportT {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const { type, name, width, height, offsetX, offsetY, backgroundColor } = data;

  const errors = [];
  if (type !== 'viewport') {
    errors.push(`type ${type} does not match "viewport"`);
  }
  if (!name) {
    errors.push('viewport requires a name');
  }
  if (errors.length) {
    throw new Error(errors.join('\n'));
  }

  // Reconstruct backgroundColor Vector4D
  let bgColor = new Vector4D(0, 0, 0, 1);
  if (backgroundColor && typeof backgroundColor === 'object') {
    if (
      '_vectorType' in backgroundColor &&
      backgroundColor._vectorType === 'Vector4D'
    ) {
      bgColor = new Vector4D(
        backgroundColor.x,
        backgroundColor.y,
        backgroundColor.z,
        backgroundColor.w,
      );
    }
  }

  return builder({
    name: name as string,
    width: width as number,
    height: height as number,
    offsetX: offsetX as number,
    offsetY: offsetY as number,
    backgroundColor: bgColor,
  });
}

export const ViewportSerializer: ComponentSerializer = {
  serialize,
  deserialize,
};

/**
 * Allowlist of viewport-specific properties accessible via component Proxy.
 * These properties can be accessed directly without triggering method lookup.
 */
export const PROPERTY_ALLOWLIST: string[] = [
  'width',
  'height',
  'offsetX',
  'offsetY',
  'backgroundColor',
  'canvas',
  'gl',
  'container',
];
