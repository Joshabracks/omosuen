import { ComponentMethods } from '../types';
import { Vector3D } from '../../math';
import { CellMapT } from './data';
import { CellData, Material, Mesh, ChunkMesh } from './types';
import type { RaycastHit, SurfaceHit, RaycastOptions } from './types';
export interface CellMapMethods extends ComponentMethods {
    type: 'cell-map';
    getCellData: (component: CellMapT, coordinates: Vector3D) => CellData;
    setCellData: (component: CellMapT, coordinates: Vector3D, data: CellData) => void;
    setMaterial: (component: CellMapT, coordinates: Vector3D, materialIndex: number) => void;
    setShape: (component: CellMapT, coordinates: Vector3D, shapeIndex: number) => void;
    setEmission: (component: CellMapT, coordinates: Vector3D, intensity: number) => void;
    setEmissionColor: (component: CellMapT, coordinates: Vector3D, color: Vector3D) => void;
    getEmissionColor: (component: CellMapT, coordinates: Vector3D) => Vector3D;
    setVisible: (component: CellMapT, coordinates: Vector3D, visible: boolean) => void;
    getMaterial: (component: CellMapT, index: number) => Material | undefined;
    getMesh: (component: CellMapT, index: number) => Mesh | undefined;
    addMaterial: (component: CellMapT, material: Material) => number;
    addMesh: (component: CellMapT, mesh: Mesh) => number;
    markGPUClean: (component: CellMapT) => void;
    cellToWorldCoordinates: (component: CellMapT, coordinates: Vector3D) => Vector3D;
    getBounds: (component: CellMapT) => {
        min: Vector3D;
        max: Vector3D;
    };
    setFocus: (component: CellMapT, worldX: number, worldY: number, worldZ: number) => void;
    setWindowRadius: (component: CellMapT, radius: {
        x: number;
        y: number;
        z: number;
    }) => boolean;
    advanceWindowGeneration: (component: CellMapT) => void;
    takePendingBufferCleanup: (component: CellMapT) => ChunkMesh[];
    raycast: (component: CellMapT, origin: Vector3D, dir: Vector3D, opts?: RaycastOptions) => RaycastHit | null;
    getSurfacePoint: (component: CellMapT, coordinates: Vector3D, opts?: RaycastOptions) => Vector3D;
    sampleSurfaceHeight: (component: CellMapT, worldX: number, worldZ: number, opts?: RaycastOptions) => SurfaceHit | null;
    flush: (component: CellMapT) => void;
}
export declare const CellMap: CellMapMethods;
//# sourceMappingURL=methods.d.ts.map