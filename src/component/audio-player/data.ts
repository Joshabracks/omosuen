import {
  ComponentData,
  ComponentOptions,
  ComponentSerializer,
  ComponentUnique,
  ComponentInstanceMethods,
} from '../types';
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

  // Stretched mode (WSOLA via AudioWorklet)
  workletNode: AudioWorkletNode | null;
  sourcePosition: number;
  isStretched: boolean;
}

export interface AudioPlayerT
  extends ComponentData, ComponentInstanceMethods<AudioPlayerMethods> {
  type: 'audio-player';
  unique: ComponentUnique.GLOBAL;

  /** Master volume 0-1. */
  masterVolume: number;

  /** Whether audio output is muted. */
  muted: boolean;

  // ── Runtime (non-serialised) ──

  _audioContext: AudioContext | null;
  _masterGain: GainNode | null;
  _reverbConvolver: ConvolverNode | null;

  /** Decoded audio buffers keyed by filePath. */
  _bufferCache: Map<string, AudioBuffer>;

  /** In-flight decode promises keyed by filePath (dedup). */
  _bufferLoading: Map<string, Promise<AudioBuffer>>;

  /** Currently playing sources keyed by auto-increment ID. */
  _activeSources: Map<number, ActiveSource>;

  /** Next source ID counter. */
  _nextSourceId: number;

  /** Blob URL for the stretcher AudioWorklet module (revoked on dispose). */
  _workletBlobUrl: string | null;
}

export interface AudioPlayerOptions extends ComponentOptions {
  masterVolume?: number;
  muted?: boolean;
}

export function builder(options: AudioPlayerOptions): AudioPlayerT {
  const audioPlayer = {
    type: 'audio-player' as const,
    name: options.name,
    unique: ComponentUnique.GLOBAL,
    parent: null,
    overrideKey: options.overrideKey,
    _disposed: false,

    masterVolume: options.masterVolume ?? 1.0,
    muted: options.muted ?? false,

    _audioContext: null,
    _masterGain: null,
    _reverbConvolver: null,
    _bufferCache: new Map<string, AudioBuffer>(),
    _bufferLoading: new Map<string, Promise<AudioBuffer>>(),
    _activeSources: new Map<number, ActiveSource>(),
    _nextSourceId: 0,
    _workletBlobUrl: null,
  };

  return audioPlayer as unknown as AudioPlayerT;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serialize(component: ComponentData): any {
  const ap = component as AudioPlayerT;

  return {
    type: 'audio-player',
    name: ap.name,
    overrideKey: ap.overrideKey,
    masterVolume: ap.masterVolume,
    muted: ap.muted,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deserialize(data: any): AudioPlayerT {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const { type, name } = data;

  const errors: string[] = [];
  if (type !== 'audio-player') {
    errors.push(`type ${type} does not match "audio-player"`);
  }
  if (!name) {
    errors.push('audio-player requires a name');
  }
  if (errors.length) {
    throw new Error(errors.join('\n'));
  }

  return builder({
    name: name as string,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    overrideKey: data.overrideKey,
    masterVolume: (data.masterVolume as number) ?? 1.0,
    muted: !!data.muted,
  });
}

export const AudioPlayerSerializer: ComponentSerializer = {
  serialize,
  deserialize,
};

export const PROPERTY_ALLOWLIST: string[] = [
  'masterVolume',
  'muted',
  '_audioContext',
  '_masterGain',
  '_activeSources',
  '_nextSourceId',
  '_bufferCache',
  '_bufferLoading',
  '_reverbConvolver',
  '_workletBlobUrl',
];
