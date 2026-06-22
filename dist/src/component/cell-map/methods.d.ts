import { ComponentMethods } from '../types';
import { Vector3D } from '../../math';
import { CellMapT } from './data';
import { CellData, Material, Mesh } from './types';
export interface CellMapMethods extends ComponentMethods {
    type: 'cell-map';
    getCellData: (component: CellMapT, coordinates: Vector3D) => CellData;
    setCellData: (component: CellMapT, coordinates: Vector3D, data: CellData) => void;
    setMaterial: (component: CellMapT, coordinates: Vector3D, materialIndex: number) => void;
    setShape: (component: CellMapT, coordinates: Vector3D, shapeIndex: number) => void;
    setEmission: (component: CellMapT, coordinates: Vector3D, intensity: number) => void;
    setVisible: (component: CellMapT, coordinates: Vector3D, visible: boolean) => void;
    getMaterial: (component: CellMapT, index: number) => Material | undefined;
    getMesh: (component: CellMapT, index: number) => Mesh | undefined;
    addMaterial: (component: CellMapT, material: Material) => number;
    addMesh: (component: CellMapT, mesh: Mesh) => number;
    markGPUClean: (component: CellMapT) => void;
    getBounds: (component: CellMapT) => {
        min: Vector3D;
        max: Vector3D;
    };
    flush: (component: CellMapT) => void;
}
export declare const CellMap: CellMapMethods;
//# sourceMappingURL=methods.d.ts.map