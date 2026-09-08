import { ComponentData, ComponentMethods } from '../types';
import { TransformT } from './data';
import { Vector3D } from '../../math';
export interface TransformMethods extends ComponentMethods {
    init: (component: ComponentData) => Promise<void>;
    setPosition: (transform: TransformT, x: number, y: number, z: number) => void;
    translate: (transform: TransformT, dx: number, dy: number, dz: number) => void;
    getPosition: (transform: TransformT) => Vector3D;
    setRotation: (transform: TransformT, x: number, y: number, z: number) => void;
    rotate: (transform: TransformT, dx: number, dy: number, dz: number) => void;
    getRotation: (transform: TransformT) => Vector3D;
    setScale: (transform: TransformT, x: number, y: number, z: number) => void;
    scaleBy: (transform: TransformT, sx: number, sy: number, sz: number) => void;
    getScale: (transform: TransformT) => Vector3D;
    getWorldInto: (transform: TransformT, outPosition: Vector3D | null, outRotation: Vector3D | null, outScale: Vector3D | null) => void;
}
export declare const Transform: TransformMethods;
//# sourceMappingURL=methods.d.ts.map