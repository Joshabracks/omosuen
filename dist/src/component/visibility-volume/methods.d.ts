import { ComponentData, ComponentMethods } from '../types';
import { VisibilityVolumeT } from './data';
export interface VisibilityVolumeMethods extends ComponentMethods {
    type: 'visibility-volume';
    init: (component: ComponentData) => Promise<void>;
    dispose: (component: ComponentData) => void;
    setSize: (volume: VisibilityVolumeT, x: number, y: number, z: number) => void;
    getSize: (volume: VisibilityVolumeT) => {
        x: number;
        y: number;
        z: number;
    };
    setEnabled: (volume: VisibilityVolumeT, enabled: boolean) => void;
    getEnabled: (volume: VisibilityVolumeT) => boolean;
    setFadeWidth: (volume: VisibilityVolumeT, fadeWidth: number) => void;
    getFadeWidth: (volume: VisibilityVolumeT) => number;
    setMarksExplored: (volume: VisibilityVolumeT, marks: boolean) => void;
    setPriority: (volume: VisibilityVolumeT, priority: number) => void;
}
export declare const VisibilityVolume: VisibilityVolumeMethods;
//# sourceMappingURL=methods.d.ts.map