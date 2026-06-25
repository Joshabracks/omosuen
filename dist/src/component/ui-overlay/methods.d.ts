import { ComponentData, ComponentMethods } from '../types';
import { UIOverlayT } from './data';
export interface UIOverlayMethods extends ComponentMethods {
    hide?: (u: UIOverlayT) => void;
    show?: (u: UIOverlayT) => void;
    back: (u: UIOverlayT) => void;
    applyBindings: (u: UIOverlayT) => void;
    init: (component: ComponentData) => Promise<void>;
    update: (component: ComponentData, deltaTime: number) => void;
}
export declare const UIOverlay: UIOverlayMethods;
//# sourceMappingURL=methods.d.ts.map