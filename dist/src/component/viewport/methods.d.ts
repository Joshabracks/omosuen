import { ComponentData, ComponentMethods } from '../types';
import { ViewportT } from './data';
export interface ViewportMethods extends ComponentMethods {
    init: (component: ComponentData) => Promise<void>;
    update: (component: ComponentData, deltaTime: number) => void;
    resize: (v: ViewportT, width: number, height: number) => void;
    clear: (v: ViewportT) => void;
    setBackgroundColor: (v: ViewportT, r: number, g: number, b: number, a: number) => void;
    setOffset: (v: ViewportT, x: number, y: number) => void;
}
export declare const Viewport: ViewportMethods;
//# sourceMappingURL=methods.d.ts.map