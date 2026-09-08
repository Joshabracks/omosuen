import { ComponentData, ComponentOptions, ComponentSerializer, ComponentUnique, ComponentInstanceMethods } from '../types';
import type { AudioEffectMethods } from './methods';
export interface AudioEffectT extends ComponentData, ComponentInstanceMethods<AudioEffectMethods> {
    type: 'audio-effect';
    unique: ComponentUnique.FALSE;
    pitchShift: number;
    speedShift: number;
    reverb: number;
    mix: number[];
    volume: number;
    pan: number;
    spatial: boolean;
    spatialX: number;
    spatialY: number;
    spatialZ: number;
    transitionBuffer: number;
}
export interface AudioEffectOptions extends ComponentOptions {
    pitchShift?: number;
    speedShift?: number;
    reverb?: number;
    mix?: number[];
    volume?: number;
    pan?: number;
    spatial?: boolean;
    spatialX?: number;
    spatialY?: number;
    spatialZ?: number;
    transitionBuffer?: number;
}
export declare function builder(options: AudioEffectOptions): AudioEffectT;
export declare const AudioEffectSerializer: ComponentSerializer;
export declare const PROPERTY_ALLOWLIST: string[];
//# sourceMappingURL=data.d.ts.map