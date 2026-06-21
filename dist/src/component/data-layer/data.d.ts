import { ComponentData, ComponentOptions, ComponentSerializer, ComponentUnique, ComponentInstanceMethods } from '../types';
import { Vector2D, Vector3D, Vector4D } from '../../math';
import type { DataLayerMethods } from './methods';
export type DataLayerType = string | number | boolean | Vector2D | Vector3D | Vector4D;
export interface DataLayerT extends ComponentData, ComponentInstanceMethods<DataLayerMethods> {
    type: 'data-layer';
    unique: ComponentUnique.FALSE;
    storage: Map<string, DataLayerType>;
    typeMap: Map<string, string>;
    $data: any;
}
export declare function builder(options: ComponentOptions): DataLayerT;
export declare const DataLayerSerializer: ComponentSerializer;
export declare const PROPERTY_ALLOWLIST: string[];
//# sourceMappingURL=data.d.ts.map