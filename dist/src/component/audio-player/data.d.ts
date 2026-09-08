import { ComponentData, ComponentOptions, ComponentSerializer, ComponentUnique, ComponentInstanceMethods } from '../types';
import type { AudioPlayerMethods } from './methods';
export interface ActiveSource {
    source: AudioBufferSourceNode | null;
    gain: GainNode;
    panner: StereoPannerNode;
    filters: BiquadFilterNode[];
    spatialPanner: PannerNode | null;
    reverbSend: GainNode;
    startTime: number;
    offset: number;
    workletNode: AudioWorkletNode | null;
    sourcePosition: number;
    isStretched: boolean;
}
export interface AudioPlayerT extends ComponentData, ComponentInstanceMethods<AudioPlayerMethods> {
    type: 'audio-player';
    unique: ComponentUnique.GLOBAL;
    masterVolume: number;
    muted: boolean;
    _audioContext: AudioContext | null;
    _masterGain: GainNode | null;
    _reverbConvolver: ConvolverNode | null;
    _bufferCache: Map<string, AudioBuffer>;
    _bufferLoading: Map<string, Promise<AudioBuffer>>;
    _activeSources: Map<number, ActiveSource>;
    _nextSourceId: number;
    _workletBlobUrl: string | null;
}
export interface AudioPlayerOptions extends ComponentOptions {
    masterVolume?: number;
    muted?: boolean;
}
export declare function builder(options: AudioPlayerOptions): AudioPlayerT;
export declare const AudioPlayerSerializer: ComponentSerializer;
export declare const PROPERTY_ALLOWLIST: string[];
//# sourceMappingURL=data.d.ts.map