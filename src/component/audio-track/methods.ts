import { ComponentData, ComponentMethods } from '../types';

export interface AudioTrackMethods extends ComponentMethods {
  type: 'audio-track';
  init: (component: ComponentData) => Promise<void>;
  dispose: (component: ComponentData) => void;
}

async function init(_component: ComponentData): Promise<void> {
  // AudioPlayer discovers and loads tracks — nothing to do here.
}

function dispose(component: ComponentData): void {
  component._disposed = true;
}

export const AudioTrack: AudioTrackMethods = {
  type: 'audio-track',
  init,
  dispose,
};
