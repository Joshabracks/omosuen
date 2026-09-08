import { ComponentData, ComponentMethods } from '../types';
import { VisionSourceT } from './data';
export interface VisionSourceMethods extends ComponentMethods {
    type: 'vision-source';
    init: (component: ComponentData) => Promise<void>;
    dispose: (component: ComponentData) => void;
    setRadius: (visionSource: VisionSourceT, radius: number) => void;
    getRadius: (visionSource: VisionSourceT) => number;
    setFadeWidth: (visionSource: VisionSourceT, fadeWidth: number) => void;
    getFadeWidth: (visionSource: VisionSourceT) => number;
    setEnabled: (visionSource: VisionSourceT, enabled: boolean) => void;
    getEnabled: (visionSource: VisionSourceT) => boolean;
}
export declare const VisionSource: VisionSourceMethods;
//# sourceMappingURL=methods.d.ts.map