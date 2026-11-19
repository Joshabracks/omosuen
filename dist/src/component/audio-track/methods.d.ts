import { ComponentData, ComponentMethods } from '../types';
export interface AudioTrackMethods extends ComponentMethods {
    type: 'audio-track';
    init: (component: ComponentData) => Promise<void>;
    dispose: (component: ComponentData) => void;
}
export declare const AudioTrack: AudioTrackMethods;
//# sourceMappingURL=methods.d.ts.map