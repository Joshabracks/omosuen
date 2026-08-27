/**
 * A secondary per-cell data channel (emission-color highlights, smoothing
 * weights) that stays in sync with a `CellWindow`'s resident window, without
 * sharing any of `CellWindow`'s multi-frame shift-staging machinery.
 *
 * Unlike primary cell data, these channels have no procedural-generation
 * cost — a newly-exposed chunk's baseline is a flat constant, not a
 * generator call — so the whole reason `CellWindow.pendingShift`/`advance()`
 * exists (spreading expensive generation across frames to avoid an FPS
 * hitch) doesn't apply here. Instead, an `AuxiliaryChannel` reacts
 * synchronously to `CellWindow`'s `onReassemble` hook (see `window.ts`),
 * which fires once at the single point the window's committed position
 * actually changes — whether that shift committed immediately or via a
 * staged `pendingShift` — running its own evict/assemble pass that mirrors
 * `CellWindow.reassemble`'s own logic, just on a plain JS buffer instead of
 * the WASM store.
 */
import { ChunkColdStorage } from './cold-storage';
import type { ColdStorageEntrySnapshot } from './cold-storage';
import type { ChunkCoord } from './window';

/** Stable string key for a world-chunk coordinate (matches `CellWindow`'s own `chunkKey`). */
function chunkKey(cx: number, cy: number, cz: number): string {
  return `${cx},${cy},${cz}`;
}

/** Whether `worldChunk` falls inside the `gridDims`-sized window starting at `origin`. */
function isWithin(
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

/** Extracts one chunk's cells (at chunk-grid position cx,cy,cz) from a dense
 *  flat array of the given cell dims, in chunk-local (0..chunkSize) order.
 *  Mirrors `CellWindow`'s private `extractChunk` exactly. */
function extractChunk(
  flat: Uint32Array,
  cx: number,
  cy: number,
  cz: number,
  dims: { x: number; y: number },
  chunkSize: { x: number; y: number; z: number },
): Uint32Array {
  const { x: csx, y: csy, z: csz } = chunkSize;
  const { x: dimX, y: dimY } = dims;
  const out = new Uint32Array(csx * csy * csz);
  const baseX = cx * csx;
  const baseY = cy * csy;
  const baseZ = cz * csz;
  let idx = 0;
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
 *  at chunk-grid position cx,cy,cz. Mirrors `CellWindow`'s private `writeChunk`. */
function writeChunk(
  flat: Uint32Array,
  cx: number,
  cy: number,
  cz: number,
  cells: Uint32Array,
  dims: { x: number; y: number },
  chunkSize: { x: number; y: number; z: number },
): void {
  const { x: csx, y: csy, z: csz } = chunkSize;
  const { x: dimX, y: dimY } = dims;
  const baseX = cx * csx;
  const baseY = cy * csy;
  const baseZ = cz * csz;
  let idx = 0;
  for (let z = 0; z < csz; z++) {
    for (let y = 0; y < csy; y++) {
      const rowStart = (baseZ + z) * dimY * dimX + (baseY + y) * dimX + baseX;
      flat.set(cells.subarray(idx, idx + csx), rowStart);
      idx += csx;
    }
  }
}

function matchesBaselineFlat(
  cells: Uint32Array,
  baselineValue: number,
): boolean {
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] !== baselineValue) return false;
  }
  return true;
}

export interface AuxiliaryChannelConfig {
  chunkSize: { x: number; y: number; z: number };
  /** Value a cell has when nothing's ever diverged from it (e.g. 0 for emission color). */
  baselineValue: number;
  /**
   * Whether this channel can ever hold non-baseline content. `false` (the
   * common case for a uniform `smoothingWeights` number, which has no live
   * per-cell setter and so can never diverge post-construction) skips
   * eviction's extract+compare pass entirely, forever — there's nothing to
   * track. `true` enables the same "skip eviction for chunks provably still
   * at baseline" optimization the primary channel's `editedSinceBaseline`
   * provides.
   */
  trackDivergence: boolean;
  /**
   * The window's initial size in cells. The resident buffer is baseline-
   * filled at this size immediately, synchronously, in the constructor --
   * not left empty until the first `onWindowChange` -- because a window
   * whose initial construction needs staged generation (any chunk not
   * already resolvable from cold storage) doesn't commit its first
   * `reassemble()` synchronously; it can take several frames of
   * `advanceWindowGeneration` to drain. `value` must be usable (correctly
   * sized, baseline-filled) the whole time, or the very first render pass
   * crashes reading it before any reassemble has ever fired.
   */
  initialCellDims: { x: number; y: number; z: number };
}

export class AuxiliaryChannel {
  readonly coldStorage: ChunkColdStorage;
  private readonly chunkSize: { x: number; y: number; z: number };
  private readonly baselineValue: number;
  /** null when this channel can never diverge from baseline (see `trackDivergence`). */
  private readonly touchedSinceBaseline: Set<string> | null;
  private resident: Uint32Array = new Uint32Array(0);
  private currentOrigin: ChunkCoord | null = null;
  private currentGridDims: { x: number; y: number; z: number } = {
    x: 0,
    y: 0,
    z: 0,
  };
  private currentCellDims: { x: number; y: number; z: number } = {
    x: 0,
    y: 0,
    z: 0,
  };

  constructor(config: AuxiliaryChannelConfig) {
    this.chunkSize = config.chunkSize;
    this.baselineValue = config.baselineValue;
    this.touchedSinceBaseline = config.trackDivergence ? new Set() : null;
    this.coldStorage = new ChunkColdStorage({
      chunkCellCount:
        config.chunkSize.x * config.chunkSize.y * config.chunkSize.z,
    });
    this.currentCellDims = config.initialCellDims;
    const count =
      config.initialCellDims.x *
      config.initialCellDims.y *
      config.initialCellDims.z;
    this.resident = new Uint32Array(count).fill(config.baselineValue);
  }

  /** The current window's resident content, one value per cell (x-fastest/y/z-slowest). */
  get value(): Uint32Array {
    return this.resident;
  }

  /** Whether this channel can ever hold non-baseline content (see `AuxiliaryChannelConfig`). */
  get canDiverge(): boolean {
    return this.touchedSinceBaseline !== null;
  }

  /** Whether this channel currently holds any non-baseline content anywhere (resident or cold-stored). */
  get isEntirelyBaseline(): boolean {
    if (this.coldStorage.size > 0) return false;
    if (this.touchedSinceBaseline && this.touchedSinceBaseline.size > 0)
      return false;
    return true;
  }

  /** The current window's size in cells (matches the primary `CellWindow`'s `cellDimensions`). */
  get cellDims(): { x: number; y: number; z: number } {
    return this.currentCellDims;
  }

  /** The current window's size in chunks (matches the primary `CellWindow`'s `gridDimensions`). */
  get gridDims(): { x: number; y: number; z: number } {
    return this.currentGridDims;
  }

  /** The current window's world-chunk origin, or null before the first `onWindowChange`. */
  get origin(): ChunkCoord | null {
    return this.currentOrigin;
  }

  /**
   * Reads a world cell coordinate. `local` is the caller's own
   * `CellWindow.worldToLocal(worldX, worldY, worldZ)` result — passed in
   * rather than recomputed here so the in-window decision always matches
   * the primary window's exactly, with no risk of the two drifting.
   */
  get(
    worldX: number,
    worldY: number,
    worldZ: number,
    local: { x: number; y: number; z: number } | null,
  ): number {
    if (local) {
      const { x: dimX, y: dimY } = this.currentCellDims;
      return this.resident[local.z * dimY * dimX + local.y * dimX + local.x];
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
    return this.baselineValue;
  }

  /** Writes a world cell coordinate. `local` — see `get`'s doc comment. */
  set(
    worldX: number,
    worldY: number,
    worldZ: number,
    local: { x: number; y: number; z: number } | null,
    value: number,
  ): void {
    if (local) {
      const { x: dimX, y: dimY } = this.currentCellDims;
      this.resident[local.z * dimY * dimX + local.y * dimX + local.x] = value;
      if (this.touchedSinceBaseline) {
        const { x: csx, y: csy, z: csz } = this.chunkSize;
        const worldChunk: ChunkCoord = {
          cx: Math.floor(worldX / csx),
          cy: Math.floor(worldY / csy),
          cz: Math.floor(worldZ / csz),
        };
        this.touchedSinceBaseline.add(
          chunkKey(worldChunk.cx, worldChunk.cy, worldChunk.cz),
        );
      }
      return;
    }
    const { x: csx, y: csy, z: csz } = this.chunkSize;
    const worldChunk: ChunkCoord = {
      cx: Math.floor(worldX / csx),
      cy: Math.floor(worldY / csy),
      cz: Math.floor(worldZ / csz),
    };
    const cells =
      this.coldStorage.get(worldChunk.cx, worldChunk.cy, worldChunk.cz) ??
      new Uint32Array(csx * csy * csz).fill(this.baselineValue);
    const localX = worldX - worldChunk.cx * csx;
    const localY = worldY - worldChunk.cy * csy;
    const localZ = worldZ - worldChunk.cz * csz;
    cells[localZ * csy * csx + localY * csx + localX] = value;
    if (matchesBaselineFlat(cells, this.baselineValue)) {
      this.coldStorage.delete(worldChunk.cx, worldChunk.cy, worldChunk.cz);
    } else {
      this.coldStorage.set(worldChunk.cx, worldChunk.cy, worldChunk.cz, cells);
    }
  }

  /**
   * The synchronous evict/assemble cycle, called from `CellWindow`'s
   * `onReassemble` hook. Mirrors `CellWindow.reassemble`'s own eviction and
   * assembly loops (see `window.ts`), operating on `this.resident` instead
   * of the WASM store.
   */
  onWindowChange(
    old: {
      origin: ChunkCoord | null;
      gridDims: { x: number; y: number; z: number };
      cellDims: { x: number; y: number; z: number };
    },
    next: {
      origin: ChunkCoord;
      gridDims: { x: number; y: number; z: number };
      cellDims: { x: number; y: number; z: number };
    },
  ): void {
    const newTotal = next.cellDims.x * next.cellDims.y * next.cellDims.z;

    // Fast path: a channel with nothing in cold storage and nothing touched
    // since baseline is uniformly `baselineValue` everywhere, so the window's
    // new contents are that same constant no matter how it moved -- there is
    // nothing to evict and nothing to carry across. Skips the assembly loop
    // below, which otherwise allocates a fresh `Uint32Array` per chunk (via
    // `extractChunk`) for every chunk in the window on every shift. This is
    // the normal state of the smoothing channel (no live per-cell setter at
    // all) and of the emission channel until something is actually
    // highlighted. `isEntirelyBaseline` is conservative -- `set` records a
    // touch even when writing the baseline value itself -- so it can't
    // wrongly claim a diverged channel is clean.
    if (this.isEntirelyBaseline) {
      if (this.resident.length !== newTotal) {
        this.resident = new Uint32Array(newTotal).fill(this.baselineValue);
      } else {
        this.resident.fill(this.baselineValue);
      }
      this.currentOrigin = next.origin;
      this.currentGridDims = next.gridDims;
      this.currentCellDims = next.cellDims;
      return;
    }

    const newResident = new Uint32Array(newTotal);

    if (old.origin && this.touchedSinceBaseline) {
      for (let cz = 0; cz < old.gridDims.z; cz++) {
        for (let cy = 0; cy < old.gridDims.y; cy++) {
          for (let cx = 0; cx < old.gridDims.x; cx++) {
            const worldChunk: ChunkCoord = {
              cx: old.origin.cx + cx,
              cy: old.origin.cy + cy,
              cz: old.origin.cz + cz,
            };
            if (isWithin(worldChunk, next.origin, next.gridDims)) continue;
            const key = chunkKey(worldChunk.cx, worldChunk.cy, worldChunk.cz);
            if (!this.touchedSinceBaseline.has(key)) continue;
            const cells = extractChunk(
              this.resident,
              cx,
              cy,
              cz,
              old.cellDims,
              this.chunkSize,
            );
            if (matchesBaselineFlat(cells, this.baselineValue)) {
              this.touchedSinceBaseline.delete(key);
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

    for (let cz = 0; cz < next.gridDims.z; cz++) {
      for (let cy = 0; cy < next.gridDims.y; cy++) {
        for (let cx = 0; cx < next.gridDims.x; cx++) {
          const worldChunk: ChunkCoord = {
            cx: next.origin.cx + cx,
            cy: next.origin.cy + cy,
            cz: next.origin.cz + cz,
          };
          let cells: Uint32Array;
          if (old.origin && isWithin(worldChunk, old.origin, old.gridDims)) {
            cells = extractChunk(
              this.resident,
              worldChunk.cx - old.origin.cx,
              worldChunk.cy - old.origin.cy,
              worldChunk.cz - old.origin.cz,
              old.cellDims,
              this.chunkSize,
            );
          } else {
            const stored = this.coldStorage.get(
              worldChunk.cx,
              worldChunk.cy,
              worldChunk.cz,
            );
            if (stored) {
              cells = stored;
              if (this.touchedSinceBaseline) {
                this.touchedSinceBaseline.add(
                  chunkKey(worldChunk.cx, worldChunk.cy, worldChunk.cz),
                );
              }
            } else {
              const count =
                this.chunkSize.x * this.chunkSize.y * this.chunkSize.z;
              cells = new Uint32Array(count).fill(this.baselineValue);
            }
          }
          writeChunk(
            newResident,
            cx,
            cy,
            cz,
            cells,
            next.cellDims,
            this.chunkSize,
          );
        }
      }
    }

    this.resident = newResident;
    this.currentOrigin = next.origin;
    this.currentGridDims = next.gridDims;
    this.currentCellDims = next.cellDims;
  }

  /**
   * Chunks pre-authored whole-map data into cold storage, before the first
   * window `setFocus` -- mirrors the primary channel's
   * `chunkDenseArrayIntoColdStorage` (`data.ts`) exactly, minus the primary
   * channel's `forceStoreAll` concern: there's no generator here, so a
   * baseline-matching chunk left out of cold storage always resolves
   * correctly (baseline IS the correct value, not a second-guessable one).
   */
  seedFromDense(
    dense: ArrayLike<number>,
    dims: { x: number; y: number; z: number },
    originChunk: ChunkCoord = { cx: 0, cy: 0, cz: 0 },
  ): void {
    const gridX = Math.ceil(dims.x / this.chunkSize.x);
    const gridY = Math.ceil(dims.y / this.chunkSize.y);
    const gridZ = Math.ceil(dims.z / this.chunkSize.z);
    const { x: csx, y: csy, z: csz } = this.chunkSize;
    const chunkCellCount = csx * csy * csz;

    for (let cz = 0; cz < gridZ; cz++) {
      for (let cy = 0; cy < gridY; cy++) {
        for (let cx = 0; cx < gridX; cx++) {
          const cells = new Uint32Array(chunkCellCount);
          let differs = false;
          let idx = 0;
          for (let lz = 0; lz < csz; lz++) {
            const wz = cz * csz + lz;
            for (let ly = 0; ly < csy; ly++) {
              const wy = cy * csy + ly;
              for (let lx = 0; lx < csx; lx++) {
                const wx = cx * csx + lx;
                let value = this.baselineValue;
                if (wx < dims.x && wy < dims.y && wz < dims.z) {
                  value = dense[wz * dims.y * dims.x + wy * dims.x + wx];
                }
                cells[idx++] = value;
                if (value !== this.baselineValue) differs = true;
              }
            }
          }
          if (differs) {
            this.coldStorage.set(
              originChunk.cx + cx,
              originChunk.cy + cy,
              originChunk.cz + cz,
              cells,
            );
          }
        }
      }
    }
  }

  dumpEntries(): ColdStorageEntrySnapshot[] {
    return this.coldStorage.dumpEntries();
  }

  loadEntries(entries: ColdStorageEntrySnapshot[]): void {
    this.coldStorage.loadEntries(entries);
  }
}
