import {
  ComponentData,
  ComponentOptions,
  ComponentSerializer,
  ComponentUnique,
  ComponentInstanceMethods,
} from '../types';
import type { AudioTrackMethods } from './methods';

export interface AudioTrackT
  extends ComponentData,
    ComponentInstanceMethods<AudioTrackMethods> {
  type: 'audio-track';
  unique: ComponentUnique.NAME;

  /** Path to the audio file (MP3, WAV, OGG, etc.). */
  filePath: string;
}

export interface AudioTrackOptions extends ComponentOptions {
  filePath: string;
}

export function builder(options: AudioTrackOptions): AudioTrackT {
  const audioTrack = {
    type: 'audio-track' as const,
    name: options.name,
    unique: ComponentUnique.NAME,
    parent: null,
    overrideKey: options.overrideKey,
    _disposed: false,

    filePath: options.filePath,
  };

  return audioTrack as unknown as AudioTrackT;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serialize(component: ComponentData): any {
  const at = component as AudioTrackT;

  return {
    type: 'audio-track',
    name: at.name,
    overrideKey: at.overrideKey,
    filePath: at.filePath,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deserialize(data: any): AudioTrackT {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const { type, name } = data;

  const errors: string[] = [];
  if (type !== 'audio-track') {
    errors.push(`type ${type} does not match "audio-track"`);
  }
  if (!name) {
    errors.push('audio-track requires a name');
  }
  if (errors.length) {
    throw new Error(errors.join('\n'));
  }

  return builder({
    name: name as string,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    overrideKey: data.overrideKey,
    filePath: data.filePath as string,
  });
}

export const AudioTrackSerializer: ComponentSerializer = {
  serialize,
  deserialize,
};

export const PROPERTY_ALLOWLIST: string[] = ['filePath'];
