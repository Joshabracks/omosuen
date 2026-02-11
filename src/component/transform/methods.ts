import { ComponentData, ComponentMethods } from '../types';
import { TransformT } from './data';
import { Vector2D } from '../../math';

export interface TransformMethods extends ComponentMethods {
  init: (component: ComponentData) => Promise<void>;
  setPosition: (transform: TransformT, x: number, y: number) => void;
  translate: (transform: TransformT, dx: number, dy: number) => void;
  getPosition: (transform: TransformT) => Vector2D;
  setRotation: (transform: TransformT, radians: number) => void;
  rotate: (transform: TransformT, radians: number) => void;
  getRotation: (transform: TransformT) => number;
  setScale: (transform: TransformT, x: number, y: number) => void;
  scaleBy: (transform: TransformT, sx: number, sy: number) => void;
  getScale: (transform: TransformT) => Vector2D;
}

export const Transform: TransformMethods = {
  type: 'transform',

  /**
   * Initializes the transform component.
   * No initialization needed for transform data.
   */
  async init(_component: ComponentData): Promise<void> {
    // No-op
  },

  /**
   * Sets the absolute position.
   *
   * @param transform - The transform component
   * @param x - X coordinate
   * @param y - Y coordinate
   */
  setPosition(transform: TransformT, x: number, y: number) {
    transform.position.x = x;
    transform.position.y = y;
  },

  /**
   * Translates (moves) the transform by an offset.
   *
   * @param transform - The transform component
   * @param dx - X offset
   * @param dy - Y offset
   */
  translate(transform: TransformT, dx: number, dy: number) {
    transform.position.x += dx;
    transform.position.y += dy;
  },

  /**
   * Gets the current position.
   *
   * @param transform - The transform component
   * @returns The current position vector
   */
  getPosition(transform: TransformT): Vector2D {
    return transform.position;
  },

  /**
   * Sets the absolute rotation angle.
   *
   * @param transform - The transform component
   * @param radians - Rotation angle in radians
   */
  setRotation(transform: TransformT, radians: number) {
    transform.rotation = radians;
  },

  /**
   * Rotates the transform by an angle.
   *
   * @param transform - The transform component
   * @param radians - Rotation angle in radians to add
   */
  rotate(transform: TransformT, radians: number) {
    transform.rotation += radians;
  },

  /**
   * Gets the current rotation angle.
   *
   * @param transform - The transform component
   * @returns The current rotation in radians
   */
  getRotation(transform: TransformT): number {
    return transform.rotation;
  },

  /**
   * Sets the absolute scale.
   *
   * @param transform - The transform component
   * @param x - X scale factor
   * @param y - Y scale factor
   */
  setScale(transform: TransformT, x: number, y: number) {
    transform.scale.x = x;
    transform.scale.y = y;
  },

  /**
   * Multiplies the current scale by the given factors.
   *
   * @param transform - The transform component
   * @param sx - X scale multiplier
   * @param sy - Y scale multiplier
   */
  scaleBy(transform: TransformT, sx: number, sy: number) {
    transform.scale.x *= sx;
    transform.scale.y *= sy;
  },

  /**
   * Gets the current scale.
   *
   * @param transform - The transform component
   * @returns The current scale vector
   */
  getScale(transform: TransformT): Vector2D {
    return transform.scale;
  },

  /**
   * Disposes the transform component and cleans up resources.
   */
  dispose(c: ComponentData) {
    const t = c as TransformT;
    t._disposed = true;
  },
};
