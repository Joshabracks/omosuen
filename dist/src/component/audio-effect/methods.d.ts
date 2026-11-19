import { ComponentData, ComponentMethods } from '../types';
export interface AudioEffectMethods extends ComponentMethods {
    type: 'audio-effect';
    init: (component: ComponentData) => Promise<void>;
    dispose: (component: ComponentData) => void;
}
export declare const AudioEffect: AudioEffectMethods;
//# sourceMappingURL=methods.d.ts.map