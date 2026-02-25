import {
  ComponentData,
  ComponentOptions,
  ComponentSerializer,
  ComponentInstanceMethods,
} from '../types';
import { ComponentUnique } from '../constants';
import type { AudioManagerT } from '../audio-manager/data';
import type { AudioControllerMethods } from './methods';

export interface AudioControllerT
  extends ComponentData,
    ComponentInstanceMethods<AudioControllerMethods> {
  type: 'audio-controller';
  unique: ComponentUnique.FALSE;

  /** Per-controller volume (0-1). */
  volume: number;

  /** Maximum concurrent sound effects. Oldest evicted when exceeded. */
  maxSFX: number;

  /** Reference to the global audio-manager (found in init). */
  _manager: AudioManagerT | null;

  /** Per-controller gain node → manager._sfxGain. */
  _gainNode: GainNode | null;

  /** Currently playing sound sources. */
  _activeSources: AudioBufferSourceNode[];
}

export interface AudioControllerOptions extends ComponentOptions {
  volume?: number;
  maxSFX?: number;
}

export function builder(options: AudioControllerOptions): AudioControllerT {
  const audioController = {
    type: 'audio-controller' as const,
    name: options.name,
    unique: ComponentUnique.FALSE,
    parent: null,
    overrideKey: options.overrideKey,
    _disposed: false,

    volume: options.volume ?? 1.0,
    maxSFX: options.maxSFX ?? 16,

    _manager: null,
    _gainNode: null,
    _activeSources: [] as AudioBufferSourceNode[],
  };

  return audioController as unknown as AudioControllerT;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serialize(component: ComponentData): any {
  const ac = component as AudioControllerT;

  return {
    type: 'audio-controller',
    name: ac.name,
    overrideKey: ac.overrideKey,
    volume: ac.volume,
    maxSFX: ac.maxSFX,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deserialize(data: any): AudioControllerT {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const { type, name } = data;

  const errors: string[] = [];
  if (type !== 'audio-controller') {
    errors.push(`type ${type} does not match "audio-controller"`);
  }
  if (!name) {
    errors.push('audio-controller requires a name');
  }
  if (errors.length) {
    throw new Error(errors.join('\n'));
  }

  return builder({
    name: name as string,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    overrideKey: data.overrideKey,
    volume: (data.volume as number) ?? 1.0,
    maxSFX: (data.maxSFX as number) ?? 16,
  });
}

export const AudioControllerSerializer: ComponentSerializer = {
  serialize,
  deserialize,
};

export const PROPERTY_ALLOWLIST: string[] = ['volume', 'maxSFX'];
