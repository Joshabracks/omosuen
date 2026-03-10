import { ComponentData, ComponentMethods } from '../types';
import type { NexusT } from '../nexus/data';
import { Nexus } from '../nexus/methods';
import type { AudioPlayerT, ActiveSource } from './data';
import type { AudioTrackT } from '../audio-track/data';
import type { AudioEffectT } from '../audio-effect/data';
import type { TrackController } from './track-controller';

export interface AudioPlayerMethods extends ComponentMethods {
  type: 'audio-player';
  init: (component: ComponentData) => Promise<void>;
  dispose: (component: ComponentData) => void;

  play: (
    ap: AudioPlayerT,
    track: AudioTrackT,
    repeat?: boolean,
    effect?: AudioEffectT,
  ) => number;

  stop: (ap: AudioPlayerT, sourceId: number) => void;
  stopAll: (ap: AudioPlayerT) => void;

  setMasterVolume: (ap: AudioPlayerT, volume: number) => void;
  mute: (ap: AudioPlayerT) => void;
  unmute: (ap: AudioPlayerT) => void;

  _playController: (ap: AudioPlayerT, controller: TrackController) => number;
  _getActiveSource: (
    ap: AudioPlayerT,
    sourceId: number,
  ) => ActiveSource | undefined;
}

// ── Helpers ──

function clampVolume(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function getRootNexus(component: ComponentData): NexusT | null {
  let current: ComponentData | null = component;
  while (current && current.parent) {
    current = current.parent;
  }
  if (current && current.type === 'nexus') {
    return current as NexusT;
  }
  return null;
}

// ── Lifecycle ──

async function init(component: ComponentData): Promise<void> {
  const ap = component as AudioPlayerT;

  const audioContext = new window.AudioContext();
  const masterGain = audioContext.createGain();
  masterGain.connect(audioContext.destination);
  masterGain.gain.value = ap.muted ? 0 : ap.masterVolume;

  ap._audioContext = audioContext;
  ap._masterGain = masterGain;

  // Auto-discover all AudioTrack components in the scene (atlas-manager pattern)
  const rootNexus = getRootNexus(ap);
  if (rootNexus) {
    const allTracks = Nexus.getComponentsByType(
      rootNexus,
      'audio-track',
      true,
    ) as AudioTrackT[];

    // Load all tracks in parallel with dedup
    const loadPromises = allTracks.map((track) =>
      loadAudioBuffer(ap, track.filePath),
    );

    try {
      await Promise.all(loadPromises);
    } catch (error) {
      console.error('[audio-player] Some tracks failed to load:', error);
    }
  }
}

function dispose(component: ComponentData): void {
  const ap = component as AudioPlayerT;

  // Stop all active sources
  for (const [, active] of ap._activeSources) {
    try {
      active.source.stop();
    } catch {
      // Source may already be stopped
    }
  }
  ap._activeSources.clear();

  // Clear caches
  ap._bufferCache.clear();
  ap._bufferLoading.clear();

  // Close audio context
  if (ap._audioContext) {
    ap._audioContext.close().catch(() => {
      // Context may already be closed
    });
    ap._audioContext = null;
  }

  ap._masterGain = null;
  ap._disposed = true;
}

// ── Loading (internal) ──

async function loadAudioBuffer(
  ap: AudioPlayerT,
  filePath: string,
): Promise<AudioBuffer> {
  // Already decoded
  if (ap._bufferCache.has(filePath)) {
    return ap._bufferCache.get(filePath)!;
  }

  // Currently loading — return existing promise (dedup)
  if (ap._bufferLoading.has(filePath)) {
    return ap._bufferLoading.get(filePath)!;
  }

  if (!ap._audioContext) {
    throw new Error('[audio-player] Cannot load audio: not initialized');
  }

  const ctx = ap._audioContext;
  const loadPromise = (async () => {
    const response = await fetch(filePath);
    if (!response.ok) {
      throw new Error(`Failed to fetch audio file: ${filePath}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    ap._bufferCache.set(filePath, audioBuffer);
    ap._bufferLoading.delete(filePath);
    return audioBuffer;
  })();

  ap._bufferLoading.set(filePath, loadPromise);

  loadPromise.catch(() => {
    ap._bufferLoading.delete(filePath);
  });

  return loadPromise;
}

// ── Playback ──

interface PlayEffectData {
  pitchShift: number;
  speedShift: number;
  volume: number;
  pan: number;
  mix: number[];
  spatial: boolean;
  spatialX: number;
  spatialY: number;
  spatialZ: number;
  offset: number;
}

/**
 * Compute log-spaced EQ band center frequencies from 20 Hz to 20 kHz.
 */
function computeBandFrequencies(bandCount: number): number[] {
  const logMin = Math.log10(20);
  const logMax = Math.log10(20000);
  const freqs: number[] = [];
  for (let i = 0; i < bandCount; i++) {
    const logFreq = logMin + ((i + 0.5) / bandCount) * (logMax - logMin);
    freqs.push(Math.pow(10, logFreq));
  }
  return freqs;
}

function playInternal(
  ap: AudioPlayerT,
  filePath: string,
  repeat: boolean,
  effectData: PlayEffectData,
): number {
  if (!ap._audioContext || !ap._masterGain) {
    console.warn('[audio-player] Cannot play: not initialized');
    return -1;
  }

  const buffer = ap._bufferCache.get(filePath);
  if (!buffer) {
    console.warn(
      `[audio-player] Audio "${filePath}" not loaded. Ensure an AudioTrack component exists and AudioPlayer has initialized.`,
    );
    return -1;
  }

  const ctx = ap._audioContext;
  const source = ctx.createBufferSource();
  const gainNode = ctx.createGain();
  const panner = ctx.createStereoPanner();

  source.buffer = buffer;
  source.loop = repeat;

  // Apply effect: playbackRate = 2^(semitones/12) * speedShift
  const pitchRate = Math.pow(2, effectData.pitchShift / 12);
  source.playbackRate.value = pitchRate * effectData.speedShift;

  // Apply volume and pan
  gainNode.gain.value = clampVolume(effectData.volume);
  panner.pan.value = Math.max(-1, Math.min(1, effectData.pan));

  // Build EQ filter chain
  const filters: BiquadFilterNode[] = [];
  if (effectData.mix.length > 0) {
    const freqs = computeBandFrequencies(effectData.mix.length);
    for (let i = 0; i < effectData.mix.length; i++) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'peaking';
      filter.frequency.value = freqs[i];
      filter.Q.value = 1.0;
      filter.gain.value = effectData.mix[i] * 12; // -12 to +12 dB
      filters.push(filter);
    }
  }

  // Spatial panner (HRTF) when spatial mode is enabled
  let spatialPanner: PannerNode | null = null;
  if (effectData.spatial) {
    spatialPanner = ctx.createPanner();
    spatialPanner.panningModel = 'HRTF';
    spatialPanner.distanceModel = 'inverse';
    spatialPanner.positionX.value = effectData.spatialX;
    spatialPanner.positionY.value = effectData.spatialY;
    spatialPanner.positionZ.value = effectData.spatialZ;
  }

  // Chain: source → [filters] → gain → panner/spatialPanner → master
  let lastNode: AudioNode = source;

  for (const filter of filters) {
    lastNode.connect(filter);
    lastNode = filter;
  }

  lastNode.connect(gainNode);

  if (effectData.spatial && spatialPanner) {
    gainNode.connect(spatialPanner);
    spatialPanner.connect(ap._masterGain);
  } else {
    gainNode.connect(panner);
    panner.connect(ap._masterGain);
  }

  const sourceId = ap._nextSourceId++;
  const startTime = ctx.currentTime;
  ap._activeSources.set(sourceId, {
    source,
    gain: gainNode,
    panner,
    filters,
    spatialPanner,
    startTime,
    offset: effectData.offset,
  });

  // Auto-cleanup on end
  source.onended = () => {
    ap._activeSources.delete(sourceId);
  };

  source.start(0, effectData.offset);
  return sourceId;
}

function play(
  ap: AudioPlayerT,
  track: AudioTrackT,
  repeat: boolean = false,
  effect?: AudioEffectT,
): number {
  return playInternal(ap, track.filePath, repeat, {
    pitchShift: effect?.pitchShift ?? 0,
    speedShift: effect?.speedShift ?? 1.0,
    volume: effect?.volume ?? 1.0,
    pan: effect?.pan ?? 0,
    mix: effect?.mix ? [...effect.mix] : [],
    spatial: effect?.spatial ?? false,
    spatialX: effect?.spatialX ?? 0,
    spatialY: effect?.spatialY ?? 0,
    spatialZ: effect?.spatialZ ?? 0,
    offset: 0,
  });
}

function _playController(
  ap: AudioPlayerT,
  controller: TrackController,
): number {
  return playInternal(ap, controller.track.filePath, controller.repeat, {
    pitchShift: controller.pitchShift,
    speedShift: controller.speedShift,
    volume: controller.volume,
    pan: controller.pan,
    mix: [...controller.mix],
    spatial: controller.spatial,
    spatialX: controller.spatialX,
    spatialY: controller.spatialY,
    spatialZ: controller.spatialZ,
    offset: controller._pauseOffset,
  });
}

function _getActiveSource(
  ap: AudioPlayerT,
  sourceId: number,
): ActiveSource | undefined {
  return ap._activeSources.get(sourceId);
}

function stop(ap: AudioPlayerT, sourceId: number): void {
  const active = ap._activeSources.get(sourceId);
  if (active) {
    try {
      active.source.stop();
    } catch {
      // Source may already be stopped
    }
    ap._activeSources.delete(sourceId);
  }
}

function stopAll(ap: AudioPlayerT): void {
  for (const [id, active] of ap._activeSources) {
    try {
      active.source.stop();
    } catch {
      // Source may already be stopped
    }
    ap._activeSources.delete(id);
  }
}

// ── Volume ──

function setMasterVolume(ap: AudioPlayerT, volume: number): void {
  ap.masterVolume = clampVolume(volume);
  if (!ap.muted && ap._masterGain) {
    ap._masterGain.gain.value = ap.masterVolume;
  }
}

function mute(ap: AudioPlayerT): void {
  ap.muted = true;
  if (ap._masterGain) {
    ap._masterGain.gain.value = 0;
  }
}

function unmute(ap: AudioPlayerT): void {
  ap.muted = false;
  if (ap._masterGain) {
    ap._masterGain.gain.value = ap.masterVolume;
  }
}

export const AudioPlayer: AudioPlayerMethods = {
  type: 'audio-player',
  init,
  dispose,
  play,
  stop,
  stopAll,
  setMasterVolume,
  mute,
  unmute,
  _playController,
  _getActiveSource,
};
