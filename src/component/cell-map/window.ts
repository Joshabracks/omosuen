/**
 * Owns the shiftable hot-window's origin and orchestrates shifting it.
 *
 * The WASM `CellStore` itself needs no changes to support this: from its
 * perspective there's no difference between "the whole map" and "the current
 * window" — it always just holds whatever was last loaded via `store_load`.
 * Only this module's bookkeeping (the window's origin, tracked here in
 * signed world-chunk coordinates) turns that into a *window* rather than a
 * fixed whole map. Rust's own addressing stays 0-based/unsigned throughout —
 * this module is the only place signed/negative chunk coordinates exist.
 *
 * A shift = evict chunks that fall outside the new window to cold storage
 * (dropping ones that still match baseline — nothing to store), assemble the
 * new window's contents (reusing the still-overlapping region, pulling
 * newly-exposed chunks from cold storage or the empty baseline), then reload
 * the store with the new contents. See
 * `.design/completed_tasks/cell-map-overhaul/02-wasm-windowed-store.md`.
 */
import {
  cellStoreGet,
  cellStoreSet,
  getExpandedStoreView,
  getReassembleViews,
  commitCellStore,
} from '../camera/render/wasm';
import type { ChunkColdStorage } from './cold-storage';

/**
 * Default per-frame time budget, in milliseconds, for generating a pending
 * shift's newly-exposed chunk data (see `CellWindow.advance`). Mirrors
 * `DEFAULT_CHUNK_GEN_BUDGET_MS` in `mesh-builder.ts` — same "spread expensive
 * work across frames, always make at least one chunk of progress" pattern,
 * applied to procedural generation instead of meshing.
 */
export const DEFAULT_CHUNK_DATA_GEN_BUDGET_MS = 4;

/**
 * Rejects a malformed coordinate (NaN, ±Infinity, non-numeric) — a bug
 * regardless of where the window happens to be, so this throws
 * unconditionally. See
 * `.design/completed_tasks/cell-map-overhaul/07-bounds-checking-diagnostics.md`.
 */
function assertFiniteCoordinates(x: number, y: number, z: number): void {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    throw new Error(
      `[cell-map] Invalid coordinates: (${x}, ${y}, ${z}) — must be finite numbers`,
    );
  }
}

export interface ChunkCoord {
  cx: number;
  cy: number;
  cz: number;
}

/**
 * Optional procedural baseline. When omitted (or for any cell/chunk it
 * doesn't cover), a chunk's baseline is `emptyCell` everywhere — today's
 * behavior. Must be a pure function of its coordinates for a given
 * world/seed — same input, same output, every time — so re-materializing a
 * never-edited chunk after it's evicted produces the same result it had
 * before. This is a contract on the caller, not something enforced here; see
 * `.design/completed_tasks/cell-map-overhaul/04-procedural-generation.md`.
 */
export interface ChunkGenerator {
  /**
   * Generates one cell's packed value at a world cell coordinate. Returning
   * undefined falls back to `emptyCell` for that cell. Used when
   * `generateChunk` isn't supplied (looped once per cell), and always used
   * for single-cell point queries regardless of whether `generateChunk` is
   * also supplied.
   */
  generateCell?: (
    worldX: number,
    worldY: number,
    worldZ: number,
  ) => number | undefined;
  /**
   * Optional bulk variant: generates a whole chunk's packed cells at once, as
   * a `chunkSize.x*y*z`-length array in x-fastest/y/z-slowest local order
   * (matching `extractChunk`/`writeChunk`). A performance escape hatch for
   * whole-chunk materialization (e.g. bulk noise sampling) — preferred over
   * looping `generateCell` when both are supplied.
   */
  generateChunk?: (cx: number, cy: number, cz: number) => Uint32Array;
}

export interface WindowConfig {
  /** Cells per chunk, per axis. */
  chunkSize: { x: number; y: number; z: number };
  /** Padding radius in chunks, per axis. Default {1,1,1} (a 3x3x3 chunk window). */
  radius?: { x: number; y: number; z: number };
  /** Packed cell value representing "nothing here" (see cell-map/types.ts's packCell). */
  emptyCell: number;
  /** Optional procedural baseline (see `ChunkGenerator`). Omit for a purely hand-authored map. */
  generator?: ChunkGenerator;
  /**
   * Whether `setCell` logs a diagnostic when a write resolves to the slower
   * cold-storage path (outside the current window) — visibility for the
   * common "coordinate-space mixup" bug, not an error (an off-window write is
   * fully legitimate). Default true; a game that does frequent, intentional
   * off-window scripted edits may want to disable it.
   */
  warnOnOutOfWindowWrite?: boolean;
}

export class CellWindow {
  private readonly chunkSize: { x: number; y: number; z: number };
  /** Padding radius in chunks, per axis. Mutable via `resize()`. */
  private windowRadius: { x: number; y: number; z: number };
  private readonly emptyCell: number;
  private readonly generator: ChunkGenerator | undefined;
  private readonly coldStorage: ChunkColdStorage;
  private readonly warnOnOutOfWindowWrite: boolean;
  /**
   * World-chunk-coordinate keys (`chunkKey`) of chunks that might currently
   * differ from their procedural baseline — i.e. have been written to since
   * the last time they were confirmed to match baseline. Absence of a key is
   * a guarantee (not a heuristic) that the chunk still matches baseline,
   * letting `reassemble`'s eviction pass skip `extractChunk`+`matchesBaseline`
   * (and matchesBaseline's own hidden `baselineChunk`/generator call, the
   * dominant cost measured in this investigation) entirely for it. Populated
   * by `setCell`'s in-window fast path (a write might move a chunk off
   * baseline) and by `reassemble`'s assembly loop when a chunk is sourced
   * from cold storage (cold storage only ever holds non-baseline data, by
   * the existing invariant below). Cleaned up when eviction re-confirms a
   * tracked chunk actually matches baseline again (e.g. an edit undone by
   * hand). Keyed by world coordinate, not window-local slot, so membership
   * survives a chunk being reused across window shifts with no extra
   * bookkeeping.
   */
  private readonly editedSinceBaseline = new Set<string>();
  /**
   * A shift/resize whose target window isn't fully assembled yet. The
   * window's committed state (`originChunk`/`gridDims`/`cellDims`) does NOT
   * change until every chunk the target needs — both genuinely-new ones
   * (`source: 'generate'`) AND ones reused from the current window
   * (`source: 'reuse'`) — is staged and `reassemble` actually runs, see
   * `advance`. Reused chunks are staged by reading the LIVE store directly
   * (via `extractLiveChunk`) at the moment their turn in the queue comes up,
   * not from a single upfront snapshot — that's what lets `reassemble`
   * itself skip `cellStoreDump()`'s whole-window cost for the (now common)
   * fully-staged case. `queue`/`queueIndex` form a cursor over `queue`
   * (nearest-to-target-center first) rather than shifting the array, to
   * avoid O(n) removals for large queues. Cold-storage-resolvable chunks are
   * NOT staged here — that lookup is already cheap (a `Map.get`), resolved
   * directly in `reassemble`'s assembly loop same as before.
   */
  private pendingShift: {
    origin: ChunkCoord;
    gridDims: { x: number; y: number; z: number };
    cellDims: { x: number; y: number; z: number };
    queue: { coord: ChunkCoord; source: 'reuse' | 'generate' }[];
    queueIndex: number;
    staged: Map<string, Uint32Array>;
    /**
     * World-chunk keys (→ coord) whose staged copy is now stale because
     * `setCell` wrote to that chunk (in-window: a 'reuse' chunk already
     * staged from the live store; off-window: a 'generate' chunk whose
     * cold-storage/baseline resolution may have changed) AFTER it was
     * staged. Re-resolved fresh in `advance`'s commit-time correction pass,
     * right before `reassemble` runs — see `setCell` and `advance`.
     */
    editedDuringStaging: Map<string, ChunkCoord>;
    targetRadius?: { x: number; y: number; z: number };
  } | null = null;
  /** Window size in chunks. Mutable via `resize()`, otherwise constant for the session. */
  private gridDims: { x: number; y: number; z: number };
  /** Window size in cells. Mutable via `resize()`, otherwise constant for the session. */
  private cellDims: { x: number; y: number; z: number };
  private originChunk: ChunkCoord | null = null;

  constructor(config: WindowConfig, coldStorage: ChunkColdStorage) {
    this.chunkSize = config.chunkSize;
    this.windowRadius = config.radius ?? { x: 1, y: 1, z: 1 };
    this.emptyCell = config.emptyCell;
    this.generator = config.generator;
    this.coldStorage = coldStorage;
    this.warnOnOutOfWindowWrite = config.warnOnOutOfWindowWrite ?? true;
    this.gridDims = {
      x: 2 * this.windowRadius.x + 1,
      y: 2 * this.windowRadius.y + 1,
      z: 2 * this.windowRadius.z + 1,
    };
    this.cellDims = {
      x: this.gridDims.x * this.chunkSize.x,
      y: this.gridDims.y * this.chunkSize.y,
      z: this.gridDims.z * this.chunkSize.z,
    };
  }

  /** World-chunk-coordinate origin of the window's local (0,0,0) corner, or null before the first `setFocus`. */
  get origin(): ChunkCoord | null {
    return this.originChunk;
  }

  /** Window size in cells (constant for the session). */
  get cellDimensions(): { x: number; y: number; z: number } {
    return this.cellDims;
  }

  /** Window size in chunks (constant for the session). */
  get gridDimensions(): { x: number; y: number; z: number } {
    return this.gridDims;
  }

  /** Current padding radius in chunks, per axis. See `resize()`. */
  get radius(): { x: number; y: number; z: number } {
    return this.windowRadius;
  }

  /**
   * Translates a world cell coordinate into window-local coordinates, or null
   * if it falls outside the currently-loaded window (including before the
   * first `setFocus`).
   */
  worldToLocal(
    wx: number,
    wy: number,
    wz: number,
  ): { x: number; y: number; z: number } | null {
    if (!this.originChunk) return null;
    const lx = wx - this.originChunk.cx * this.chunkSize.x;
    const ly = wy - this.originChunk.cy * this.chunkSize.y;
    const lz = wz - this.originChunk.cz * this.chunkSize.z;
    if (
      lx < 0 ||
      lx >= this.cellDims.x ||
      ly < 0 ||
      ly >= this.cellDims.y ||
      lz < 0 ||
      lz >= this.cellDims.z
    ) {
      return null;
    }
    return { x: lx, y: ly, z: lz };
  }

  /**
   * Answers "what's at this world cell coordinate" without forcing its
   * containing chunk to materialize into the window or cold storage, and
   * without triggering whole-chunk generation (`generateChunk`) even when one
   * is configured — the point-query path always uses `generateCell` only, per
   * `ChunkGenerator`'s contract. Uses the live WASM store directly when the
   * coordinate is already resident in the window (cheapest path); otherwise
   * checks cold storage, then falls back to generation/`emptyCell`.
   */
  queryCell(worldX: number, worldY: number, worldZ: number): number {
    assertFiniteCoordinates(worldX, worldY, worldZ);
    const local = this.worldToLocal(worldX, worldY, worldZ);
    if (local) {
      return cellStoreGet(local.x, local.y, local.z);
    }
    const { x: csx, y: csy, z: csz } = this.chunkSize;
    const worldChunk: ChunkCoord = {
      cx: Math.floor(worldX / csx),
      cy: Math.floor(worldY / csy),
      cz: Math.floor(worldZ / csz),
    };
    const stored = this.coldStorage.get(
      worldChunk.cx,
      worldChunk.cy,
      worldChunk.cz,
    );
    if (stored) {
      const localX = worldX - worldChunk.cx * csx;
      const localY = worldY - worldChunk.cy * csy;
      const localZ = worldZ - worldChunk.cz * csz;
      return stored[localZ * csy * csx + localY * csx + localX];
    }
    return (
      this.generator?.generateCell?.(worldX, worldY, worldZ) ?? this.emptyCell
    );
  }

  /**
   * Writes one cell's packed value at a world cell coordinate. Resolves to a
   * direct WASM store write when the coordinate is in the current window
   * (the fast path); otherwise decodes the containing chunk (from cold
   * storage or baseline), patches the cell, and writes the whole chunk back —
   * a fully supported operation (e.g. a scripted edit to an off-window
   * region), not an error. If the patched chunk ends up matching baseline
   * again (e.g. an edit reverted by hand), its cold-storage entry is dropped
   * rather than kept around needlessly.
   *
   * When `warnOnOutOfWindowWrite` is enabled (default), the off-window path
   * logs a diagnostic naming the coordinate and current window bounds, since
   * it's also the signature of a coordinate-space mixup bug — visibility, not
   * blocking. See `.design/completed_tasks/cell-map-overhaul/07-bounds-checking-diagnostics.md`.
   */
  setCell(worldX: number, worldY: number, worldZ: number, value: number): void {
    assertFiniteCoordinates(worldX, worldY, worldZ);
    const local = this.worldToLocal(worldX, worldY, worldZ);
    if (local) {
      cellStoreSet(local.x, local.y, local.z, value);
      const { x: csx, y: csy, z: csz } = this.chunkSize;
      const worldChunk: ChunkCoord = {
        cx: Math.floor(worldX / csx),
        cy: Math.floor(worldY / csy),
        cz: Math.floor(worldZ / csz),
      };
      const key = this.chunkKey(worldChunk.cx, worldChunk.cy, worldChunk.cz);
      this.editedSinceBaseline.add(key);
      // This chunk may already be staged (as a 'reuse' item) for an
      // in-flight pending shift -- if so, that staged copy no longer
      // reflects this write and needs re-resolving before commit. See
      // advance()'s correction pass.
      if (this.pendingShift?.staged.has(key)) {
        this.pendingShift.editedDuringStaging.set(key, worldChunk);
      }
      return;
    }

    if (this.warnOnOutOfWindowWrite) {
      const origin = this.originChunk;
      const bounds = origin
        ? `origin chunk (${origin.cx},${origin.cy},${origin.cz}), size ` +
          `${this.cellDims.x}x${this.cellDims.y}x${this.cellDims.z}`
        : 'no window loaded yet';
      console.warn(
        `[cell-map] setCell(${worldX}, ${worldY}, ${worldZ}) is outside the ` +
          `current window (${bounds}) — routed through cold storage (slower ` +
          `path). If this is unexpected, check your coordinate space (world ` +
          `vs. chunk vs. window-local) or focus point.`,
      );
    }

    const { x: csx, y: csy, z: csz } = this.chunkSize;
    const worldChunk: ChunkCoord = {
      cx: Math.floor(worldX / csx),
      cy: Math.floor(worldY / csy),
      cz: Math.floor(worldZ / csz),
    };
    const cells =
      this.coldStorage.get(worldChunk.cx, worldChunk.cy, worldChunk.cz) ??
      this.baselineChunk(worldChunk);
    const localX = worldX - worldChunk.cx * csx;
    const localY = worldY - worldChunk.cy * csy;
    const localZ = worldZ - worldChunk.cz * csz;
    cells[localZ * csy * csx + localY * csx + localX] = value;

    if (this.matchesBaseline(worldChunk, cells)) {
      this.coldStorage.delete(worldChunk.cx, worldChunk.cy, worldChunk.cz);
    } else {
      this.coldStorage.set(worldChunk.cx, worldChunk.cy, worldChunk.cz, cells);
    }
    // This chunk may already be staged (as a 'generate' item, since an
    // off-window write only reaches here) for an in-flight pending shift --
    // the cold-storage entry it resolves to may have just changed above.
    const key = this.chunkKey(worldChunk.cx, worldChunk.cy, worldChunk.cz);
    if (this.pendingShift?.staged.has(key)) {
      this.pendingShift.editedDuringStaging.set(key, worldChunk);
    }
  }

  /**
   * Moves the window so the chunk containing the given world cell coordinate
   * sits `radius` chunks in from the window's edge on every axis. No-ops if
   * the focus chunk hasn't changed since the last call. Returns true only if
   * the window's committed state actually changed *this call* — false both
   * for a true no-op AND for a target that needs generation and is now
   * pending (see `advance`); the target chunk isn't visited/interactive
   * until every needed chunk's data exists, so a large jump (e.g. a
   * teleport) is handled exactly like a normal shift, just with less (or no)
   * reused overlap to wait less on.
   */
  setFocus(cellX: number, cellY: number, cellZ: number): boolean {
    // Build on whatever's currently being targeted (a pending shift/resize,
    // if one's in flight) rather than the stale committed state -- see
    // effectiveTarget()'s doc comment for why this matters.
    const eff = this.effectiveTarget();
    const focusChunk: ChunkCoord = {
      cx: Math.floor(cellX / this.chunkSize.x),
      cy: Math.floor(cellY / this.chunkSize.y),
      cz: Math.floor(cellZ / this.chunkSize.z),
    };
    const desiredOrigin: ChunkCoord = {
      cx: focusChunk.cx - eff.radius.x,
      cy: focusChunk.cy - eff.radius.y,
      cz: focusChunk.cz - eff.radius.z,
    };
    return this.requestTarget(desiredOrigin, eff.gridDims, eff.cellDims);
  }

  /**
   * Grows or shrinks the window's padding radius, reassembling its contents
   * around the current focus point (derived from `origin + radius`, or
   * `(0,0,0)` if `setFocus` has never run) at the new size — same evict/
   * reuse-overlap/generate mechanics as a normal shift, just with a
   * different-sized destination. Returns true only if the window's committed
   * state actually changed *this call* (see `setFocus`'s note on pending
   * targets — a resize that needs new chunk data doesn't commit
   * `windowRadius` until `advance` finishes generating it).
   */
  resize(newRadius: { x: number; y: number; z: number }): boolean {
    if (
      !Number.isInteger(newRadius.x) ||
      newRadius.x < 0 ||
      !Number.isInteger(newRadius.y) ||
      newRadius.y < 0 ||
      !Number.isInteger(newRadius.z) ||
      newRadius.z < 0
    ) {
      throw new Error(
        `[cell-map] Invalid window radius (${newRadius.x}, ${newRadius.y}, ${newRadius.z}) ` +
          `— must be non-negative integers`,
      );
    }
    // Build on whatever's currently being targeted, same as setFocus — see
    // effectiveTarget()'s doc comment.
    const eff = this.effectiveTarget();
    const focusChunk: ChunkCoord = eff.origin
      ? {
          cx: eff.origin.cx + eff.radius.x,
          cy: eff.origin.cy + eff.radius.y,
          cz: eff.origin.cz + eff.radius.z,
        }
      : { cx: 0, cy: 0, cz: 0 };
    const newGridDims = {
      x: 2 * newRadius.x + 1,
      y: 2 * newRadius.y + 1,
      z: 2 * newRadius.z + 1,
    };
    const newCellDims = {
      x: newGridDims.x * this.chunkSize.x,
      y: newGridDims.y * this.chunkSize.y,
      z: newGridDims.z * this.chunkSize.z,
    };
    const newOrigin: ChunkCoord = {
      cx: focusChunk.cx - newRadius.x,
      cy: focusChunk.cy - newRadius.y,
      cz: focusChunk.cz - newRadius.z,
    };
    return this.requestTarget(newOrigin, newGridDims, newCellDims, newRadius);
  }

  /**
   * The window state `setFocus`/`resize` should build their next target on
   * top of: an in-flight `pendingShift`'s target if one exists, else the
   * committed window. Both `setFocus` and `setWindowRadius` are called
   * unconditionally every frame by the render loop (see `render-cell-maps
   * .ts`) — if either computed its target from the stale *committed* state
   * while the other has a shift pending, they'd compute two different
   * targets every frame and perpetually overwrite each other's
   * `pendingShift` before either could ever finish draining its queue (a
   * livelock, not just wasted work). Building on the SAME in-flight target
   * instead means a call whose own axis hasn't changed (radius for
   * `setFocus`, focus point for `resize`) reproduces the exact current
   * `pendingShift`, which `beginOrRetarget`'s already-targeting-this check
   * then leaves untouched.
   */
  private effectiveTarget(): {
    origin: ChunkCoord | null;
    gridDims: { x: number; y: number; z: number };
    cellDims: { x: number; y: number; z: number };
    radius: { x: number; y: number; z: number };
  } {
    if (this.pendingShift) {
      return {
        origin: this.pendingShift.origin,
        gridDims: this.pendingShift.gridDims,
        cellDims: this.pendingShift.cellDims,
        radius: this.pendingShift.targetRadius ?? this.windowRadius,
      };
    }
    return {
      origin: this.originChunk,
      gridDims: this.gridDims,
      cellDims: this.cellDims,
      radius: this.windowRadius,
    };
  }

  /**
   * Shared no-op/targeting entry point for `setFocus`/`resize`. If `origin`+
   * `gridDims` already exactly match the *committed* window, any in-flight
   * `pendingShift` chasing a different target is abandoned (e.g. the focus
   * point moved away and came back before generation finished) and this is a
   * true no-op. Otherwise delegates to `beginOrRetarget`.
   */
  private requestTarget(
    origin: ChunkCoord,
    gridDims: { x: number; y: number; z: number },
    cellDims: { x: number; y: number; z: number },
    targetRadius?: { x: number; y: number; z: number },
  ): boolean {
    if (
      this.originChunk &&
      this.originChunk.cx === origin.cx &&
      this.originChunk.cy === origin.cy &&
      this.originChunk.cz === origin.cz &&
      this.gridDims.x === gridDims.x &&
      this.gridDims.y === gridDims.y &&
      this.gridDims.z === gridDims.z
    ) {
      this.pendingShift = null;
      return false;
    }
    return this.beginOrRetarget(origin, gridDims, cellDims, targetRadius);
  }

  /**
   * Starts (or retargets) a pending shift toward `origin`/`gridDims`. Chunks
   * that would need generation are classified up front (cheap — no
   * generation yet, just `isWithin`/cold-storage checks); previously-staged
   * data for chunks the new target still needs is carried over (world-
   * coordinate-keyed, so a retarget while mid-flight doesn't waste completed
   * work). Commits immediately (no deferral) if nothing needs generation —
   * e.g. a small shift entirely into already-visited territory.
   */
  private beginOrRetarget(
    origin: ChunkCoord,
    gridDims: { x: number; y: number; z: number },
    cellDims: { x: number; y: number; z: number },
    targetRadius?: { x: number; y: number; z: number },
  ): boolean {
    if (
      this.pendingShift &&
      this.pendingShift.origin.cx === origin.cx &&
      this.pendingShift.origin.cy === origin.cy &&
      this.pendingShift.origin.cz === origin.cz &&
      this.pendingShift.gridDims.x === gridDims.x &&
      this.pendingShift.gridDims.y === gridDims.y &&
      this.pendingShift.gridDims.z === gridDims.z
    ) {
      return false; // Already targeting this -- advance() keeps progressing it.
    }

    const needed = this.neededForTarget(origin, gridDims);
    if (needed.length === 0) {
      this.pendingShift = null;
      this.reassemble(origin, gridDims, cellDims);
      if (targetRadius) this.windowRadius = targetRadius;
      return true;
    }

    const prevStaged = this.pendingShift?.staged;
    const prevEdited = this.pendingShift?.editedDuringStaging;
    const staged = new Map<string, Uint32Array>();
    const queue: { coord: ChunkCoord; source: 'reuse' | 'generate' }[] = [];
    for (const item of needed) {
      const key = this.chunkKey(item.coord.cx, item.coord.cy, item.coord.cz);
      const prior = prevStaged?.get(key);
      if (prior) {
        staged.set(key, prior);
      } else {
        queue.push(item);
      }
    }
    // Nearest-to-target-center first, mirroring rebuildDirtyChunks's
    // distance sort in mesh-builder.ts -- visible/near chunks' data is ready
    // before distant buffer-zone ones if the budget can't cover everything
    // in one advance() call.
    const centerX = origin.cx + (gridDims.x - 1) / 2;
    const centerY = origin.cy + (gridDims.y - 1) / 2;
    const centerZ = origin.cz + (gridDims.z - 1) / 2;
    queue.sort((a, b) => {
      const da =
        (a.coord.cx - centerX) ** 2 +
        (a.coord.cy - centerY) ** 2 +
        (a.coord.cz - centerZ) ** 2;
      const db =
        (b.coord.cx - centerX) ** 2 +
        (b.coord.cy - centerY) ** 2 +
        (b.coord.cz - centerZ) ** 2;
      return da - db;
    });

    this.pendingShift = {
      origin,
      gridDims,
      cellDims,
      queue,
      queueIndex: 0,
      staged,
      // Carried over as-is (not re-filtered against the new target) -- at
      // worst this re-resolves a chunk the new target no longer needs into
      // an unused `staged` entry, harmless. See setCell for how this gets
      // populated.
      editedDuringStaging: prevEdited ?? new Map<string, ChunkCoord>(),
      targetRadius,
    };
    return false;
  }

  /**
   * Classifies every chunk a target window will need and how to get it:
   * `'reuse'` if it's within the *current* (committed) window (its data
   * needs to move, not change -- staged by reading the live store, see
   * `extractLiveChunk`), `'generate'` if it needs `baselineChunk`. Chunks
   * resolvable from cold storage are omitted entirely -- that lookup is
   * already cheap (a `Map.get`, no generation/copy), so `reassemble`'s
   * assembly loop keeps resolving those directly rather than staging them.
   * No generation or copying happens here; this is the cheap up-front pass
   * `beginOrRetarget` uses to build (or shrink) a pending shift's queue.
   */
  private neededForTarget(
    origin: ChunkCoord,
    gridDims: { x: number; y: number; z: number },
  ): { coord: ChunkCoord; source: 'reuse' | 'generate' }[] {
    const needed: { coord: ChunkCoord; source: 'reuse' | 'generate' }[] = [];
    for (let cz = 0; cz < gridDims.z; cz++) {
      for (let cy = 0; cy < gridDims.y; cy++) {
        for (let cx = 0; cx < gridDims.x; cx++) {
          const worldChunk: ChunkCoord = {
            cx: origin.cx + cx,
            cy: origin.cy + cy,
            cz: origin.cz + cz,
          };
          if (
            this.originChunk &&
            this.isWithin(worldChunk, this.originChunk, this.gridDims)
          ) {
            needed.push({ coord: worldChunk, source: 'reuse' });
            continue;
          }
          if (
            this.coldStorage.get(worldChunk.cx, worldChunk.cy, worldChunk.cz)
          ) {
            continue;
          }
          needed.push({ coord: worldChunk, source: 'generate' });
        }
      }
    }
    return needed;
  }

  /**
   * Reads one chunk's cells directly out of the *live* WASM store, at its
   * current (pre-shift) position -- used to stage a `'reuse'`-sourced queue
   * item. Reading live (at the moment this chunk's turn in the queue comes
   * up) rather than from a single upfront whole-window snapshot is what lets
   * `reassemble` skip `cellStoreDump()`'s cost entirely for the common,
   * fully-staged case -- there's no snapshot to take. Only ever called for a
   * chunk `neededForTarget` classified `'reuse'`, which is only possible
   * when `originChunk` is set (that's the window it's being reused from).
   */
  private extractLiveChunk(worldChunk: ChunkCoord): Uint32Array {
    const origin = this.originChunk!;
    const view = getExpandedStoreView();
    return this.extractChunk(
      view,
      worldChunk.cx - origin.cx,
      worldChunk.cy - origin.cy,
      worldChunk.cz - origin.cz,
      this.cellDims,
    );
  }

  /**
   * Canonical chunk-data resolution order, shared by every place in this
   * class that needs to answer "what are this world-chunk's cells right
   * now": an in-flight pending shift's staged data (only when the caller
   * opts in via `checkStaged` -- most callers already know their answer
   * can't be staged, or have already checked it themselves as a fast path),
   * then live in-window data, then cold storage, then procedural baseline
   * generation. Centralizing this is what makes it impossible for the
   * eviction/assembly loop, `advance`'s per-item staging, and commit-time
   * re-resolution to independently drift on priority order or on whether
   * cold storage even gets checked -- see
   * `.design/chunk-buffering/10-unify-chunk-resolution-paths.md`. Live data
   * always wins over a cold-storage snapshot when both exist for the same
   * coordinate: the live store reflects every edit up to this instant, cold
   * storage only reflects whatever was true the last time this chunk was
   * evicted (and is never deleted on a read, so a chunk that re-entered the
   * window via cold storage can leave a stale entry behind indefinitely).
   */
  private resolveChunk(
    worldChunk: ChunkCoord,
    opts: { checkStaged?: boolean } = {},
  ): Uint32Array {
    if (opts.checkStaged) {
      const staged = this.pendingShift?.staged.get(
        this.chunkKey(worldChunk.cx, worldChunk.cy, worldChunk.cz),
      );
      if (staged) return staged;
    }
    if (
      this.originChunk &&
      this.isWithin(worldChunk, this.originChunk, this.gridDims)
    ) {
      return this.extractLiveChunk(worldChunk);
    }
    const fromCold = this.coldStorage.get(
      worldChunk.cx,
      worldChunk.cy,
      worldChunk.cz,
    );
    if (fromCold) {
      this.editedSinceBaseline.add(
        this.chunkKey(worldChunk.cx, worldChunk.cy, worldChunk.cz),
      );
      return fromCold;
    }
    return this.baselineChunk(worldChunk);
  }

  /**
   * Advances a pending shift's queue by up to `budgetMs` of wall-clock time
   * (always processing at least one chunk, so a single expensive one can't
   * stall progress forever -- same pattern as `rebuildDirtyChunks` in
   * `mesh-builder.ts`). Once every needed chunk's data is staged, re-checks
   * any chunk edited mid-flight (`editedDuringStaging`) so no edit is ever
   * silently lost, commits the shift (calls `reassemble`, which finds
   * everything already staged and pays no per-chunk cost at swap time), and
   * returns true. No-ops (false) if there's no pending shift, or the queue
   * isn't empty yet. Call once per frame regardless of whether
   * `setFocus`/`resize` were called with a new target that frame.
   */
  advance(budgetMs: number = DEFAULT_CHUNK_DATA_GEN_BUDGET_MS): boolean {
    const pending = this.pendingShift;
    if (!pending) return false;

    const deadline = performance.now() + budgetMs;
    let processed = 0;
    while (pending.queueIndex < pending.queue.length) {
      if (processed > 0 && performance.now() > deadline) break;
      const item = pending.queue[pending.queueIndex];
      // 'reuse' items are always in-window by construction (that's why
      // they were classified 'reuse'), so extractLiveChunk directly is
      // equivalent to resolveChunk's isWithin branch here -- kept explicit
      // for clarity. 'generate' items route through resolveChunk so a
      // cold-storage entry written by an off-window edit while this item
      // was still queued (neededForTarget saw nothing there at
      // classification time) gets picked up instead of stale-baseline-
      // generating over it.
      const cells =
        item.source === 'reuse'
          ? this.extractLiveChunk(item.coord)
          : this.resolveChunk(item.coord);
      pending.staged.set(
        this.chunkKey(item.coord.cx, item.coord.cy, item.coord.cz),
        cells,
      );
      pending.queueIndex++;
      processed++;
    }

    if (pending.queueIndex < pending.queue.length) return false;

    for (const [key, coord] of pending.editedDuringStaging) {
      pending.staged.set(key, this.resolveChunk(coord));
    }
    pending.editedDuringStaging.clear();

    this.reassemble(pending.origin, pending.gridDims, pending.cellDims);
    if (pending.targetRadius) this.windowRadius = pending.targetRadius;
    this.pendingShift = null;
    return true;
  }

  /**
   * Evicts/reuses/generates the window's contents for `newOrigin` at
   * `newGridDims`/`newCellDims` (which may differ in size from the current
   * window, for `resize()`, or match it, for a same-size `setFocus` shift)
   * and reloads the WASM store. Shared by both — the WASM `CellStore` doesn't
   * distinguish "shift" from "resize"; it just holds whatever's loaded.
   */
  private reassemble(
    newOrigin: ChunkCoord,
    newGridDims: { x: number; y: number; z: number },
    newCellDims: { x: number; y: number; z: number },
  ): void {
    const oldOrigin = this.originChunk;
    const oldGridDims = this.gridDims;
    const oldCellDims = this.cellDims;
    const { x: dimX, y: dimY, z: dimZ } = newCellDims;
    const total = dimX * dimY * dimZ;
    const staged = this.pendingShift?.staged;

    // Live views over the current store (source, for any rare fallback read
    // below) and a freshly reserved WASM buffer (dest, written directly --
    // no intermediate JS-heap `assembled` array). In the common case (a
    // pending shift's queue has already staged every chunk this call needs),
    // `source` ends up unused: reused-chunk data was already read live,
    // per-chunk, during `advance()`'s budgeted staging -- there's no
    // whole-window snapshot to pay for here anymore.
    const { source, dest } = getReassembleViews(total);

    // Evict chunks that fall outside the new window. Ones that still match
    // baseline are simply dropped — nothing to store.
    if (oldOrigin) {
      for (let cz = 0; cz < oldGridDims.z; cz++) {
        for (let cy = 0; cy < oldGridDims.y; cy++) {
          for (let cx = 0; cx < oldGridDims.x; cx++) {
            const worldChunk = {
              cx: oldOrigin.cx + cx,
              cy: oldOrigin.cy + cy,
              cz: oldOrigin.cz + cz,
            };
            if (this.isWithin(worldChunk, newOrigin, newGridDims)) continue;
            const key = this.chunkKey(
              worldChunk.cx,
              worldChunk.cy,
              worldChunk.cz,
            );
            if (!this.editedSinceBaseline.has(key)) {
              // Never written to since it last matched baseline — guaranteed
              // to still match. Skip extractChunk+matchesBaseline (and its
              // hidden baselineChunk/generator call) entirely.
              continue;
            }
            const cells = this.extractChunk(source, cx, cy, cz, oldCellDims);
            const matches = this.matchesBaseline(worldChunk, cells);
            if (matches) {
              this.editedSinceBaseline.delete(key);
            } else {
              this.coldStorage.set(
                worldChunk.cx,
                worldChunk.cy,
                worldChunk.cz,
                cells,
              );
            }
          }
        }
      }
    }

    // Assemble the new window's contents directly into `dest`.
    for (let cz = 0; cz < newGridDims.z; cz++) {
      for (let cy = 0; cy < newGridDims.y; cy++) {
        for (let cx = 0; cx < newGridDims.x; cx++) {
          const worldChunk = {
            cx: newOrigin.cx + cx,
            cy: newOrigin.cy + cy,
            cz: newOrigin.cz + cz,
          };
          const key = this.chunkKey(
            worldChunk.cx,
            worldChunk.cy,
            worldChunk.cz,
          );
          // Every chunk `neededForTarget` ever classifies gets staged before
          // advance() lets its queue drain and commits -- by the time this
          // loop runs, a chunk that's `isWithin` the old/committed window is
          // guaranteed to already be in `staged` (it would have been
          // classified 'reuse' and staged like any other queued item), and a
          // needed.length===0 immediate commit (the only path that runs with
          // nothing staged at all) is only reachable when there's zero
          // overlap with the old window in the first place. `resolveChunk`
          // below should therefore be unreachable in the current design --
          // kept as a safe fallback through the same canonical resolution
          // order every other chunk-sourcing call site uses, not an
          // assertion, in case a future change breaks one of those
          // invariants.
          const cells = staged?.get(key) ?? this.resolveChunk(worldChunk);
          this.writeChunk(dest, cx, cy, cz, cells, newCellDims);
        }
      }
    }

    commitCellStore(dimX, dimY, dimZ);
    this.originChunk = newOrigin;
    this.gridDims = newGridDims;
    this.cellDims = newCellDims;
  }

  /** Stable string key for `editedSinceBaseline`, by world-chunk coordinate. */
  private chunkKey(cx: number, cy: number, cz: number): string {
    return `${cx},${cy},${cz}`;
  }

  /** Whether `worldChunk` falls inside the `gridDims`-sized window starting at `origin`. */
  private isWithin(
    worldChunk: ChunkCoord,
    origin: ChunkCoord,
    gridDims: { x: number; y: number; z: number },
  ): boolean {
    return (
      worldChunk.cx >= origin.cx &&
      worldChunk.cx < origin.cx + gridDims.x &&
      worldChunk.cy >= origin.cy &&
      worldChunk.cy < origin.cy + gridDims.y &&
      worldChunk.cz >= origin.cz &&
      worldChunk.cz < origin.cz + gridDims.z
    );
  }

  /**
   * Whether `cells` (already-extracted, chunk-local order) matches this
   * chunk's baseline exactly — generated, if a generator covers it, or flat
   * `emptyCell` otherwise. Only a chunk that DIFFERS from its own baseline
   * needs a cold-storage entry.
   */
  private matchesBaseline(worldChunk: ChunkCoord, cells: Uint32Array): boolean {
    const baseline = this.baselineChunk(worldChunk);
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] !== baseline[i]) return false;
    }
    return true;
  }

  /** This chunk's baseline: generated, if a generator covers it, else flat `emptyCell`. */
  private baselineChunk(worldChunk: ChunkCoord): Uint32Array {
    const { x: csx, y: csy, z: csz } = this.chunkSize;
    const count = csx * csy * csz;
    if (this.generator?.generateChunk) {
      const generated = this.generator.generateChunk(
        worldChunk.cx,
        worldChunk.cy,
        worldChunk.cz,
      );
      if (generated.length !== count) {
        throw new Error(
          `ChunkGenerator.generateChunk returned ${generated.length} cells, expected ${count}`,
        );
      }
      return generated;
    }
    const out = new Uint32Array(count);
    if (this.generator?.generateCell) {
      const generateCell = this.generator.generateCell;
      const baseX = worldChunk.cx * csx;
      const baseY = worldChunk.cy * csy;
      const baseZ = worldChunk.cz * csz;
      // Flat single-loop traversal (matches Array3D.forEach's shape, see
      // math/index.ts) instead of a triple-nested for -- avoids two of the
      // three loop-control overheads. x innermost, then y, then z, same
      // order and semantics as before.
      let x = 0;
      let y = 0;
      let z = 0;
      let idx = 0;
      while (idx < count) {
        out[idx] =
          generateCell(baseX + x, baseY + y, baseZ + z) ?? this.emptyCell;
        x += 1;
        if (x >= csx) {
          y += 1;
          x = 0;
        }
        if (y >= csy) {
          z += 1;
          y = 0;
        }
        idx += 1;
      }
      return out;
    }
    return out.fill(this.emptyCell);
  }

  /** Extracts one chunk's cells (at chunk-grid position cx,cy,cz) from a dense
   *  flat array of the given cell dims, in chunk-local (0..chunkSize) order.
   *  `dims` is explicit (not `this.cellDims`) because during a resize the
   *  source flat array may be the OLD window's size, not the current one. */
  private extractChunk(
    flat: Uint32Array,
    cx: number,
    cy: number,
    cz: number,
    dims: { x: number; y: number },
  ): Uint32Array {
    const { x: csx, y: csy, z: csz } = this.chunkSize;
    const { x: dimX, y: dimY } = dims;
    const out = new Uint32Array(csx * csy * csz);
    const baseX = cx * csx;
    const baseY = cy * csy;
    const baseZ = cz * csz;
    let idx = 0;
    // A chunk's cells aren't contiguous in the whole-window flat array
    // (dims-strided, not chunk-strided), but for a fixed (y,z) the x-range
    // IS contiguous in both -- native bulk-copy one row at a time instead of
    // one cell at a time, a chunkSize.x-factor fewer JS loop iterations.
    for (let z = 0; z < csz; z++) {
      for (let y = 0; y < csy; y++) {
        const rowStart = (baseZ + z) * dimY * dimX + (baseY + y) * dimX + baseX;
        out.set(flat.subarray(rowStart, rowStart + csx), idx);
        idx += csx;
      }
    }
    return out;
  }

  /** Writes one chunk's cells into a dense flat array of the given cell dims
   *  at chunk-grid position cx,cy,cz. `dims` is explicit for the same reason
   *  as `extractChunk`'s — the destination during a resize is the NEW size. */
  private writeChunk(
    flat: Uint32Array,
    cx: number,
    cy: number,
    cz: number,
    cells: Uint32Array,
    dims: { x: number; y: number },
  ): void {
    const { x: csx, y: csy, z: csz } = this.chunkSize;
    const { x: dimX, y: dimY } = dims;
    const baseX = cx * csx;
    const baseY = cy * csy;
    const baseZ = cz * csz;
    let idx = 0;
    // Mirror of extractChunk's row-wise bulk copy.
    for (let z = 0; z < csz; z++) {
      for (let y = 0; y < csy; y++) {
        const rowStart = (baseZ + z) * dimY * dimX + (baseY + y) * dimX + baseX;
        flat.set(cells.subarray(idx, idx + csx), rowStart);
        idx += csx;
      }
    }
  }
}
