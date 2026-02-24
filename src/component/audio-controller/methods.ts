import { ComponentData, ComponentMethods, castTo } from '../types';
import { NexusT } from '../nexus';
import { AudioManagerT } from '../audio-manager/data';
import { AudioControllerT } from './data';

export interface SFXOptions {
  /** Volume override (0-1, default 1.0). */
  volume?: number;
  /** Playback rate (default 1.0). */
  pitch?: number;
  /** Random volume variation range (±). */
  randomVolume?: number;
  /** Random pitch variation range (±). */
  randomPitch?: number;
  /** Start offset in seconds (trim beginning). */
  startTime?: number;
  /** End time in seconds (trim end). */
  endTime?: number;
}

export interface AudioControllerMethods extends ComponentMethods {
  init: (component: ComponentData) => Promise<void>;
  dispose: (component: ComponentData) => void;
  playSFX: (
    ac: AudioControllerT,
    audioId: string,
    options?: SFXOptions,
  ) => void;
  stopAll: (ac: AudioControllerT) => void;
  setVolume: (ac: AudioControllerT, volume: number) => void;
}

// ── Lifecycle ──

async function init(component: ComponentData): Promise<void> {
  const ac = component as AudioControllerT;

  // Walk up to scene root and find the global audio-manager
  if (!ac.parent || ac.parent.type !== 'nexus') {
    console.warn(
      '[audio-controller] Cannot init: no parent nexus',
    );
    return;
  }

  let root: ComponentData = ac.parent;
  while (root.parent && root.parent.type === 'nexus') {
    root = root.parent;
  }

  const sceneRoot = castTo<NexusT>(root);
  const manager = sceneRoot.getComponentByType(
    'audio-manager',
    true,
  ) as AudioManagerT | null;

  if (!manager || !manager._audioContext || !manager._sfxGain) {
    console.warn(
      '[audio-controller] No initialized audio-manager found in scene',
    );
    return;
  }

  ac._manager = manager;

  // Create per-controller gain node → manager's SFX gain
  const gainNode = manager._audioContext.createGain();
  gainNode.gain.value = ac.volume;
  gainNode.connect(manager._sfxGain);
  ac._gainNode = gainNode;
}

function dispose(component: ComponentData): void {
  const ac = component as AudioControllerT;

  // Stop all active sources
  for (const source of ac._activeSources) {
    try {
      source.stop();
    } catch {
      // Source may already be stopped
    }
  }
  ac._activeSources.length = 0;

  // Disconnect gain node
  if (ac._gainNode) {
    ac._gainNode.disconnect();
    ac._gainNode = null;
  }

  ac._manager = null;
  ac._disposed = true;
}

// ── SFX ──

function playSFX(
  ac: AudioControllerT,
  audioId: string,
  options?: SFXOptions,
): void {
  if (!ac._manager || !ac._manager._audioContext || !ac._gainNode) {
    console.warn(
      '[audio-controller] Cannot play SFX: not initialized',
    );
    return;
  }

  const buffer = ac._manager._buffers.get(audioId);
  if (!buffer) {
    console.warn(
      `[audio-controller] SFX "${audioId}" not loaded. Call audioManager.loadAudio() first.`,
    );
    return;
  }

  // Evict oldest if at max capacity
  while (ac._activeSources.length >= ac.maxSFX) {
    const oldest = ac._activeSources.shift();
    if (oldest) {
      try {
        oldest.stop();
      } catch {
        // Source may already be stopped
      }
    }
  }

  const context = ac._manager._audioContext;
  const source = context.createBufferSource();
  const gainNode = context.createGain();

  source.buffer = buffer;
  source.connect(gainNode);
  gainNode.connect(ac._gainNode);

  // Apply volume
  let volume = options?.volume ?? 1.0;
  if (options?.randomVolume) {
    const variation = (Math.random() - 0.5) * 2 * options.randomVolume;
    volume = volume * (1.0 + variation);
  }
  gainNode.gain.value = Math.max(0, Math.min(1, volume));

  // Apply pitch
  let pitch = options?.pitch ?? 1.0;
  if (options?.randomPitch) {
    const variation = (Math.random() - 0.5) * 2 * options.randomPitch;
    pitch = pitch * (1.0 + variation);
  }
  source.playbackRate.value = Math.max(0.1, Math.min(4.0, pitch));

  // Auto-cleanup on end
  source.onended = () => {
    const index = ac._activeSources.indexOf(source);
    if (index > -1) {
      ac._activeSources.splice(index, 1);
    }
  };

  ac._activeSources.push(source);

  // Start with optional trim
  const startTime = options?.startTime ?? 0;
  const endTime = options?.endTime ?? buffer.duration;
  const duration = Math.max(0, endTime - startTime);

  if (duration > 0) {
    source.start(0, startTime, duration);
  } else {
    source.start(0);
  }
}

function stopAll(ac: AudioControllerT): void {
  for (const source of ac._activeSources) {
    try {
      source.stop();
    } catch {
      // Source may already be stopped
    }
  }
  ac._activeSources.length = 0;
}

function setVolume(ac: AudioControllerT, volume: number): void {
  ac.volume = Math.max(0, Math.min(1, volume));
  if (ac._gainNode) {
    ac._gainNode.gain.value = ac.volume;
  }
}

export const AudioController: AudioControllerMethods = {
  type: 'audio-controller',
  init,
  dispose,
  playSFX,
  stopAll,
  setVolume,
};
