import { ComponentData, ComponentMethods } from '../types';
import { AudioManagerT } from './data';

export interface AudioManagerMethods extends ComponentMethods {
  init: (component: ComponentData) => Promise<void>;
  dispose: (component: ComponentData) => void;

  // Loading
  loadAudio: (
    am: AudioManagerT,
    audioId: string,
    filePath: string,
  ) => Promise<void>;

  // Music
  setMusicTracks: (am: AudioManagerT, tracks: string[]) => void;
  playMusic: (am: AudioManagerT, fadeTime?: number) => Promise<void>;
  stopMusic: (am: AudioManagerT, fadeTime?: number) => Promise<void>;
  pauseMusic: (am: AudioManagerT, fadeTime?: number) => Promise<void>;
  resumeMusic: (am: AudioManagerT, fadeTime?: number) => Promise<void>;
  nextTrack: (am: AudioManagerT, fadeTime?: number) => Promise<void>;
  previousTrack: (am: AudioManagerT, fadeTime?: number) => Promise<void>;

  // Volume
  setMasterVolume: (am: AudioManagerT, volume: number) => void;
  setMusicVolume: (am: AudioManagerT, volume: number) => void;
  setSFXVolume: (am: AudioManagerT, volume: number) => void;
  mute: (am: AudioManagerT) => void;
  unmute: (am: AudioManagerT) => void;
}

// ── Module-level helpers ──

function clampVolume(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function fadeOut(
  context: AudioContext,
  gainNode: GainNode,
  duration: number,
): Promise<void> {
  return new Promise((resolve) => {
    const currentTime = context.currentTime;
    gainNode.gain.linearRampToValueAtTime(0, currentTime + duration);
    setTimeout(() => resolve(), duration * 1000);
  });
}

function fadeIn(
  context: AudioContext,
  gainNode: GainNode,
  targetVolume: number,
  duration: number,
): Promise<void> {
  return new Promise((resolve) => {
    const currentTime = context.currentTime;
    gainNode.gain.setValueAtTime(0, currentTime);
    gainNode.gain.linearRampToValueAtTime(targetVolume, currentTime + duration);
    setTimeout(() => resolve(), duration * 1000);
  });
}

// ── Lifecycle ──

async function init(component: ComponentData): Promise<void> {
  const am = component as AudioManagerT;

  const audioContext = new window.AudioContext();

  const masterGain = audioContext.createGain();
  const musicGain = audioContext.createGain();
  const sfxGain = audioContext.createGain();

  // Wire: music/sfx → master → destination
  masterGain.connect(audioContext.destination);
  musicGain.connect(masterGain);
  sfxGain.connect(masterGain);

  // Apply stored volumes
  masterGain.gain.value = am.muted ? 0 : am.masterVolume;
  musicGain.gain.value = am.musicVolume;
  sfxGain.gain.value = am.sfxVolume;

  am._audioContext = audioContext;
  am._masterGain = masterGain;
  am._musicGain = musicGain;
  am._sfxGain = sfxGain;
}

function dispose(component: ComponentData): void {
  const am = component as AudioManagerT;

  // Stop music
  if (am._currentMusicSource) {
    try {
      am._currentMusicSource.stop();
    } catch {
      // Source may already be stopped
    }
    am._currentMusicSource = null;
    am._currentMusicGain = null;
  }

  // Clear buffers
  am._buffers.clear();

  // Close audio context
  if (am._audioContext) {
    am._audioContext.close().catch(() => {
      // Context may already be closed
    });
    am._audioContext = null;
  }

  am._masterGain = null;
  am._musicGain = null;
  am._sfxGain = null;
  am._musicPlaying = false;
  am._disposed = true;
}

// ── Loading ──

async function loadAudio(
  am: AudioManagerT,
  audioId: string,
  filePath: string,
): Promise<void> {
  if (!am._audioContext) {
    console.warn('[audio-manager] Cannot load audio: not initialized');
    return;
  }

  try {
    const response = await fetch(filePath);
    if (!response.ok) {
      throw new Error(`Failed to fetch audio file: ${filePath}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer =
      await am._audioContext.decodeAudioData(arrayBuffer);
    am._buffers.set(audioId, audioBuffer);
  } catch (error) {
    console.error(
      `[audio-manager] Failed to load audio "${audioId}":`,
      error,
    );
    throw error;
  }
}

// ── Music ──

function setMusicTracks(am: AudioManagerT, tracks: string[]): void {
  am.musicTracks = tracks;
  am.currentTrackIndex = 0;
}

async function playMusic(am: AudioManagerT, fadeTime = 1.0): Promise<void> {
  if (!am._audioContext || !am._musicGain) {
    console.warn('[audio-manager] Cannot play music: not initialized');
    return;
  }

  if (am.musicTracks.length === 0) {
    console.warn('[audio-manager] No music tracks set');
    return;
  }

  const trackId = am.musicTracks[am.currentTrackIndex];
  const buffer = am._buffers.get(trackId);

  if (!buffer) {
    console.warn(
      `[audio-manager] Track "${trackId}" not loaded. Call loadAudio() first.`,
    );
    return;
  }

  // Fade out current music if playing
  if (am._currentMusicSource && am._currentMusicGain) {
    const oldGain = am._currentMusicGain;
    const oldSource = am._currentMusicSource;
    await fadeOut(am._audioContext, oldGain, fadeTime);
    try {
      oldSource.stop();
    } catch {
      // Source may already be stopped
    }
  }

  // Create new source and gain
  const source = am._audioContext.createBufferSource();
  const gainNode = am._audioContext.createGain();

  source.buffer = buffer;
  source.loop = true;
  source.connect(gainNode);
  gainNode.connect(am._musicGain);

  // Start with fade in
  const startOffset = am._musicPausedAt;
  source.start(0, startOffset);
  am._musicStartedAt = am._audioContext.currentTime - startOffset;
  am._musicPausedAt = 0;

  await fadeIn(am._audioContext, gainNode, 1.0, fadeTime);

  am._currentMusicSource = source;
  am._currentMusicGain = gainNode;
  am._musicPlaying = true;

  // Handle track end (only fires if loop is false)
  source.onended = () => {
    if (am._currentMusicSource === source) {
      am._musicPlaying = false;
      am._currentMusicSource = null;
      am._currentMusicGain = null;
    }
  };
}

async function stopMusic(am: AudioManagerT, fadeTime = 1.0): Promise<void> {
  if (
    !am._audioContext ||
    !am._currentMusicSource ||
    !am._currentMusicGain
  ) {
    return;
  }

  const source = am._currentMusicSource;
  const gainNode = am._currentMusicGain;

  await fadeOut(am._audioContext, gainNode, fadeTime);
  try {
    source.stop();
  } catch {
    // Source may already be stopped
  }

  am._currentMusicSource = null;
  am._currentMusicGain = null;
  am._musicPlaying = false;
  am._musicPausedAt = 0;
  am._musicStartedAt = 0;
}

async function pauseMusic(am: AudioManagerT, fadeTime = 0.5): Promise<void> {
  if (
    !am._audioContext ||
    !am._currentMusicSource ||
    !am._currentMusicGain ||
    !am._musicPlaying
  ) {
    return;
  }

  // Record elapsed playback position before stopping
  const elapsed = am._audioContext.currentTime - am._musicStartedAt;
  const buffer = am._currentMusicSource.buffer;
  if (buffer) {
    am._musicPausedAt = elapsed % buffer.duration;
  }

  await fadeOut(am._audioContext, am._currentMusicGain, fadeTime);
  try {
    am._currentMusicSource.stop();
  } catch {
    // Source may already be stopped
  }

  am._currentMusicSource = null;
  am._currentMusicGain = null;
  am._musicPlaying = false;
}

async function resumeMusic(
  am: AudioManagerT,
  fadeTime = 0.5,
): Promise<void> {
  if (am._musicPlaying) {
    return;
  }

  // playMusic reads _musicPausedAt for the start offset
  await playMusic(am, fadeTime);
}

async function nextTrack(am: AudioManagerT, fadeTime = 5.0): Promise<void> {
  if (am.musicTracks.length === 0) return;

  am.currentTrackIndex =
    (am.currentTrackIndex + 1) % am.musicTracks.length;
  am._musicPausedAt = 0;

  if (am._musicPlaying) {
    await playMusic(am, fadeTime);
  }
}

async function previousTrack(
  am: AudioManagerT,
  fadeTime = 5.0,
): Promise<void> {
  if (am.musicTracks.length === 0) return;

  am.currentTrackIndex =
    (am.currentTrackIndex - 1 + am.musicTracks.length) %
    am.musicTracks.length;
  am._musicPausedAt = 0;

  if (am._musicPlaying) {
    await playMusic(am, fadeTime);
  }
}

// ── Volume ──

function setMasterVolume(am: AudioManagerT, volume: number): void {
  am.masterVolume = clampVolume(volume);
  if (!am.muted && am._masterGain) {
    am._masterGain.gain.value = am.masterVolume;
  }
}

function setMusicVolume(am: AudioManagerT, volume: number): void {
  am.musicVolume = clampVolume(volume);
  if (am._musicGain) {
    am._musicGain.gain.value = am.musicVolume;
  }
}

function setSFXVolume(am: AudioManagerT, volume: number): void {
  am.sfxVolume = clampVolume(volume);
  if (am._sfxGain) {
    am._sfxGain.gain.value = am.sfxVolume;
  }
}

function mute(am: AudioManagerT): void {
  am.muted = true;
  if (am._masterGain) {
    am._masterGain.gain.value = 0;
  }
}

function unmute(am: AudioManagerT): void {
  am.muted = false;
  if (am._masterGain) {
    am._masterGain.gain.value = am.masterVolume;
  }
}

export const AudioManager: AudioManagerMethods = {
  type: 'audio-manager',
  init,
  dispose,
  loadAudio,
  setMusicTracks,
  playMusic,
  stopMusic,
  pauseMusic,
  resumeMusic,
  nextTrack,
  previousTrack,
  setMasterVolume,
  setMusicVolume,
  setSFXVolume,
  mute,
  unmute,
};
