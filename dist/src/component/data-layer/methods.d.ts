import { ComponentData, ComponentMethods } from '../types';
import { DataLayerT, DataLayerType } from './data';
export interface DataLayerMethods extends ComponentMethods {
    set: (d: DataLayerT, key: string, value: DataLayerType) => boolean;
    get: (d: DataLayerT, key: string) => DataLayerType | null;
    has: (d: DataLayerT, key: string) => boolean;
    delete: (d: DataLayerT, key: string) => boolean;
    setAll: (d: DataLayerT, data: Record<string, unknown>) => void;
    getAll: (d: DataLayerT, keys: string[]) => Record<string, DataLayerType>;
    dispose: (component: ComponentData) => void;
}
export declare const DataLayer: DataLayerMethods;
//# sourceMappingURL=methods.d.ts.map