import { ComponentData, ComponentOptions, ComponentSerializer, ComponentUnique, ComponentInstanceMethods } from '../types';
import type { AudioTrackMethods } from './methods';
export interface AudioTrackT extends ComponentData, ComponentInstanceMethods<AudioTrackMethods> {
    type: 'audio-track';
    unique: ComponentUnique.NAME;
    filePath: string;
}
export interface AudioTrackOptions extends ComponentOptions {
    filePath: string;
}
export declare function builder(options: AudioTrackOptions): AudioTrackT;
export declare const AudioTrackSerializer: ComponentSerializer;
export declare const PROPERTY_ALLOWLIST: string[];
//# sourceMappingURL=data.d.ts.map