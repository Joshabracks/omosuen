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
  loadCellStore,
  cellStoreDump,
  cellStoreGet,
  cellStoreSet,
} from '../camera/render/wasm';
import type { ChunkColdStorage } from './cold-storage';

/**
 * TEMPORARY diagnostic instrumentation for the chunk-buffering FPS
 * investigation (see `.design/chunk-buffering`) -- logs each
 * `CellWindow.reassemble` call's timing/volume, prefixed `[chunk-timing]`,
 * plus how long it's been since the previous call (a small gap suggests two
 * calls landed in the same frame). Flip to `false` or delete once confirmed.
 */
const DEBUG_REASSEMBLE_TIMING = true;
let debugLastReassembleCallTime: number | null = null;

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
      this.editedSinceBaseline.add(
        this.chunkKey(
          Math.floor(worldX / csx),
          Math.floor(worldY / csy),
          Math.floor(worldZ / csz),
        ),
      );
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
  }

  /**
   * Moves the window so the chunk containing the given world cell coordinate
   * sits `radius` chunks in from the window's edge on every axis. No-ops if
   * the focus chunk hasn't changed since the last call. Returns true if a
   * shift (or the initial load) happened.
   *
   * Handles the general case, not just a single-chunk shift — a large jump
   * (e.g. a teleport) reassembles the whole window from cold storage/baseline
   * exactly like a normal shift, just with less (or no) reused overlap.
   */
  setFocus(cellX: number, cellY: number, cellZ: number): boolean {
    const focusChunk: ChunkCoord = {
      cx: Math.floor(cellX / this.chunkSize.x),
      cy: Math.floor(cellY / this.chunkSize.y),
      cz: Math.floor(cellZ / this.chunkSize.z),
    };
    const desiredOrigin: ChunkCoord = {
      cx: focusChunk.cx - this.windowRadius.x,
      cy: focusChunk.cy - this.windowRadius.y,
      cz: focusChunk.cz - this.windowRadius.z,
    };
    if (
      this.originChunk &&
      this.originChunk.cx === desiredOrigin.cx &&
      this.originChunk.cy === desiredOrigin.cy &&
      this.originChunk.cz === desiredOrigin.cz
    ) {
      return false;
    }
    this.reassemble(desiredOrigin, this.gridDims, this.cellDims);
    return true;
  }

  /**
   * Grows or shrinks the window's padding radius, reassembling its contents
   * around the current focus point (derived from `origin + radius`, or
   * `(0,0,0)` if `setFocus` has never run) at the new size — same evict/
   * reuse-overlap/generate mechanics as a normal shift, just with a
   * different-sized destination. No-ops (`false`) if `newRadius` is
   * unchanged. See `.design/cell-map-overhaul` (runtime window resizing).
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
    if (
      newRadius.x === this.windowRadius.x &&
      newRadius.y === this.windowRadius.y &&
      newRadius.z === this.windowRadius.z
    ) {
      return false;
    }
    const focusChunk: ChunkCoord = this.originChunk
      ? {
          cx: this.originChunk.cx + this.windowRadius.x,
          cy: this.originChunk.cy + this.windowRadius.y,
          cz: this.originChunk.cz + this.windowRadius.z,
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
    this.reassemble(newOrigin, newGridDims, newCellDims);
    this.windowRadius = newRadius;
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
    const debugStart = DEBUG_REASSEMBLE_TIMING ? performance.now() : 0;
    const debugMsSinceLastCall =
      DEBUG_REASSEMBLE_TIMING && debugLastReassembleCallTime !== null
        ? debugStart - debugLastReassembleCallTime
        : null;

    const oldOrigin = this.originChunk;
    const oldGridDims = this.gridDims;
    const oldCellDims = this.cellDims;
    const { x: dimX, y: dimY, z: dimZ } = newCellDims;
    const total = dimX * dimY * dimZ;

    // Dump the current window's contents (nothing to dump before the first load).
    const debugDumpStart = DEBUG_REASSEMBLE_TIMING ? performance.now() : 0;
    const oldFlat = oldOrigin ? cellStoreDump() : null;
    const debugDumpMs = DEBUG_REASSEMBLE_TIMING
      ? performance.now() - debugDumpStart
      : 0;

    // Evict chunks that fall outside the new window. Ones that still match
    // baseline are simply dropped — nothing to store.
    const debugEvictStart = DEBUG_REASSEMBLE_TIMING ? performance.now() : 0;
    let debugMatchesBaselineMs = 0;
    let debugEvictSkipped = 0;
    let debugEvictChecked = 0;
    if (oldOrigin && oldFlat) {
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
              debugEvictSkipped++;
              continue;
            }
            debugEvictChecked++;
            const cells = this.extractChunk(oldFlat, cx, cy, cz, oldCellDims);
            const debugMbStart = DEBUG_REASSEMBLE_TIMING
              ? performance.now()
              : 0;
            const matches = this.matchesBaseline(worldChunk, cells);
            if (DEBUG_REASSEMBLE_TIMING) {
              debugMatchesBaselineMs += performance.now() - debugMbStart;
            }
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
    const debugEvictMs = DEBUG_REASSEMBLE_TIMING
      ? performance.now() - debugEvictStart
      : 0;

    // Assemble the new window's contents.
    const debugAssembleStart = DEBUG_REASSEMBLE_TIMING ? performance.now() : 0;
    let debugBaselineGenMs = 0;
    let debugBaselineGenCalls = 0;
    const assembled = new Uint32Array(total);
    for (let cz = 0; cz < newGridDims.z; cz++) {
      for (let cy = 0; cy < newGridDims.y; cy++) {
        for (let cx = 0; cx < newGridDims.x; cx++) {
          const worldChunk = {
            cx: newOrigin.cx + cx,
            cy: newOrigin.cy + cy,
            cz: newOrigin.cz + cz,
          };
          let cells: Uint32Array;
          if (
            oldOrigin &&
            oldFlat &&
            this.isWithin(worldChunk, oldOrigin, oldGridDims)
          ) {
            cells = this.extractChunk(
              oldFlat,
              worldChunk.cx - oldOrigin.cx,
              worldChunk.cy - oldOrigin.cy,
              worldChunk.cz - oldOrigin.cz,
              oldCellDims,
            );
          } else {
            const fromCold = this.coldStorage.get(
              worldChunk.cx,
              worldChunk.cy,
              worldChunk.cz,
            );
            if (fromCold) {
              cells = fromCold;
              // Cold storage only ever holds non-baseline data (it's only
              // written when matchesBaseline is false), so a chunk sourced
              // from here must be tracked as possibly-non-baseline too.
              this.editedSinceBaseline.add(
                this.chunkKey(worldChunk.cx, worldChunk.cy, worldChunk.cz),
              );
            } else {
              const debugBgStart = DEBUG_REASSEMBLE_TIMING
                ? performance.now()
                : 0;
              cells = this.baselineChunk(worldChunk);
              if (DEBUG_REASSEMBLE_TIMING) {
                debugBaselineGenMs += performance.now() - debugBgStart;
                debugBaselineGenCalls++;
              }
            }
          }
          this.writeChunk(assembled, cx, cy, cz, cells, newCellDims);
        }
      }
    }
    const debugAssembleMs = DEBUG_REASSEMBLE_TIMING
      ? performance.now() - debugAssembleStart
      : 0;

    const debugLoadStart = DEBUG_REASSEMBLE_TIMING ? performance.now() : 0;
    loadCellStore(assembled, total, dimX, dimY, dimZ);
    const debugLoadMs = DEBUG_REASSEMBLE_TIMING
      ? performance.now() - debugLoadStart
      : 0;
    this.originChunk = newOrigin;
    this.gridDims = newGridDims;
    this.cellDims = newCellDims;

    if (DEBUG_REASSEMBLE_TIMING) {
      const ms = performance.now() - debugStart;
      const oldVolume = oldGridDims.x * oldGridDims.y * oldGridDims.z;
      const newVolume = newGridDims.x * newGridDims.y * newGridDims.z;
      console.log(
        `[chunk-timing] CellWindow.reassemble breakdown: ${ms.toFixed(2)}ms | ` +
          `dumpMs=${debugDumpMs.toFixed(2)} ` +
          `evictMs=${debugEvictMs.toFixed(2)} (matchesBaselineMs=${debugMatchesBaselineMs.toFixed(2)} checked=${debugEvictChecked} skipped=${debugEvictSkipped}) ` +
          `assembleMs=${debugAssembleMs.toFixed(2)} (baselineGenMs=${debugBaselineGenMs.toFixed(2)} baselineGenCalls=${debugBaselineGenCalls}) ` +
          `loadMs=${debugLoadMs.toFixed(2)} | ` +
          `oldVolume=${oldVolume} newVolume=${newVolume} ` +
          (debugMsSinceLastCall !== null
            ? `msSincePrevCall=${debugMsSinceLastCall.toFixed(2)}`
            : '(first call)'),
      );
      debugLastReassembleCallTime = performance.now();
    }
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
