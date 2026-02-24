import { ComponentData, ComponentMethods, castTo } from '../types';
import { EventColliderT } from './data';
import { ColliderT } from '../collider/data';
import { Collider } from '../collider/methods';
import { NexusT } from '../nexus';
import type { CellMapT } from '../cell-map';
import type {
  CellMapCollisionResult,
  CollisionPipelineResult,
  ProcessCollisionsOptions,
} from '../collider/methods';
import { Vector3D } from '../../math';

// ============================================================
// Internal helpers
// ============================================================

function getSceneRoot(component: EventColliderT): NexusT | null {
  if (!component.parent || component.parent.type !== 'nexus') return null;
  let current = castTo<NexusT>(component.parent);
  while (current.parent && current.parent.type === 'nexus') {
    current = castTo<NexusT>(current.parent);
  }
  return current;
}

// ============================================================
// Methods interface
// ============================================================

export interface EventColliderMethods extends ComponentMethods {
  // Lifecycle
  init: (component: ComponentData) => Promise<void>;
  update: (component: ComponentData, deltaTime: number) => void;
  dispose: (component: ComponentData) => void;

  // Inherited collider geometry methods
  getWorldCenter: (ec: EventColliderT) => Vector3D;
  getWorldBounds: (
    ec: EventColliderT,
  ) => { min: Vector3D; max: Vector3D };
  intersectsCollider: (ec: EventColliderT, other: ColliderT) => boolean;
  getOccupiedCells: (ec: EventColliderT, cellMap: CellMapT) => Vector3D[];
  getOccupiedSolidCells: (
    ec: EventColliderT,
    cellMap: CellMapT,
  ) => Vector3D[];
  intersectsCellMap: (
    ec: EventColliderT,
    cellMap: CellMapT,
    options?: ProcessCollisionsOptions,
  ) => CellMapCollisionResult;
  processCollisions: (
    ec: EventColliderT,
    cellMap: CellMapT,
    options?: ProcessCollisionsOptions,
  ) => CollisionPipelineResult;
  setShape: (ec: EventColliderT, shape: 'box' | 'sphere') => void;
  setSize: (ec: EventColliderT, x: number, y: number, z: number) => void;
  setRadius: (ec: EventColliderT, radius: number) => void;
  setOffset: (
    ec: EventColliderT,
    x: number,
    y: number,
    z: number,
  ) => void;

  // EventCollider-specific methods
  addTrigger: (ec: EventColliderT, collider: ColliderT) => void;
  removeTrigger: (ec: EventColliderT, colliderId: number) => void;
  clearTriggers: (ec: EventColliderT) => void;
  setOnEnter: (
    ec: EventColliderT,
    callback: ((collider: ColliderT) => void) | null,
  ) => void;
  setOnExit: (
    ec: EventColliderT,
    callback: ((collider: ColliderT) => void) | null,
  ) => void;
  setWhile: (
    ec: EventColliderT,
    callback: ((collider: ColliderT, deltaTime: number) => void) | null,
  ) => void;
}

// ============================================================
// EventCollider methods object
// ============================================================

export const EventCollider: EventColliderMethods = {
  // Spread all Collider methods as the base (geometry, intersection, etc.)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ...(Collider as unknown as Record<string, any>),

  type: 'event-collider',

  async init(_component: ComponentData): Promise<void> {
    // No-op — callbacks are set by user code after creation
  },

  update(component: ComponentData, deltaTime: number): void {
    const ec = component as EventColliderT;
    const triggerIds = Object.keys(ec.triggers);
    if (triggerIds.length === 0) return;

    const sceneRoot = getSceneRoot(ec);
    if (!sceneRoot) return;

    for (const idStr of triggerIds) {
      const id = Number(idStr);
      const trackedComponent = sceneRoot.getComponentById(id, true);

      if (!trackedComponent || trackedComponent._disposed) {
        delete ec.triggers[id];
        continue;
      }

      const other = trackedComponent as unknown as ColliderT;
      const wasInside = ec.triggers[id];

      // Delegate intersection test to the Collider implementation
      const isInside = Collider.intersectsCollider(
        ec as unknown as ColliderT,
        other,
      );

      if (!wasInside && isInside) {
        ec.triggers[id] = true;
        if (ec.onEnter) ec.onEnter(other);
      } else if (wasInside && !isInside) {
        ec.triggers[id] = false;
        if (ec.onExit) ec.onExit(other);
      } else if (wasInside && isInside) {
        if (ec.while) ec.while(other, deltaTime);
      }
    }
  },

  dispose(component: ComponentData): void {
    const ec = component as EventColliderT;
    ec._disposed = true;
    ec.triggers = {};
    ec.onEnter = null;
    ec.onExit = null;
    ec.while = null;
  },

  // EventCollider-specific convenience methods

  addTrigger(ec: EventColliderT, collider: ColliderT): void {
    if (collider.id !== undefined) {
      ec.triggers[collider.id] = false;
    }
  },

  removeTrigger(ec: EventColliderT, colliderId: number): void {
    delete ec.triggers[colliderId];
  },

  clearTriggers(ec: EventColliderT): void {
    ec.triggers = {};
  },

  setOnEnter(
    ec: EventColliderT,
    callback: ((collider: ColliderT) => void) | null,
  ): void {
    ec.onEnter = callback;
  },

  setOnExit(
    ec: EventColliderT,
    callback: ((collider: ColliderT) => void) | null,
  ): void {
    ec.onExit = callback;
  },

  setWhile(
    ec: EventColliderT,
    callback: ((collider: ColliderT, deltaTime: number) => void) | null,
  ): void {
    ec.while = callback;
  },
} as EventColliderMethods;
