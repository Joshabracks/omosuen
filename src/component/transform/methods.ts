import { ComponentData, ComponentMethods, castTo } from '../types';
import { TransformT } from './data';
import { Vector3D } from '../../math';
import { NexusT } from '../nexus';

export interface TransformMethods extends ComponentMethods {
  init: (component: ComponentData) => Promise<void>;
  setPosition: (transform: TransformT, x: number, y: number, z: number) => void;
  translate: (
    transform: TransformT,
    dx: number,
    dy: number,
    dz: number,
  ) => void;
  getPosition: (transform: TransformT) => Vector3D;
  setRotation: (transform: TransformT, x: number, y: number, z: number) => void;
  rotate: (transform: TransformT, dx: number, dy: number, dz: number) => void;
  getRotation: (transform: TransformT) => Vector3D;
  setScale: (transform: TransformT, x: number, y: number, z: number) => void;
  scaleBy: (transform: TransformT, sx: number, sy: number, sz: number) => void;
  getScale: (transform: TransformT) => Vector3D;
}

/**
 * Walks up from a nexus, checking each ancestor nexus for a transform.
 * Returns the nearest ancestor transform, or null if none found.
 */
function findAncestorTransform(nexus: NexusT): TransformT | null {
  if (!nexus.parent || nexus.parent.type !== 'nexus') return null;
  const parentNexus = castTo<NexusT>(nexus.parent);

  // @ts-expect-error - Proxy methods exist at runtime but TypeScript can't infer them
  const parentTransform = parentNexus.getComponentByType(
    'transform',
    false,
  ) as TransformT | null;
  if (parentTransform) return parentTransform;

  // No transform in this nexus — keep walking up
  return findAncestorTransform(parentNexus);
}

/**
 * Gets the nearest ancestor transform by walking up the parent hierarchy.
 * transform.parent = my nexus → myNexus.parent = parent nexus → search for transform
 */
function getParentTransform(transform: TransformT): TransformT | null {
  if (!transform.parent || transform.parent.type !== 'nexus') return null;
  const myNexus = castTo<NexusT>(transform.parent);
  return findAncestorTransform(myNexus);
}

export const Transform: TransformMethods = {
  type: 'transform',

  async init(_component: ComponentData): Promise<void> {
    // No-op
  },

  /**
   * Sets the local position.
   */
  setPosition(transform: TransformT, x: number, y: number, z: number) {
    transform.position.x = x;
    transform.position.y = y;
    transform.position.z = z;
  },

  /**
   * Translates (moves) by a local offset.
   */
  translate(transform: TransformT, dx: number, dy: number, dz: number) {
    transform.position.x += dx;
    transform.position.y += dy;
    transform.position.z += dz;
  },

  /**
   * Gets the world-space position (composed with parent hierarchy).
   * Returns a new Vector3D to prevent mutation of internal state.
   */
  getPosition(transform: TransformT): Vector3D {
    const parent = getParentTransform(transform);
    if (!parent)
      return new Vector3D(
        transform.position.x,
        transform.position.y,
        transform.position.z,
      );

    const parentPos = Transform.getPosition(parent);
    const parentScale = Transform.getScale(parent);

    // Scale local position by parent's world scale, then add parent's world position
    return new Vector3D(
      parentPos.x + transform.position.x * parentScale.x,
      parentPos.y + transform.position.y * parentScale.y,
      parentPos.z + transform.position.z * parentScale.z,
    );
  },

  /**
   * Sets the local rotation (Euler angles in radians).
   */
  setRotation(transform: TransformT, x: number, y: number, z: number) {
    transform.rotation.x = x;
    transform.rotation.y = y;
    transform.rotation.z = z;
  },

  /**
   * Rotates by adding to the local rotation.
   */
  rotate(transform: TransformT, dx: number, dy: number, dz: number) {
    transform.rotation.x += dx;
    transform.rotation.y += dy;
    transform.rotation.z += dz;
  },

  /**
   * Gets the world-space rotation (composed with parent hierarchy).
   * Returns a new Vector3D to prevent mutation of internal state.
   */
  getRotation(transform: TransformT): Vector3D {
    const parent = getParentTransform(transform);
    if (!parent)
      return new Vector3D(
        transform.rotation.x,
        transform.rotation.y,
        transform.rotation.z,
      );

    const parentRot = Transform.getRotation(parent);
    return new Vector3D(
      parentRot.x + transform.rotation.x,
      parentRot.y + transform.rotation.y,
      parentRot.z + transform.rotation.z,
    );
  },

  /**
   * Sets the local scale.
   */
  setScale(transform: TransformT, x: number, y: number, z: number) {
    transform.scale.x = x;
    transform.scale.y = y;
    transform.scale.z = z;
  },

  /**
   * Multiplies the local scale by the given factors.
   */
  scaleBy(transform: TransformT, sx: number, sy: number, sz: number) {
    transform.scale.x *= sx;
    transform.scale.y *= sy;
    transform.scale.z *= sz;
  },

  /**
   * Gets the world-space scale (composed with parent hierarchy).
   * Returns a new Vector3D to prevent mutation of internal state.
   */
  getScale(transform: TransformT): Vector3D {
    const parent = getParentTransform(transform);
    if (!parent)
      return new Vector3D(
        transform.scale.x,
        transform.scale.y,
        transform.scale.z,
      );

    const parentScale = Transform.getScale(parent);
    return new Vector3D(
      parentScale.x * transform.scale.x,
      parentScale.y * transform.scale.y,
      parentScale.z * transform.scale.z,
    );
  },

  dispose(c: ComponentData) {
    const t = c as TransformT;
    t._disposed = true;
  },
};
