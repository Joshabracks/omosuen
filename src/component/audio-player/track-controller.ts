import type { AudioPlayerT, ActiveSource } from './data';
import type { AudioTrackT } from '../audio-track/data';
import type { AudioEffectT } from '../audio-effect/data';
import { AudioPlayer } from './methods';

/**
 * Convenience wrapper for concurrent track playback.
 * NOT a component — instantiated by user code.
 *
 * Deep-copies the effect data so mutations don't affect the
 * original AudioEffect component. Setters perform live updates
 * on the underlying Web Audio nodes when a source is playing.
 *
 * @example
 * ```typescript
 * const tc = new TrackController(audioPlayer, myTrack, myEffect, true);
 * tc.play();   // starts looping playback
 * tc.volume = 0.5; // live-updates gain node
 * tc.pause();  // pauses at current position
 * tc.play();   // resumes from paused position
 * tc.stop();   // stops and resets position
 * ```
 */
export class TrackController {
  private _audioPlayer: AudioPlayerT;
  private _track: AudioTrackT;
  private _sourceId: number | null = null;
  private _repeat: boolean;

  // Deep-copied effect data
  private _pitchShift: number;
  private _speedShift: number;
  private _volume: number;
  private _pan: number;
  private _mix: number[];
  private _spatial: boolean;
  private _spatialX: number;
  private _spatialY: number;
  private _spatialZ: number;
  private _reverb: number;

  /** Offset into buffer for resume-from-pause (seconds). */
  _pauseOffset: number = 0;

  constructor(
    audioPlayer: AudioPlayerT,
    track: AudioTrackT,
    effect?: AudioEffectT,
    repeat: boolean = false,
  ) {
    this._audioPlayer = audioPlayer;
    this._track = track;
    this._repeat = repeat;

    // Deep copy effect values (or defaults)
    this._pitchShift = effect?.pitchShift ?? 0;
    this._speedShift = effect?.speedShift ?? 1.0;
    this._volume = effect?.volume ?? 1.0;
    this._pan = effect?.pan ?? 0;
    this._mix = effect?.mix ? [...effect.mix] : [];
    this._spatial = effect?.spatial ?? false;
    this._spatialX = effect?.spatialX ?? 0;
    this._spatialY = effect?.spatialY ?? 0;
    this._spatialZ = effect?.spatialZ ?? 0;
    this._reverb = effect?.reverb ?? 0;
  }

  // ── Helpers ──

  private _getActiveSource(): ActiveSource | undefined {
    if (this._sourceId === null) return undefined;
    return AudioPlayer._getActiveSource(this._audioPlayer, this._sourceId);
  }

  /** The AudioTrack this controller wraps. */
  get track(): AudioTrackT {
    return this._track;
  }

  /** Whether playback should loop. */
  get repeat(): boolean {
    return this._repeat;
  }

  set repeat(value: boolean) {
    this._repeat = value;
    const active = this._getActiveSource();
    if (active) {
      if (active.isStretched && active.workletNode) {
        active.workletNode.port.postMessage({ type: 'repeat', value });
      } else if (active.source) {
        active.source.loop = value;
      }
    }
  }

  /** Whether a source is currently playing. */
  get isPlaying(): boolean {
    if (this._sourceId === null) return false;
    return this._audioPlayer._activeSources.has(this._sourceId);
  }

  // ── Effect accessors with live updates ──

  get pitchShift(): number {
    return this._pitchShift;
  }
  set pitchShift(v: number) {
    this._pitchShift = v;
    const active = this._getActiveSource();
    if (active) {
      if (active.isStretched && active.workletNode) {
        active.workletNode.port.postMessage({
          type: 'pitch',
          value: this._pitchShift,
        });
      } else if (active.source) {
        active.source.detune.value = this._pitchShift * 100;
      }
    }
  }

  get speedShift(): number {
    return this._speedShift;
  }
  set speedShift(v: number) {
    this._speedShift = v;
    const active = this._getActiveSource();
    if (active) {
      if (active.isStretched && active.workletNode) {
        active.workletNode.port.postMessage({
          type: 'tempo',
          value: this._speedShift,
        });
      } else if (active.source) {
        active.source.playbackRate.value = this._speedShift;
      }
    }
  }

  get volume(): number {
    return this._volume;
  }
  set volume(v: number) {
    this._volume = Math.max(0, Math.min(1, v));
    const active = this._getActiveSource();
    if (active) {
      active.gain.gain.value = this._volume;
    }
  }

  get pan(): number {
    return this._pan;
  }
  set pan(v: number) {
    this._pan = Math.max(-1, Math.min(1, v));
    const active = this._getActiveSource();
    if (active && !this._spatial) {
      active.panner.pan.value = this._pan;
    }
  }

  get mix(): number[] {
    return [...this._mix];
  }
  set mix(arr: number[]) {
    this._mix = [...arr];
    const active = this._getActiveSource();
    if (active) {
      for (
        let i = 0;
        i < active.filters.length && i < this._mix.length;
        i++
      ) {
        active.filters[i].gain.value = this._mix[i] * 12;
      }
    }
  }

  /** Update a single EQ band live. */
  setMixBand(index: number, value: number): void {
    if (index >= 0 && index < this._mix.length) {
      this._mix[index] = value;
    }
    const active = this._getActiveSource();
    if (active && index >= 0 && index < active.filters.length) {
      active.filters[index].gain.value = value * 12;
    }
  }

  get spatial(): boolean {
    return this._spatial;
  }
  set spatial(v: boolean) {
    this._spatial = v;
    // Spatial toggle requires restarting the source (different node graph)
  }

  get spatialX(): number {
    return this._spatialX;
  }
  set spatialX(v: number) {
    this._spatialX = v;
    const active = this._getActiveSource();
    if (active && active.spatialPanner) {
      active.spatialPanner.positionX.value = v;
    }
  }

  get spatialY(): number {
    return this._spatialY;
  }
  set spatialY(v: number) {
    this._spatialY = v;
    const active = this._getActiveSource();
    if (active && active.spatialPanner) {
      active.spatialPanner.positionY.value = v;
    }
  }

  get spatialZ(): number {
    return this._spatialZ;
  }
  set spatialZ(v: number) {
    this._spatialZ = v;
    const active = this._getActiveSource();
    if (active && active.spatialPanner) {
      active.spatialPanner.positionZ.value = v;
    }
  }

  /** Set spatial position (all three axes at once). */
  setSpatialPosition(x: number, y: number, z: number): void {
    this._spatialX = x;
    this._spatialY = y;
    this._spatialZ = z;
    const active = this._getActiveSource();
    if (active && active.spatialPanner) {
      active.spatialPanner.positionX.value = x;
      active.spatialPanner.positionY.value = y;
      active.spatialPanner.positionZ.value = z;
    }
  }

  get reverb(): number {
    return this._reverb;
  }
  set reverb(v: number) {
    this._reverb = Math.max(0, Math.min(1, v));
    const active = this._getActiveSource();
    if (active) {
      active.reverbSend.gain.value = this._reverb;
    }
  }

  // ── Track info & seeking ──

  /** Returns the track duration in milliseconds, or 0 if not loaded. */
  trackLength(): number {
    const buffer = this._audioPlayer._bufferCache.get(this._track.filePath);
    return buffer ? buffer.duration * 1000 : 0;
  }

  /** Returns the current playback position in milliseconds. */
  trackPosition(): number {
    if (this._sourceId === null) {
      return this._pauseOffset * 1000;
    }
    const active = this._getActiveSource();
    if (!active) return this._pauseOffset * 1000;

    if (active.isStretched) {
      const sampleRate = this._audioPlayer._audioContext?.sampleRate ?? 44100;
      return (active.sourcePosition / sampleRate) * 1000;
    } else if (active.source) {
      const ctx = this._audioPlayer._audioContext;
      if (ctx) {
        const elapsed =
          (ctx.currentTime - active.startTime) *
          active.source.playbackRate.value;
        const duration = active.source.buffer?.duration ?? Infinity;
        const pos = active.offset + elapsed;
        return (this._repeat ? pos % duration : Math.min(pos, duration)) * 1000;
      }
    }
    return 0;
  }

  /** Seeks to a position in milliseconds. */
  setTrackPosition(position: number): void {
    const lengthMs = this.trackLength();
    const posSec = Math.max(0, Math.min(position, lengthMs)) / 1000;

    if (this.isPlaying) {
      this.pause();
      this._pauseOffset = posSec;
      this.play();
    } else {
      this._pauseOffset = posSec;
    }
  }

  // ── Playback ──

  /** Starts (or resumes) playback, returning the source ID. */
  play(): number {
    const id = AudioPlayer._playController(this._audioPlayer, this);
    if (this._pauseOffset > 0) {
      this._pauseOffset = 0;
    }
    this._sourceId = id;
    return id;
  }

  /**
   * Pauses the current source and records the playback position.
   * Call play() again to resume from the paused position.
   */
  pause(): void {
    if (this._sourceId === null) return;
    const active = this._getActiveSource();
    if (!active) {
      this._sourceId = null;
      return;
    }

    if (active.isStretched) {
      // Stretched mode: get position from the source read cursor
      const sampleRate = this._audioPlayer._audioContext?.sampleRate ?? 44100;
      this._pauseOffset = active.sourcePosition / sampleRate;
      if (active.workletNode) {
        active.workletNode.port.postMessage({ type: 'stop' });
        active.workletNode.disconnect();
      }
    } else if (active.source) {
      // Native mode: calculate from ctx.currentTime
      const ctx = this._audioPlayer._audioContext;
      if (ctx) {
        const elapsed =
          (ctx.currentTime - active.startTime) *
          active.source.playbackRate.value;
        const duration = active.source.buffer?.duration ?? Infinity;
        this._pauseOffset = (active.offset + elapsed) % duration;
      }
      try {
        active.source.stop();
      } catch {
        // Source may already be stopped
      }
    }

    this._audioPlayer._activeSources.delete(this._sourceId);
    this._sourceId = null;
  }

  /** Stops the current source and resets the pause offset. */
  stop(): void {
    this._pauseOffset = 0;
    if (this._sourceId !== null) {
      AudioPlayer.stop(this._audioPlayer, this._sourceId);
      this._sourceId = null;
    }
  }
}
