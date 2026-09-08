import { ComponentData, ComponentMethods } from '../types';
import { DataLayerT, DataLayerType, DataLayerScalar } from './data';
export interface DataLayerMethods extends ComponentMethods {
    set: (d: DataLayerT, key: string, value: DataLayerType) => boolean;
    get: (d: DataLayerT, key: string) => DataLayerType | null;
    has: (d: DataLayerT, key: string) => boolean;
    delete: (d: DataLayerT, key: string) => boolean;
    setAll: (d: DataLayerT, data: Record<string, unknown>) => void;
    getAll: (d: DataLayerT, keys: string[]) => Record<string, DataLayerType>;
    push: (d: DataLayerT, key: string, value: DataLayerScalar) => boolean;
    setAt: (d: DataLayerT, key: string, index: number, value: DataLayerScalar) => boolean;
    getAt: (d: DataLayerT, key: string, index: number) => DataLayerScalar | null;
    removeAt: (d: DataLayerT, key: string, index: number) => boolean;
    arrayLength: (d: DataLayerT, key: string) => number | null;
    dispose: (component: ComponentData) => void;
}
export declare const DataLayer: DataLayerMethods;
//# sourceMappingURL=methods.d.ts.map