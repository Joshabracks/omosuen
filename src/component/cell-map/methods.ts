import { ComponentMethods } from '../types';
import { Array3D, Array3Di, Vector3D } from '../../math';
import { CellMapT, initChunks, resetCellMapState } from './data';
import { CellData, Material, Mesh, packCell, unpackCell } from './types';
import type { RaycastHit, SurfaceHit, RaycastOptions } from './types';
import { markChunksDirty } from './mesh-builder';
import {
  raycastCellMap,
  cellSurfacePoint,
  sampleSurfaceHeight,
} from './raycast';
import { cellStoreFlush } from '../camera/render/wasm';

/**
 * Rejects a malformed coordinate (NaN, ±Infinity, non-numeric) before it
 * reaches the WASM store or an Array3D. This is a well-formedness check, not
 * a spatial bounds check — plain range comparisons (`x < 0 || x >= mapSize.x`)
 * silently let NaN through, since every comparison against NaN is false. A
 * bad coordinate is a bug regardless of where a shiftable window (once one
 * exists) happens to be, so this throws unconditionally — see
 * `.design/completed_tasks/cell-map-overhaul/07-bounds-checking-diagnostics.md`.
 */
function assertFiniteCoordinates(x: number, y: number, z: number): void {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    throw new Error(
      `[cell-map] Invalid coordinates: (${x}, ${y}, ${z}) — must be finite numbers`,
    );
  }
}

export interface CellMapMethods extends ComponentMethods {
  type: 'cell-map';

  /**
   * Get all data for a cell at the given coordinates
   */
  getCellData: (component: CellMapT, coordinates: Vector3D) => CellData;

  /**
   * Set all data for a cell at the given coordinates
   */
  setCellData: (
    component: CellMapT,
    coordinates: Vector3D,
    data: CellData,
  ) => void;

  /**
   * Set only the material index for a cell
   */
  setMaterial: (
    component: CellMapT,
    coordinates: Vector3D,
    materialIndex: number,
  ) => void;

  /**
   * Set only the shape index for a cell
   */
  setShape: (
    component: CellMapT,
    coordinates: Vector3D,
    shapeIndex: number,
  ) => void;

  /**
   * Set only the emission intensity for a cell
   */
  setEmission: (
    component: CellMapT,
    coordinates: Vector3D,
    intensity: number,
  ) => void;

  /**
   * Set the per-cell emission (highlight) color. `color` channels are 0-1; (0,0,0)
   * clears the highlight. Independent of `setEmission` (which drives the emissive
   * texture brightness). Updates a GPU texture next frame — no remesh.
   */
  setEmissionColor: (
    component: CellMapT,
    coordinates: Vector3D,
    color: Vector3D,
  ) => void;

  /** Get the per-cell emission (highlight) color as a Vector3D (channels 0-1). */
  getEmissionColor: (component: CellMapT, coordinates: Vector3D) => Vector3D;

  /**
   * Set only the visibility flag for a cell
   */
  setVisible: (
    component: CellMapT,
    coordinates: Vector3D,
    visible: boolean,
  ) => void;

  /**
   * Get a material definition by index
   */
  getMaterial: (component: CellMapT, index: number) => Material | undefined;

  /**
   * Get a mesh by index
   */
  getMesh: (component: CellMapT, index: number) => Mesh | undefined;

  /**
   * Add a new material and return its index
   */
  addMaterial: (component: CellMapT, material: Material) => number;

  /**
   * Add a new mesh and return its index
   */
  addMesh: (component: CellMapT, mesh: Mesh) => number;

  /**
   * Mark GPU data as clean (called after upload to GPU)
   */
  markGPUClean: (component: CellMapT) => void;

  /**
   * World-space position of the center of a cell's TOP face for the given cell
   * coordinates: horizontally centered (x, z) and at the cell's top edge (y). Handy
   * for seating an entity — e.g. a bottom-center-anchored sprite — on top of a cell
   * without computing cellSize offsets by hand. (Coordinates are not bounds-checked.)
   */
  cellToWorldCoordinates: (
    component: CellMapT,
    coordinates: Vector3D,
  ) => Vector3D;

  /**
   * Get world-space bounding box
   */
  getBounds: (component: CellMapT) => { min: Vector3D; max: Vector3D };

  /**
   * Move the resident window to cover the given world position, shifting the
   * hot buffer if needed. Marks every chunk dirty when a shift occurs (the
   * doc 09 correctness-first strategy — only the newly-loaded slab needs it,
   * but a targeted remesh is deferred future work). Called once per frame by
   * the render loop when `autoFocusFromCamera` is enabled; also public for
   * games that want explicit control instead.
   */
  setFocus: (
    component: CellMapT,
    worldX: number,
    worldY: number,
    worldZ: number,
  ) => void;

  /**
   * Grows or shrinks the resident window's padding radius (in chunks per
   * axis), clamped to `component.maxWindowRadius`, and re-centers it on the
   * current focus point. Rebuilds the chunk array (and the secondary dense
   * maps sized to the window — `emissionColorMap`/`smoothingWeights`) and
   * marks everything dirty when a resize actually happens. Called once per
   * frame by the render loop when `autoResizeFromZoom` is enabled; also
   * public for games that want explicit control instead. Returns whether a
   * resize happened.
   */
  setWindowRadius: (
    component: CellMapT,
    radius: { x: number; y: number; z: number },
  ) => boolean;

  /**
   * Cast a ray against the cell-map's ACTUAL rendered surface (smoothing + custom
   * meshes accounted for) and return the nearest hit, or null on a miss. `dir` need
   * not be normalized; `distance` is in world units.
   */
  raycast: (
    component: CellMapT,
    origin: Vector3D,
    dir: Vector3D,
    opts?: RaycastOptions,
  ) => RaycastHit | null;

  /**
   * World-space point on the real top surface at a cell's top-center — the accurate,
   * smoothing/custom-mesh-aware counterpart to `cellToWorldCoordinates` for seating a
   * bottom-center-anchored sprite. Falls back to the analytic top-face center when the
   * cell has no exposed top surface (air / fully-enclosed).
   */
  getSurfacePoint: (
    component: CellMapT,
    coordinates: Vector3D,
    opts?: RaycastOptions,
  ) => Vector3D;

  /**
   * Topmost real surface (point + normal) at an arbitrary world (x,z) — for smooth
   * cell-to-cell traversal as an entity walks. Returns null if the column is empty.
   */
  sampleSurfaceHeight: (
    component: CellMapT,
    worldX: number,
    worldZ: number,
    opts?: RaycastOptions,
  ) => SurfaceHit | null;

  /**
   * Flush dirty changes to compressed storage
   */
  flush: (component: CellMapT) => void;
}

export const CellMap: CellMapMethods = {
  type: 'cell-map',

  getCellData: (component: CellMapT, coordinates: Vector3D): CellData => {
    const { x, y, z } = coordinates;
    const packed = component.window.queryCell(x, y, z);
    return unpackCell(packed);
  },

  setCellData: (
    component: CellMapT,
    coordinates: Vector3D,
    data: CellData,
  ): void => {
    // Clamp values to valid ranges
    const clamped: CellData = {
      materialIndex: Math.max(0, Math.min(0xfff, data.materialIndex)),
      shapeIndex: Math.max(0, Math.min(0xfff, data.shapeIndex)),
      emissionIntensity: Math.max(0, Math.min(0x1f, data.emissionIntensity)),
      visible: data.visible,
    };

    const packed = packCell(clamped);
    component.window.setCell(
      coordinates.x,
      coordinates.y,
      coordinates.z,
      packed,
    );
    component.needsGPUUpdate = true;
    markChunksDirty(component, coordinates.x, coordinates.y, coordinates.z);
  },

  setMaterial: (
    component: CellMapT,
    coordinates: Vector3D,
    materialIndex: number,
  ): void => {
    const current = CellMap.getCellData(component, coordinates);
    current.materialIndex = Math.max(0, Math.min(0xfff, materialIndex));
    CellMap.setCellData(component, coordinates, current);
  },

  setShape: (
    component: CellMapT,
    coordinates: Vector3D,
    shapeIndex: number,
  ): void => {
    const current = CellMap.getCellData(component, coordinates);
    current.shapeIndex = Math.max(0, Math.min(0xfff, shapeIndex));
    CellMap.setCellData(component, coordinates, current);
  },

  setEmission: (
    component: CellMapT,
    coordinates: Vector3D,
    intensity: number,
  ): void => {
    const current = CellMap.getCellData(component, coordinates);
    current.emissionIntensity = Math.max(0, Math.min(0x1f, intensity));
    CellMap.setCellData(component, coordinates, current);
  },

  setEmissionColor: (
    component: CellMapT,
    coordinates: Vector3D,
    color: Vector3D,
  ): void => {
    assertFiniteCoordinates(coordinates.x, coordinates.y, coordinates.z);
    const to255 = (c: number): number =>
      Math.max(0, Math.min(255, Math.round(c * 255)));
    const packed =
      (to255(color.x) << 16) | (to255(color.y) << 8) | to255(color.z);
    // Per-cell color is a texture-side channel (not baked into vertices), so this
    // never triggers a remesh — just flags the GPU texture for re-upload.
    component.emissionColorMap.set(coordinates, packed);
    component.emissionColorDirty = true;
  },

  getEmissionColor: (
    component: CellMapT,
    coordinates: Vector3D,
  ): Vector3D => {
    assertFiniteCoordinates(coordinates.x, coordinates.y, coordinates.z);
    const packed = component.emissionColorMap.get(coordinates) | 0;
    return new Vector3D(
      ((packed >> 16) & 0xff) / 255,
      ((packed >> 8) & 0xff) / 255,
      (packed & 0xff) / 255,
    );
  },

  setVisible: (
    component: CellMapT,
    coordinates: Vector3D,
    visible: boolean,
  ): void => {
    const current = CellMap.getCellData(component, coordinates);
    current.visible = visible;
    CellMap.setCellData(component, coordinates, current);
  },

  getMaterial: (component: CellMapT, index: number): Material | undefined => {
    return component.materials[index];
  },

  getMesh: (component: CellMapT, index: number): Mesh | undefined => {
    return component.meshes[index];
  },

  addMaterial: (component: CellMapT, material: Material): number => {
    component.materials.push(material);
    const index = component.materials.length - 1;

    if (index > 0xfff) {
      console.warn(
        `Material index ${index} exceeds maximum (4095). Consider using fewer materials.`,
      );
    }

    return index;
  },

  addMesh: (component: CellMapT, mesh: Mesh): number => {
    component.meshes.push(mesh);
    const index = component.meshes.length - 1;

    if (index > 0xfff) {
      console.warn(
        `Mesh index ${index} exceeds maximum (4095). Consider using fewer meshes.`,
      );
    }

    return index;
  },

  markGPUClean: (component: CellMapT): void => {
    component.needsGPUUpdate = false;
  },

  cellToWorldCoordinates: (
    component: CellMapT,
    coordinates: Vector3D,
  ): Vector3D => {
    const { cellSize } = component;
    return new Vector3D(
      (coordinates.x + 0.5) * cellSize.x, // horizontal center
      (coordinates.y + 1) * cellSize.y, // top face of the cell
      (coordinates.z + 0.5) * cellSize.z, // depth center
    );
  },

  getBounds: (component: CellMapT): { min: Vector3D; max: Vector3D } => {
    const origin = component.window.origin;
    const ox = (origin?.cx ?? 0) * component.chunkSize.x * component.cellSize.x;
    const oy = (origin?.cy ?? 0) * component.chunkSize.y * component.cellSize.y;
    const oz = (origin?.cz ?? 0) * component.chunkSize.z * component.cellSize.z;
    const min = new Vector3D(ox, oy, oz);
    const max = new Vector3D(
      ox + component.mapSize.x * component.cellSize.x,
      oy + component.mapSize.y * component.cellSize.y,
      oz + component.mapSize.z * component.cellSize.z,
    );
    return { min, max };
  },

  setFocus: (
    component: CellMapT,
    worldX: number,
    worldY: number,
    worldZ: number,
  ): void => {
    const shifted = component.window.setFocus(
      Math.floor(worldX / component.cellSize.x),
      Math.floor(worldY / component.cellSize.y),
      Math.floor(worldZ / component.cellSize.z),
    );
    if (shifted) {
      for (const chunk of component.chunks) chunk.dirty = true;
    }
  },

  setWindowRadius: (
    component: CellMapT,
    radius: { x: number; y: number; z: number },
  ): boolean => {
    const max = component.maxWindowRadius;
    const clamped = {
      x: Math.min(radius.x, max.x),
      y: Math.min(radius.y, max.y),
      z: Math.min(radius.z, max.z),
    };
    const resized = component.window.resize(clamped);
    if (!resized) return false;

    component.mapSize = new Vector3D(
      component.window.cellDimensions.x,
      component.window.cellDimensions.y,
      component.window.cellDimensions.z,
    );
    component.chunkGridSize = component.window.gridDimensions;
    component.chunks = initChunks(component.window.gridDimensions);
    component.needsGPUUpdate = true;

    // The secondary dense maps (emissionColorMap/smoothingWeights) are sized
    // to the window and have no per-chunk windowing of their own yet (doc 13,
    // deferred) -- reallocate them to the new size so nothing downstream reads
    // a stale length against the new mapSize. This resets any per-cell
    // emission-color edits made at the old size (a known, accepted
    // limitation); the uniform smoothing weight is preserved by reading it
    // back before reallocating.
    component.emissionColorMap = new Array3D<number>(component.mapSize, 0);
    component.emissionColorDirty = true;
    const uniformWeight = component.smoothingWeights.expand().value[0] ?? 8;
    component.smoothingWeights = new Array3Di(
      new Array3D<number>(component.mapSize, uniformWeight),
      8,
      [4, 4],
      'clamp',
    );

    return true;
  },

  raycast: (
    component: CellMapT,
    origin: Vector3D,
    dir: Vector3D,
    opts?: RaycastOptions,
  ): RaycastHit | null => raycastCellMap(component, origin, dir, opts),

  getSurfacePoint: (
    component: CellMapT,
    coordinates: Vector3D,
    opts?: RaycastOptions,
  ): Vector3D => cellSurfacePoint(component, coordinates, opts),

  sampleSurfaceHeight: (
    component: CellMapT,
    worldX: number,
    worldZ: number,
    opts?: RaycastOptions,
  ): SurfaceHit | null =>
    sampleSurfaceHeight(component, worldX, worldZ, opts),

  flush: (component: CellMapT): void => {
    cellStoreFlush();
    component.needsGPUUpdate = true;
  },

  dispose: (c) => {
    const cm = c as unknown as CellMapT;
    for (const chunk of cm.chunks) {
      chunk.glVertexBuffer = null;
      chunk.glIndexBuffer = null;
      chunk.vertices = null;
      chunk.indices = null;
    }
    resetCellMapState();
    cm._disposed = true;
  },
};
