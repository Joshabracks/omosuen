import { ComponentData, ComponentMethods } from '../types';
import { NexusT } from './data';
export interface NexusMethods extends ComponentMethods {
    addComponent: (n: NexusT, component: ComponentData) => void;
    addComponents: (n: NexusT, components: ComponentData[] | {
        [index: string]: ComponentData;
    }) => void;
    getComponentById: (n: NexusT, id: number, recursive?: boolean) => ComponentData | null;
    getComponentByType: (n: NexusT, type: string, recursive?: boolean) => ComponentData | null;
    getComponentsByType: (n: NexusT, type: string, recursive?: boolean) => ComponentData[];
    getComponentByName: (n: NexusT, name: string, recursive?: boolean) => ComponentData | null;
    getComponentsByName: (n: NexusT, name: string, recursive?: boolean) => ComponentData[];
    getComponentByTypeAndName: (n: NexusT, type: string, name: string, recursive?: boolean) => ComponentData | null;
    getComponentsByTypeAndName: (n: NexusT, type: string, name: string, recursive?: boolean) => ComponentData[];
    dispose: (component: ComponentData) => void;
}
export declare const Nexus: NexusMethods;
//# sourceMappingURL=methods.d.ts.map