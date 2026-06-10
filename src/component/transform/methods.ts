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
  /**
   * Writes the world-space position/rotation/scale into the provided vectors
   * without allocating. Pass null for any channel you don't need. Walks the
   * parent chain once. Use this on hot paths (e.g. collision) instead of the
   * allocating getPosition/getRotation/getScale getters.
   */
  getWorldInto: (
    transform: TransformT,
    outPosition: Vector3D | null,
    outRotation: Vector3D | null,
    outScale: Vector3D | null,
  ) => void;
}

/**
 * Walks up from a nexus, checking each ancestor nexus for a transform.
 * Returns the nearest ancestor transform, or null if none found.
 */
function findAncestorTransform(nexus: NexusT): TransformT | null {
  if (!nexus.parent || nexus.parent.type !== 'nexus') return null;
  const parentNexus = castTo<NexusT>(nexus.parent);

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

/**
 * Reused scratch buffer for the leaf→root ancestor chain, to avoid per-call
 * array allocation. Safe to share because composeWorld is a flat, synchronous
 * loop (no nesting/reentrancy).
 */
const ancestorChain: TransformT[] = [];

/**
 * Composes the world-space transform by folding local transforms from root down
 * to the leaf with scalar accumulators — zero Vector3D allocation. Writes each
 * requested channel into the provided out-vector (pass null to skip).
 *
 * Matches the previous recursive getters exactly:
 *   worldPos   = parentWorldPos + localPos * parentWorldScale
 *   worldScale = parentWorldScale * localScale
 *   worldRot   = parentWorldRot + localRot
 */
function composeWorld(
  transform: TransformT,
  outPosition: Vector3D | null,
  outRotation: Vector3D | null,
  outScale: Vector3D | null,
): void {
  // Collect the chain leaf → root without allocating (reuse ancestorChain).
  ancestorChain.length = 0;
  let cur: TransformT | null = transform;
  while (cur) {
    ancestorChain.push(cur);
    cur = getParentTransform(cur);
  }

  let px = 0;
  let py = 0;
  let pz = 0;
  let sx = 1;
  let sy = 1;
  let sz = 1;
  let rx = 0;
  let ry = 0;
  let rz = 0;

  // Fold root → leaf. Position uses the parent's accumulated scale, so it must
  // be applied before scale is multiplied in for this level.
  for (let i = ancestorChain.length - 1; i >= 0; i--) {
    const t = ancestorChain[i];
    const p = t.position;
    const s = t.scale;
    const r = t.rotation;

    px += p.x * sx;
    py += p.y * sy;
    pz += p.z * sz;

    sx *= s.x;
    sy *= s.y;
    sz *= s.z;

    rx += r.x;
    ry += r.y;
    rz += r.z;
  }

  if (outPosition) {
    outPosition.x = px;
    outPosition.y = py;
    outPosition.z = pz;
  }
  if (outRotation) {
    outRotation.x = rx;
    outRotation.y = ry;
    outRotation.z = rz;
  }
  if (outScale) {
    outScale.x = sx;
    outScale.y = sy;
    outScale.z = sz;
  }
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
    const out = new Vector3D(0, 0, 0);
    composeWorld(transform, out, null, null);
    return out;
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
    const out = new Vector3D(0, 0, 0);
    composeWorld(transform, null, out, null);
    return out;
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
    const out = new Vector3D(0, 0, 0);
    composeWorld(transform, null, null, out);
    return out;
  },

  getWorldInto(
    transform: TransformT,
    outPosition: Vector3D | null,
    outRotation: Vector3D | null,
    outScale: Vector3D | null,
  ): void {
    composeWorld(transform, outPosition, outRotation, outScale);
  },

  dispose(c: ComponentData) {
    const t = c as TransformT;
    t._disposed = true;
  },
};
