import {
  ComponentData,
  ComponentOptions,
  ComponentSerializer,
  ComponentInstanceMethods,
} from '../types';
import { ComponentUnique } from '../constants';
import type { AudioManagerMethods } from './methods';

export interface AudioManagerT
  extends ComponentData, ComponentInstanceMethods<AudioManagerMethods> {
  type: 'audio-manager';
  unique: ComponentUnique.GLOBAL;

  // Web Audio (non-serializable, created in init)
  _audioContext: AudioContext | null;
  _buffers: Map<string, AudioBuffer>;
  _masterGain: GainNode | null;
  _musicGain: GainNode | null;
  _sfxGain: GainNode | null;

  // Music state
  musicTracks: string[];
  currentTrackIndex: number;
  _currentMusicSource: AudioBufferSourceNode | null;
  _currentMusicGain: GainNode | null;
  _musicPlaying: boolean;
  _musicPausedAt: number;
  _musicStartedAt: number;

  // Volume state
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  muted: boolean;
}

export interface AudioManagerOptions extends ComponentOptions {
  masterVolume?: number;
  musicVolume?: number;
  sfxVolume?: number;
}

export function builder(options: AudioManagerOptions): AudioManagerT {
  const audioManager = {
    type: 'audio-manager' as const,
    name: options.name,
    unique: ComponentUnique.GLOBAL,
    parent: null,
    overrideKey: options.overrideKey,
    _disposed: false,

    // Web Audio — created in init()
    _audioContext: null,
    _buffers: new Map<string, AudioBuffer>(),
    _masterGain: null,
    _musicGain: null,
    _sfxGain: null,

    // Music state
    musicTracks: [] as string[],
    currentTrackIndex: 0,
    _currentMusicSource: null,
    _currentMusicGain: null,
    _musicPlaying: false,
    _musicPausedAt: 0,
    _musicStartedAt: 0,

    // Volume state
    masterVolume: options.masterVolume ?? 1.0,
    musicVolume: options.musicVolume ?? 1.0,
    sfxVolume: options.sfxVolume ?? 1.0,
    muted: false,
  };

  return audioManager as unknown as AudioManagerT;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serialize(component: ComponentData): any {
  const am = component as AudioManagerT;

  return {
    type: 'audio-manager',
    name: am.name,
    overrideKey: am.overrideKey,
    masterVolume: am.masterVolume,
    musicVolume: am.musicVolume,
    sfxVolume: am.sfxVolume,
    muted: am.muted,
    musicTracks: [...am.musicTracks],
    currentTrackIndex: am.currentTrackIndex,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deserialize(data: any): AudioManagerT {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const { type, name } = data;

  const errors: string[] = [];
  if (type !== 'audio-manager') {
    errors.push(`type ${type} does not match "audio-manager"`);
  }
  if (!name) {
    errors.push('audio-manager requires a name');
  }
  if (errors.length) {
    throw new Error(errors.join('\n'));
  }

  const am = builder({
    name: name as string,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    overrideKey: data.overrideKey,
    masterVolume: (data.masterVolume as number) ?? 1.0,
    musicVolume: (data.musicVolume as number) ?? 1.0,
    sfxVolume: (data.sfxVolume as number) ?? 1.0,
  });

  // Restore music state
  if (Array.isArray(data.musicTracks)) {
    am.musicTracks = data.musicTracks as string[];
    am.currentTrackIndex = (data.currentTrackIndex as number) ?? 0;
  }

  if (data.muted) {
    am.muted = true;
  }

  return am;
}

export const AudioManagerSerializer: ComponentSerializer = {
  serialize,
  deserialize,
};

export const PROPERTY_ALLOWLIST: string[] = [
  'musicTracks',
  'currentTrackIndex',
  'masterVolume',
  'musicVolume',
  'sfxVolume',
  'muted',
  '_buffers',
];
