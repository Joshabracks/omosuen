import {
  ComponentData,
  ComponentOptions,
  ComponentSerializer,
  ComponentUnique,
  ComponentInstanceMethods,
  DeserializationError,
  DeserializeResult,
} from '../types';
import type { AudioTrackMethods } from './methods';

export interface AudioTrackT
  extends ComponentData, ComponentInstanceMethods<AudioTrackMethods> {
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
function deserialize(data: any): DeserializeResult<AudioTrackT> {
  const errors: DeserializationError[] = [];

  if (!data || typeof data !== 'object') {
    return {
      component: null,
      errors: [
        {
          code: 'INVALID_DATA',
          message: 'audio-track deserialize received non-object data',
        },
      ],
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const { type, name } = data;

  if (type !== 'audio-track') {
    errors.push({
      code: 'TYPE_MISMATCH',
      message: `type ${type} does not match "audio-track"`,
    });
  }
  if (!name) {
    errors.push({
      code: 'MISSING_NAME',
      message: 'audio-track requires a name',
    });
  }
  if (errors.length > 0) {
    return { component: null, errors };
  }

  return {
    component: builder({
      name: name as string,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      overrideKey: data.overrideKey,
      filePath: data.filePath as string,
    }),
    errors,
  };
}

export const AudioTrackSerializer: ComponentSerializer = {
  serialize,
  deserialize,
};

export const PROPERTY_ALLOWLIST: string[] = ['filePath'];
