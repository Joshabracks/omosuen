import { ComponentData, ComponentMethods } from '../types';
import type { AudioPlayerT, ActiveSource } from './data';
import type { AudioTrackT } from '../audio-track/data';
import type { AudioEffectT } from '../audio-effect/data';
import type { TrackController } from './track-controller';
export interface AudioPlayerMethods extends ComponentMethods {
    type: 'audio-player';
    init: (component: ComponentData) => Promise<void>;
    dispose: (component: ComponentData) => void;
    play: (ap: AudioPlayerT, track: AudioTrackT, repeat?: boolean, effect?: AudioEffectT) => number;
    stop: (ap: AudioPlayerT, sourceId: number) => void;
    stopAll: (ap: AudioPlayerT) => void;
    setMasterVolume: (ap: AudioPlayerT, volume: number) => void;
    mute: (ap: AudioPlayerT) => void;
    unmute: (ap: AudioPlayerT) => void;
    _playController: (ap: AudioPlayerT, controller: TrackController) => number;
    _getActiveSource: (ap: AudioPlayerT, sourceId: number) => ActiveSource | undefined;
}
export declare const AudioPlayer: AudioPlayerMethods;
//# sourceMappingURL=methods.d.ts.map