import { ComponentData, ComponentMethods } from '../types';
import type { NexusT } from '../nexus/data';
import { Nexus } from '../nexus/methods';
import type { AudioPlayerT, ActiveSource } from './data';
import type { AudioTrackT } from '../audio-track/data';
import type { AudioEffectT } from '../audio-effect/data';
import type { TrackController } from './track-controller';

// Fully-processed AudioWorklet shell source (worklet shell + inlined audio wasm
// base64), injected by webpack DefinePlugin from audioWorklet.script.js.
// eslint-disable-next-line @typescript-eslint/naming-convention
declare const __AUDIO_WORKLET_SCRIPT__: string;

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

  // Create shared reverb convolver with synthetic impulse response
  const reverbConvolver = audioContext.createConvolver();
  const irDuration = 2.0;
  const irLength = Math.floor(audioContext.sampleRate * irDuration);
  const irBuffer = audioContext.createBuffer(
    2,
    irLength,
    audioContext.sampleRate,
  );
  for (let ch = 0; ch < 2; ch++) {
    const data = irBuffer.getChannelData(ch);
    for (let i = 0; i < irLength; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLength, 3);
    }
  }
  reverbConvolver.buffer = irBuffer;
  reverbConvolver.connect(masterGain);
  ap._reverbConvolver = reverbConvolver;

  // Register AudioWorklet for stretched playback (WSOLA pitch/speed separation)
  const workletSource = __AUDIO_WORKLET_SCRIPT__;
  const blob = new Blob([workletSource], { type: 'application/javascript' });
  ap._workletBlobUrl = URL.createObjectURL(blob);
  await audioContext.audioWorklet.addModule(ap._workletBlobUrl);

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
    stopActive(active);
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
  ap._reverbConvolver = null;

  if (ap._workletBlobUrl) {
    URL.revokeObjectURL(ap._workletBlobUrl);
    ap._workletBlobUrl = null;
  }

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
  reverb: number;
  transitionBuffer: number;
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

  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }

  const source = ctx.createBufferSource();
  const gainNode = ctx.createGain();
  const panner = ctx.createStereoPanner();

  source.buffer = buffer;
  source.loop = repeat;

  // Speed via playbackRate, pitch via detune (cents) — separate controls
  source.playbackRate.value = effectData.speedShift;
  source.detune.value = effectData.pitchShift * 100;

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

  // Reverb send gain (wet path)
  const reverbSend = ctx.createGain();
  reverbSend.gain.value = Math.max(0, Math.min(1, effectData.reverb));

  // Chain: source → [filters] → gain → panner/spatialPanner → master (dry)
  //                                      ↓
  //                                 reverbSend → convolver → master (wet)
  let lastNode: AudioNode = source;

  for (const filter of filters) {
    lastNode.connect(filter);
    lastNode = filter;
  }

  lastNode.connect(gainNode);

  let pannerOut: AudioNode;
  if (effectData.spatial && spatialPanner) {
    gainNode.connect(spatialPanner);
    spatialPanner.connect(ap._masterGain);
    pannerOut = spatialPanner;
  } else {
    gainNode.connect(panner);
    panner.connect(ap._masterGain);
    pannerOut = panner;
  }

  // Connect reverb wet path
  if (ap._reverbConvolver) {
    pannerOut.connect(reverbSend);
    reverbSend.connect(ap._reverbConvolver);
  }

  const sourceId = ap._nextSourceId++;
  const startTime = ctx.currentTime;
  ap._activeSources.set(sourceId, {
    source,
    gain: gainNode,
    panner,
    filters,
    spatialPanner,
    reverbSend,
    startTime,
    offset: effectData.offset,
    workletNode: null,
    sourcePosition: 0,
    isStretched: false,
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
    reverb: effect?.reverb ?? 0,
    transitionBuffer: effect?.transitionBuffer ?? 0,
    offset: 0,
  });
}

// ── Stretched Playback (WSOLA via AudioWorklet) ──

function playStretched(
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

  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }

  const sourceId = ap._nextSourceId++;

  // Copy channel data for transfer to worklet
  const channelL = new Float32Array(buffer.getChannelData(0));
  const channelR = new Float32Array(
    buffer.numberOfChannels > 1
      ? buffer.getChannelData(1)
      : buffer.getChannelData(0),
  );

  // Create AudioWorkletNode
  const workletNode = new AudioWorkletNode(ctx, 'stretcher-processor', {
    outputChannelCount: [2],
    numberOfInputs: 0,
    numberOfOutputs: 1,
  });

  // Send audio data and initial parameters (transfer buffers for zero-copy)
  const sourcePos = Math.floor(effectData.offset * ctx.sampleRate);
  workletNode.port.postMessage(
    {
      type: 'init',
      channelL,
      channelR,
      sourcePos,
      pitchShift: effectData.pitchShift,
      tempo: effectData.speedShift,
      repeat,
      transitionBuffer: effectData.transitionBuffer,
    },
    [channelL.buffer, channelR.buffer],
  );

  // Detect worklet crashes and clean up leaked sources
  workletNode.addEventListener('processorerror', () => {
    console.error(
      '[audio-player] Worklet processor error for source',
      sourceId,
    );
    ap._activeSources.delete(sourceId);
    workletNode.disconnect();
  });

  // Listen for position updates and end detection
  workletNode.port.onmessage = (e: MessageEvent) => {
    const msg = e.data as { type: string; value?: number };
    if (msg.type === 'position') {
      const active = ap._activeSources.get(sourceId);
      if (active) active.sourcePosition = msg.value!;
    } else if (msg.type === 'ended') {
      ap._activeSources.delete(sourceId);
    } else if (msg.type === 'wasm-error') {
      console.error(
        '[audio-player] stretched playback unavailable — audio WASM failed to initialize',
      );
      ap._activeSources.delete(sourceId);
      workletNode.disconnect();
    }
  };

  // Build downstream chain (same as playInternal)
  const gainNode = ctx.createGain();
  const panner = ctx.createStereoPanner();
  gainNode.gain.value = clampVolume(effectData.volume);
  panner.pan.value = Math.max(-1, Math.min(1, effectData.pan));

  const filters: BiquadFilterNode[] = [];
  if (effectData.mix.length > 0) {
    const freqs = computeBandFrequencies(effectData.mix.length);
    for (let i = 0; i < effectData.mix.length; i++) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'peaking';
      filter.frequency.value = freqs[i];
      filter.Q.value = 1.0;
      filter.gain.value = effectData.mix[i] * 12;
      filters.push(filter);
    }
  }

  let spatialPanner: PannerNode | null = null;
  if (effectData.spatial) {
    spatialPanner = ctx.createPanner();
    spatialPanner.panningModel = 'HRTF';
    spatialPanner.distanceModel = 'inverse';
    spatialPanner.positionX.value = effectData.spatialX;
    spatialPanner.positionY.value = effectData.spatialY;
    spatialPanner.positionZ.value = effectData.spatialZ;
  }

  const reverbSend = ctx.createGain();
  reverbSend.gain.value = Math.max(0, Math.min(1, effectData.reverb));

  // Wire: workletNode → [filters] → gain → panner → master
  let lastNode: AudioNode = workletNode;
  for (const filter of filters) {
    lastNode.connect(filter);
    lastNode = filter;
  }
  lastNode.connect(gainNode);

  let pannerOut: AudioNode;
  if (effectData.spatial && spatialPanner) {
    gainNode.connect(spatialPanner);
    spatialPanner.connect(ap._masterGain);
    pannerOut = spatialPanner;
  } else {
    gainNode.connect(panner);
    panner.connect(ap._masterGain);
    pannerOut = panner;
  }

  if (ap._reverbConvolver) {
    pannerOut.connect(reverbSend);
    reverbSend.connect(ap._reverbConvolver);
  }

  const startTime = ctx.currentTime;
  ap._activeSources.set(sourceId, {
    source: null,
    gain: gainNode,
    panner,
    filters,
    spatialPanner,
    reverbSend,
    startTime,
    offset: effectData.offset,
    workletNode,
    sourcePosition: sourcePos,
    isStretched: true,
  });

  return sourceId;
}

function _playController(
  ap: AudioPlayerT,
  controller: TrackController,
): number {
  return playStretched(ap, controller.track.filePath, controller.repeat, {
    pitchShift: controller.pitchShift,
    speedShift: controller.speedShift,
    volume: controller.volume,
    pan: controller.pan,
    mix: [...controller.mix],
    spatial: controller.spatial,
    spatialX: controller.spatialX,
    spatialY: controller.spatialY,
    spatialZ: controller.spatialZ,
    reverb: controller.reverb,
    transitionBuffer: controller.transitionBuffer,
    offset: controller._pauseOffset,
  });
}

function _getActiveSource(
  ap: AudioPlayerT,
  sourceId: number,
): ActiveSource | undefined {
  return ap._activeSources.get(sourceId);
}

function stopActive(active: ActiveSource): void {
  if (active.isStretched) {
    if (active.workletNode) {
      active.workletNode.port.postMessage({ type: 'stop' });
      active.workletNode.disconnect();
    }
  } else if (active.source) {
    try {
      active.source.stop();
    } catch {
      // Source may already be stopped
    }
  }
}

function stop(ap: AudioPlayerT, sourceId: number): void {
  const active = ap._activeSources.get(sourceId);
  if (active) {
    stopActive(active);
    ap._activeSources.delete(sourceId);
  }
}

function stopAll(ap: AudioPlayerT): void {
  for (const [id, active] of ap._activeSources) {
    stopActive(active);
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
