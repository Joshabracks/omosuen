import { ComponentData, ComponentMethods } from '../types';

export interface AudioEffectMethods extends ComponentMethods {
  type: 'audio-effect';
  init: (component: ComponentData) => Promise<void>;
  dispose: (component: ComponentData) => void;
}

async function init(_component: ComponentData): Promise<void> {
  // AudioEffect is a pure data component — nothing to initialise.
}

function dispose(component: ComponentData): void {
  component._disposed = true;
}

export const AudioEffect: AudioEffectMethods = {
  type: 'audio-effect',
  init,
  dispose,
};
