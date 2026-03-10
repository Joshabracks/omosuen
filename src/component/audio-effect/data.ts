import {
  ComponentData,
  ComponentOptions,
  ComponentSerializer,
  ComponentUnique,
  ComponentInstanceMethods,
} from '../types';
import type { AudioEffectMethods } from './methods';

export interface AudioEffectT
  extends ComponentData,
    ComponentInstanceMethods<AudioEffectMethods> {
  type: 'audio-effect';
  unique: ComponentUnique.FALSE;

  /** Pitch shift in semitones (default 0). */
  pitchShift: number;

  /** Speed multiplier (default 1.0). */
  speedShift: number;

  /** Reverb amount 0-1 (default 0). */
  reverb: number;

  /**
   * Multi-band EQ mix levels.
   * Each element is -1 to 1, spectrum divided evenly by array length.
   * Empty array means no EQ processing. (default [])
   */
  mix: number[];

  /** Volume 0-1 (default 1.0). */
  volume: number;

  /** Stereo pan -1 (left) to 1 (right) (default 0). */
  pan: number;

  /** Whether to use spatial (PannerNode HRTF) instead of stereo panning. */
  spatial: boolean;

  /** Spatial X position (left-right, default 0). */
  spatialX: number;

  /** Spatial Y position (up-down, default 0). */
  spatialY: number;

  /** Spatial Z position (front-back, default 0). */
  spatialZ: number;
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
}

export function builder(options: AudioEffectOptions): AudioEffectT {
  const audioEffect = {
    type: 'audio-effect' as const,
    name: options.name,
    unique: ComponentUnique.FALSE,
    parent: null,
    overrideKey: options.overrideKey,
    _disposed: false,

    pitchShift: options.pitchShift ?? 0,
    speedShift: options.speedShift ?? 1.0,
    reverb: options.reverb ?? 0,
    mix: options.mix ? [...options.mix] : [],
    volume: options.volume ?? 1.0,
    pan: options.pan ?? 0,
    spatial: options.spatial ?? false,
    spatialX: options.spatialX ?? 0,
    spatialY: options.spatialY ?? 0,
    spatialZ: options.spatialZ ?? 0,
  };

  return audioEffect as unknown as AudioEffectT;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serialize(component: ComponentData): any {
  const ae = component as AudioEffectT;

  return {
    type: 'audio-effect',
    name: ae.name,
    overrideKey: ae.overrideKey,
    pitchShift: ae.pitchShift,
    speedShift: ae.speedShift,
    reverb: ae.reverb,
    mix: [...ae.mix],
    volume: ae.volume,
    pan: ae.pan,
    spatial: ae.spatial,
    spatialX: ae.spatialX,
    spatialY: ae.spatialY,
    spatialZ: ae.spatialZ,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deserialize(data: any): AudioEffectT {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const { type, name } = data;

  const errors: string[] = [];
  if (type !== 'audio-effect') {
    errors.push(`type ${type} does not match "audio-effect"`);
  }
  if (!name) {
    errors.push('audio-effect requires a name');
  }
  if (errors.length) {
    throw new Error(errors.join('\n'));
  }

  return builder({
    name: name as string,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    overrideKey: data.overrideKey,
    pitchShift: (data.pitchShift as number) ?? 0,
    speedShift: (data.speedShift as number) ?? 1.0,
    reverb: (data.reverb as number) ?? 0,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    mix: Array.isArray(data.mix) ? (data.mix as number[]) : [],
    volume: (data.volume as number) ?? 1.0,
    pan: (data.pan as number) ?? 0,
    spatial: !!data.spatial,
    spatialX: (data.spatialX as number) ?? 0,
    spatialY: (data.spatialY as number) ?? 0,
    spatialZ: (data.spatialZ as number) ?? 0,
  });
}

export const AudioEffectSerializer: ComponentSerializer = {
  serialize,
  deserialize,
};

export const PROPERTY_ALLOWLIST: string[] = [
  'pitchShift',
  'speedShift',
  'reverb',
  'mix',
  'volume',
  'pan',
  'spatial',
  'spatialX',
  'spatialY',
  'spatialZ',
];
