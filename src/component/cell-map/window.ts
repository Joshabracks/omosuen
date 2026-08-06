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
 * `.design/cell-map-overhaul/02-wasm-windowed-store.md`.
 */
import { loadCellStore, cellStoreDump } from '../camera/render/wasm';
import type { ChunkColdStorage } from './cold-storage';

export interface ChunkCoord {
  cx: number;
  cy: number;
  cz: number;
}

export interface WindowConfig {
  /** Cells per chunk, per axis. */
  chunkSize: { x: number; y: number; z: number };
  /** Padding radius in chunks, per axis. Default {1,1,1} (a 3x3x3 chunk window). */
  radius?: { x: number; y: number; z: number };
  /** Packed cell value representing "nothing here" (see cell-map/types.ts's packCell). */
  emptyCell: number;
}

export class CellWindow {
  private readonly chunkSize: { x: number; y: number; z: number };
  private readonly radius: { x: number; y: number; z: number };
  private readonly emptyCell: number;
  private readonly coldStorage: ChunkColdStorage;
  /** Window size in chunks (constant for the session). */
  private readonly gridDims: { x: number; y: number; z: number };
  /** Window size in cells (constant for the session). */
  private readonly cellDims: { x: number; y: number; z: number };
  private originChunk: ChunkCoord | null = null;

  constructor(config: WindowConfig, coldStorage: ChunkColdStorage) {
    this.chunkSize = config.chunkSize;
    this.radius = config.radius ?? { x: 1, y: 1, z: 1 };
    this.emptyCell = config.emptyCell;
    this.coldStorage = coldStorage;
    this.gridDims = {
      x: 2 * this.radius.x + 1,
      y: 2 * this.radius.y + 1,
      z: 2 * this.radius.z + 1,
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
      cx: focusChunk.cx - this.radius.x,
      cy: focusChunk.cy - this.radius.y,
      cz: focusChunk.cz - this.radius.z,
    };
    if (
      this.originChunk &&
      this.originChunk.cx === desiredOrigin.cx &&
      this.originChunk.cy === desiredOrigin.cy &&
      this.originChunk.cz === desiredOrigin.cz
    ) {
      return false;
    }
    this.shiftTo(desiredOrigin);
    return true;
  }

  private shiftTo(newOrigin: ChunkCoord): void {
    const oldOrigin = this.originChunk;
    const { x: dimX, y: dimY, z: dimZ } = this.cellDims;
    const total = dimX * dimY * dimZ;

    // Dump the current window's contents (nothing to dump before the first load).
    const oldFlat = oldOrigin ? cellStoreDump() : null;

    // Evict chunks that fall outside the new window. Ones that still match
    // baseline are simply dropped — nothing to store.
    if (oldOrigin && oldFlat) {
      for (let cz = 0; cz < this.gridDims.z; cz++) {
        for (let cy = 0; cy < this.gridDims.y; cy++) {
          for (let cx = 0; cx < this.gridDims.x; cx++) {
            const worldChunk = {
              cx: oldOrigin.cx + cx,
              cy: oldOrigin.cy + cy,
              cz: oldOrigin.cz + cz,
            };
            if (this.isWithin(worldChunk, newOrigin)) continue;
            const cells = this.extractChunk(oldFlat, cx, cy, cz);
            if (!this.matchesBaseline(cells)) {
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

    // Assemble the new window's contents.
    const assembled = new Uint32Array(total);
    for (let cz = 0; cz < this.gridDims.z; cz++) {
      for (let cy = 0; cy < this.gridDims.y; cy++) {
        for (let cx = 0; cx < this.gridDims.x; cx++) {
          const worldChunk = {
            cx: newOrigin.cx + cx,
            cy: newOrigin.cy + cy,
            cz: newOrigin.cz + cz,
          };
          let cells: Uint32Array;
          if (oldOrigin && oldFlat && this.isWithin(worldChunk, oldOrigin)) {
            cells = this.extractChunk(
              oldFlat,
              worldChunk.cx - oldOrigin.cx,
              worldChunk.cy - oldOrigin.cy,
              worldChunk.cz - oldOrigin.cz,
            );
          } else {
            cells =
              this.coldStorage.get(
                worldChunk.cx,
                worldChunk.cy,
                worldChunk.cz,
              ) ?? this.baselineChunk();
          }
          this.writeChunk(assembled, cx, cy, cz, cells);
        }
      }
    }

    loadCellStore(assembled, total, dimX, dimY, dimZ);
    this.originChunk = newOrigin;
  }

  /** Whether `worldChunk` falls inside the grid-dims-sized window starting at `origin`. */
  private isWithin(worldChunk: ChunkCoord, origin: ChunkCoord): boolean {
    return (
      worldChunk.cx >= origin.cx &&
      worldChunk.cx < origin.cx + this.gridDims.x &&
      worldChunk.cy >= origin.cy &&
      worldChunk.cy < origin.cy + this.gridDims.y &&
      worldChunk.cz >= origin.cz &&
      worldChunk.cz < origin.cz + this.gridDims.z
    );
  }

  private matchesBaseline(cells: Uint32Array): boolean {
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] !== this.emptyCell) return false;
    }
    return true;
  }

  private baselineChunk(): Uint32Array {
    const count = this.chunkSize.x * this.chunkSize.y * this.chunkSize.z;
    return new Uint32Array(count).fill(this.emptyCell);
  }

  /** Extracts one chunk's cells (at chunk-grid position cx,cy,cz) from a dense
   *  window-sized flat array, in chunk-local (0..chunkSize) order. */
  private extractChunk(
    flat: Uint32Array,
    cx: number,
    cy: number,
    cz: number,
  ): Uint32Array {
    const { x: csx, y: csy, z: csz } = this.chunkSize;
    const { x: dimX, y: dimY } = this.cellDims;
    const out = new Uint32Array(csx * csy * csz);
    const baseX = cx * csx;
    const baseY = cy * csy;
    const baseZ = cz * csz;
    let idx = 0;
    for (let z = 0; z < csz; z++) {
      for (let y = 0; y < csy; y++) {
        for (let x = 0; x < csx; x++) {
          const flatIdx =
            (baseZ + z) * dimY * dimX + (baseY + y) * dimX + (baseX + x);
          out[idx++] = flat[flatIdx];
        }
      }
    }
    return out;
  }

  /** Writes one chunk's cells into a dense window-sized flat array at chunk-grid position cx,cy,cz. */
  private writeChunk(
    flat: Uint32Array,
    cx: number,
    cy: number,
    cz: number,
    cells: Uint32Array,
  ): void {
    const { x: csx, y: csy, z: csz } = this.chunkSize;
    const { x: dimX, y: dimY } = this.cellDims;
    const baseX = cx * csx;
    const baseY = cy * csy;
    const baseZ = cz * csz;
    let idx = 0;
    for (let z = 0; z < csz; z++) {
      for (let y = 0; y < csy; y++) {
        for (let x = 0; x < csx; x++) {
          const flatIdx =
            (baseZ + z) * dimY * dimX + (baseY + y) * dimX + (baseX + x);
          flat[flatIdx] = cells[idx++];
        }
      }
    }
  }
}
