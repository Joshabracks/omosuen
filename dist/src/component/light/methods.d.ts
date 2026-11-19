import { ComponentData, ComponentMethods } from '../types';
import { Vector3D } from '../../math';
import { LightT, LightType } from './data';
export interface LightMethods extends ComponentMethods {
    type: 'light';
    init: (component: ComponentData) => Promise<void>;
    dispose: (component: ComponentData) => void;
    setColor: (light: LightT, color: Vector3D) => void;
    getColor: (light: LightT) => Vector3D;
    setBrightness: (light: LightT, brightness: number) => void;
    getBrightness: (light: LightT) => number;
    setRadius: (light: LightT, radius: number) => void;
    getRadius: (light: LightT) => number;
    setHardness: (light: LightT, hardness: number) => void;
    getHardness: (light: LightT) => number;
    setDirection: (light: LightT, direction: Vector3D) => void;
    getDirection: (light: LightT) => Vector3D;
    setLightType: (light: LightT, lightType: LightType) => void;
    getLightType: (light: LightT) => LightType;
}
export declare const Light: LightMethods;
//# sourceMappingURL=methods.d.ts.map