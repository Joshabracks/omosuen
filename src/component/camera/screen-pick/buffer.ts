/**
 * Screen-pick result buffer.
 *
 * `screenPick` is designed for per-frame use (hover / drag-select), so it must
 * not allocate on the hot path. Callers create one `PickBuffer` and reuse it
 * across calls; the buffer pools its `PickHit` records and only ever grows
 * (never shrinks/reallocates), so a steady-state query allocates nothing.
 */

import { Vector3D } from '../../../math';
import { ComponentData } from '../../types';
import { CellMapT } from '../../cell-map/data';

/** The kind of geometry a hit refers to. */
export const PickKind = {
  Sprite: 'sprite',
  Collider: 'collider',
  EventCollider: 'event-collider',
  Cell: 'cell',
} as const;

export type PickKindValue = (typeof PickKind)[keyof typeof PickKind];

/**
 * A single intersection result. Fields are reused between queries — copy out
 * anything you need to retain past the next `screenPick` call on the same buffer.
 */
export interface PickHit {
  /** What was hit. */
  kind: PickKindValue;
  /**
   * The hit component for `sprite` / `collider` / `event-collider` kinds.
   * `null` for `cell` hits (use `cellMap` + `cellX/Y/Z` instead).
   */
  component: ComponentData | null;
  /** The owning cell-map for `cell` hits, else `null`. */
  cellMap: CellMapT | null;
  /** Cell coordinates for `cell` hits, else `-1`. */
  cellX: number;
  cellY: number;
  cellZ: number;
  /** World-space hit point (reused Vector3D). */
  worldPoint: Vector3D;
  /**
   * Axonometric depth at the hit (`x + heightScale*y + z`). Larger = nearer the
   * camera. Hits are ordered near→far, so `[0]` is the front-most.
   */
  depth: number;
}

function makeHit(): PickHit {
  return {
    kind: PickKind.Cell,
    component: null,
    cellMap: null,
    cellX: -1,
    cellY: -1,
    cellZ: -1,
    worldPoint: new Vector3D(0, 0, 0),
    depth: 0,
  };
}

/**
 * Reusable container for `screenPick` results. `hits[0 .. count-1]` are valid
 * after a query, ordered near→far (front-most first).
 */
export class PickBuffer {
  /** Pooled hit records; only `[0, count)` are valid for the latest query. */
  readonly hits: PickHit[] = [];
  /** Number of valid hits from the latest query. */
  count = 0;

  /** Resets the buffer for a new query (does not free pooled records). */
  reset(): void {
    this.count = 0;
  }

  /**
   * Returns the next writable hit slot, growing the pool only when needed, and
   * advances `count`. Internal to the pick implementation.
   */
  push(): PickHit {
    if (this.count >= this.hits.length) {
      this.hits.push(makeHit());
    }
    return this.hits[this.count++];
  }
}

/** Allocates a reusable {@link PickBuffer}. */
export function createPickBuffer(): PickBuffer {
  return new PickBuffer();
}
