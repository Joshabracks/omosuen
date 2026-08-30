/**
 * Fog-of-war deferred presentation.
 *
 * A change to a cell the player cannot currently see must not become visible
 * until they see that cell again. Rather than letting the change through and
 * painting over it (which is what the old flat-colour terrain-memory snapshot
 * did, and why remembered terrain rendered textureless), the change is written
 * to the store as normal and the cell's PREVIOUS value is recorded in the WASM
 * remembered-cell overlay. The mesher consults that overlay, so the geometry
 * reaching the GPU still shows the terrain the player last saw.
 *
 * ## What stays authoritative
 *
 * Everything except the mesh. `getCellData`, the solidity map, line-of-sight,
 * pathfinding and collision all read the store, which is always current. In
 * particular solidity MUST stay authoritative: line-of-sight computed against
 * remembered terrain would let a wall mined out of sight permanently block
 * vision through the opening that now exists, and nothing would ever reveal
 * it. Keeping it authoritative makes the system self-healing -- the opening
 * becomes visible, which triggers the reveal, which updates the geometry.
 *
 * ## Ownership
 *
 * This module owns the JS-side registry of which WORLD cells are currently
 * deferred; WASM owns the values. World coordinates rather than window-local
 * ones because a window shift changes a resident cell's window-local
 * coordinate while leaving its toroidal slot intact -- storing local
 * coordinates would silently re-point entries at other cells after a shift.
 *
 * The observation predicate is INSTALLED by fog-of-war rather than imported,
 * so cell-map keeps no dependency on it. With no predicate installed (fog
 * disabled) every write counts as observed and behaviour is exactly as it was
 * before this module existed.
 */

import type { CellMapT } from './data';
import type { Vector3D } from '../../math';
import {
  cellStoreGet,
  forgetAllRememberedCells,
  forgetRememberedCell,
  rememberCell,
  rememberedCellCount,
} from '../camera/render/wasm';
import { markChunksDirty } from './mesh-builder';

/**
 * Answers "can the player see this world cell right now?". Installed by
 * fog-of-war (see `setCellObservationPredicate`); `null` means fog is not
 * running, in which case nothing is ever deferred.
 */
export type CellObservationPredicate = (
  worldX: number,
  worldY: number,
  worldZ: number,
) => boolean;

let observationPredicate: CellObservationPredicate | null = null;

/**
 * Cap on deferred cells. On overflow the whole overlay is dropped and those
 * changes become visible at once -- a visible pop, but bounded memory and a
 * bounded per-frame reveal scan. Mirrors `CELL_EXPLORED_DIRTY_CAP`'s
 * "clear the log rather than grow without limit" policy in methods.ts.
 */
const DEFERRED_CELL_CAP = 4096;

/** World cells whose rendered state is currently behind their real state. */
const deferredCells = new Map<string, { x: number; y: number; z: number }>();

function cellKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

/**
 * Installs (or removes, with `null`) the "can the player see this cell"
 * predicate. Fog-of-war calls this as it initialises and clears it on dispose.
 */
export function setCellObservationPredicate(
  predicate: CellObservationPredicate | null,
): void {
  observationPredicate = predicate;
  if (!predicate) clearDeferredCells();
}

/** Whether deferral is active at all -- i.e. whether fog is running. */
export function isDeferredPresentationActive(): boolean {
  return observationPredicate !== null;
}

/** Number of cells currently rendering as something other than their real value. */
export function deferredCellCount(): number {
  return deferredCells.size;
}

/**
 * Drops every deferred cell, so each affected chunk shows current terrain
 * again. Called on a window shift (a cell evicted from the window keeps its
 * toroidal slot, which another world cell will later occupy -- a stale entry
 * would then paint remembered terrain onto an unrelated cell) and when the cap
 * is hit.
 *
 * `component` is optional only because teardown has no cell-map to hand. Pass
 * it whenever there is one: dropping an entry does not by itself re-mesh
 * anything, so without the dirty marks those chunks would keep rendering
 * remembered geometry with no overlay entry left to ever reveal them.
 */
export function clearDeferredCells(component?: CellMapT): void {
  if (deferredCells.size === 0) return;
  if (component) {
    for (const cell of deferredCells.values()) {
      markChunksDirty(component, cell.x, cell.y, cell.z);
    }
  }
  deferredCells.clear();
  forgetAllRememberedCells();
}

/**
 * Decides whether a pending write to `coordinates` should be hidden, recording
 * the cell's current (pre-change) value if so. MUST be called BEFORE the write
 * lands, since that is the only moment the previous value is still readable.
 *
 * Returns true when the caller should skip marking the chunk dirty -- the
 * write still goes through to the store either way, so authority is never
 * affected by the answer.
 */
export function deferCellWriteIfUnobserved(
  component: CellMapT,
  coordinates: Vector3D,
): boolean {
  if (!observationPredicate) return false;

  const local = component.window.worldToLocal(
    coordinates.x,
    coordinates.y,
    coordinates.z,
  );
  // Off-window cells are not rendered, so there is nothing to defer -- and the
  // overlay is keyed by window slot, which an off-window cell does not have.
  if (!local) return false;

  const key = cellKey(coordinates.x, coordinates.y, coordinates.z);

  if (observationPredicate(coordinates.x, coordinates.y, coordinates.z)) {
    // Observed: the player is watching, so show the change immediately and
    // drop any memory of an earlier hidden state at this cell.
    if (deferredCells.delete(key)) {
      forgetRememberedCell(local.x, local.y, local.z);
    }
    return false;
  }

  if (!deferredCells.has(key)) {
    if (deferredCells.size >= DEFERRED_CELL_CAP) {
      clearDeferredCells(component);
      return false;
    }
    deferredCells.set(key, {
      x: coordinates.x,
      y: coordinates.y,
      z: coordinates.z,
    });
  }

  // `rememberCell` is idempotent WASM-side, so a second hidden edit to the
  // same cell keeps the value from the last time it was actually observed
  // rather than whatever it has passed through since.
  rememberCell(
    local.x,
    local.y,
    local.z,
    cellStoreGet(local.x, local.y, local.z),
  );
  return true;
}

/**
 * Reveals every deferred cell the player can now see: drops its overlay entry
 * and dirties its chunk so the normal remesh/upload path shows current terrain.
 *
 * Called once per frame by fog-of-war. Cheap because `deferredCells` only ever
 * holds cells that actually diverged.
 *
 * MUST NOT be called while holding the solidity view returned by
 * `computeSolidityMap()` across an await -- it writes to WASM, and that view is
 * a live window onto linear memory which a growth can detach.
 */
export function revealObservedCells(component: CellMapT): void {
  if (deferredCells.size === 0 || !observationPredicate) return;

  let revealed: { x: number; y: number; z: number }[] | null = null;

  for (const cell of deferredCells.values()) {
    if (!observationPredicate(cell.x, cell.y, cell.z)) continue;
    (revealed ??= []).push(cell);
  }
  if (!revealed) return;

  for (const cell of revealed) {
    deferredCells.delete(cellKey(cell.x, cell.y, cell.z));
    const local = component.window.worldToLocal(cell.x, cell.y, cell.z);
    // An evicted cell has no slot to clear; dropping the JS entry is enough,
    // and `clearDeferredCells` on the shift itself covers the WASM side.
    if (local) forgetRememberedCell(local.x, local.y, local.z);
    markChunksDirty(component, cell.x, cell.y, cell.z);
  }

  // The two sides can only disagree if something cleared one without the
  // other; resynchronise rather than leaving the mesher patching cells JS no
  // longer tracks (which would be invisible and permanent).
  if (deferredCells.size === 0 && rememberedCellCount() > 0) {
    forgetAllRememberedCells();
  }
}
