import { ComponentData, ComponentMethods } from '../types';
import { ViewportT } from './data';

export interface ViewportMethods extends ComponentMethods {
  init: (component: ComponentData) => void;
  update: (component: ComponentData, deltaTime: number) => void;
  resize: (v: ViewportT, width: number, height: number) => void;
  clear: (v: ViewportT) => void;
  setBackgroundColor: (
    v: ViewportT,
    r: number,
    g: number,
    b: number,
    a: number,
  ) => void;
  setOffset: (v: ViewportT, x: number, y: number) => void;
}

export const Viewport: ViewportMethods = {
  type: 'viewport',

  /**
   * Initializes the viewport component.
   * Appends canvas to DOM and sets up initial WebGL state.
   */
  init(component: ComponentData) {
    const v = component as ViewportT;

    // Append container to DOM during init (after scene is loaded)
    if (v.container && !v.container.parentNode) {
      document.body.appendChild(v.container);
    }

    // Initialize WebGL state if context is available
    if (v.gl) {
      // Set the viewport to match canvas dimensions
      v.gl.viewport(0, 0, v.width, v.height);

      // Set clear color from backgroundColor
      v.gl.clearColor(
        v.backgroundColor.r,
        v.backgroundColor.g,
        v.backgroundColor.b,
        v.backgroundColor.a,
      );

      // Enable depth testing (common for 3D rendering)
      v.gl.enable(v.gl.DEPTH_TEST);

      // Clear the canvas initially
      v.gl.clear(v.gl.COLOR_BUFFER_BIT | v.gl.DEPTH_BUFFER_BIT);
    }
  },

  /**
   * Updates the viewport each frame.
   * Currently a no-op, but can be extended for auto-resize or other per-frame logic.
   */
  update(_component: ComponentData, _deltaTime: number) {
    // Reserved for future use (e.g., auto-resize detection, performance monitoring)
  },

  /**
   * Resizes the viewport and updates WebGL viewport accordingly.
   */
  resize(v: ViewportT, width: number, height: number) {
    if (!v.canvas || !v.gl) {
      console.warn(
        `[viewport] Cannot resize '${v.name}' - canvas or gl context missing`,
      );
      return;
    }

    // Update internal dimensions
    v.width = width;
    v.height = height;

    // Update canvas size
    v.canvas.width = width;
    v.canvas.height = height;

    // Update WebGL viewport
    v.gl.viewport(0, 0, width, height);
  },

  /**
   * Clears the viewport with the current background color.
   */
  clear(v: ViewportT) {
    if (!v.gl) {
      console.warn(`[viewport] Cannot clear '${v.name}' - gl context missing`);
      return;
    }

    v.gl.clear(v.gl.COLOR_BUFFER_BIT | v.gl.DEPTH_BUFFER_BIT);
  },

  /**
   * Sets the background color and updates WebGL clear color.
   */
  setBackgroundColor(v: ViewportT, r: number, g: number, b: number, a: number) {
    v.backgroundColor.x = r;
    v.backgroundColor.y = g;
    v.backgroundColor.z = b;
    v.backgroundColor.w = a;

    if (v.gl) {
      v.gl.clearColor(r, g, b, a);
    }
  },

  /**
   * Sets the viewport position offset.
   */
  setOffset(v: ViewportT, x: number, y: number) {
    v.offsetX = x;
    v.offsetY = y;

    if (v.container) {
      v.container.style.left = `${x}px`;
      v.container.style.top = `${y}px`;
    }
  },

  /**
   * Disposes the viewport component and cleans up resources.
   */
  dispose(c: ComponentData) {
    const v = c as ViewportT;

    // Lose WebGL context to free GPU resources
    if (v.canvas && v.gl) {
      const loseContext = v.gl.getExtension('WEBGL_lose_context');
      if (loseContext) {
        loseContext.loseContext();
      }
    }

    // Remove canvas from DOM
    if (v.container && v.container.parentNode) {
      v.container.parentNode.removeChild(v.container);
    }

    // Clear references
    v.canvas = null;
    v.gl = null;
    v._disposed = true;
  },
};
