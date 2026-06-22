import { ComponentData, ComponentMethods } from '../types';
import type { AsepriteT } from './data';
export interface AsepriteMethods extends ComponentMethods {
    init: (component: ComponentData) => Promise<void>;
    reload: (component: AsepriteT) => Promise<void>;
    dispose: (component: ComponentData) => void;
}
export declare const Aseprite: AsepriteMethods;
//# sourceMappingURL=methods.d.ts.map