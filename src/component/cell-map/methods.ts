import { ComponentMethods } from '../types';
import { Vector3D } from '../../math';
import { CellMapT } from './data';
import { CellData, Material, Mesh, packCell, unpackCell } from './types';

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
    const packed = component.packedData.get(coordinates);
    if (packed === undefined) {
      throw new Error(
        `Invalid coordinates: (${coordinates.x}, ${coordinates.y}, ${coordinates.z})`,
      );
    }
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
    component.packedData.set(coordinates, packed);
    component.needsGPUUpdate = true;
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

  getBounds: (
    component: CellMapT,
  ): { min: Vector3D; max: Vector3D } => {
    const min = new Vector3D(0, 0, 0);
    const max = new Vector3D(
      component.mapSize.x * component.cellSize.x,
      component.mapSize.y * component.cellSize.y,
      component.mapSize.z * component.cellSize.z,
    );
    return { min, max };
  },

  flush: (component: CellMapT): void => {
    component.packedData.flush();
    component.needsGPUUpdate = true;
  },
};
