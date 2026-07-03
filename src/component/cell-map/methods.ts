import { ComponentMethods } from '../types';
import { Vector3D } from '../../math';
import { CellMapT, resetCellMapState } from './data';
import { CellData, Material, Mesh, packCell, unpackCell } from './types';
import { markChunksDirty } from './mesh-builder';
import {
  cellStoreGet,
  cellStoreSet,
  cellStoreFlush,
} from '../camera/render/wasm';

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
   * Flush dirty changes to compressed storage
   */
  flush: (component: CellMapT) => void;
}

export const CellMap: CellMapMethods = {
  type: 'cell-map',

  getCellData: (component: CellMapT, coordinates: Vector3D): CellData => {
    const { x, y, z } = coordinates;
    const { mapSize } = component;
    if (
      x < 0 ||
      x >= mapSize.x ||
      y < 0 ||
      y >= mapSize.y ||
      z < 0 ||
      z >= mapSize.z
    ) {
      throw new Error(`Invalid coordinates: (${x}, ${y}, ${z})`);
    }
    return unpackCell(cellStoreGet(x, y, z));
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
    cellStoreSet(coordinates.x, coordinates.y, coordinates.z, packed);
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
    const min = new Vector3D(0, 0, 0);
    const max = new Vector3D(
      component.mapSize.x * component.cellSize.x,
      component.mapSize.y * component.cellSize.y,
      component.mapSize.z * component.cellSize.z,
    );
    return { min, max };
  },

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
