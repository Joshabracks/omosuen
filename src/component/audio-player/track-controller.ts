import type { AudioPlayerT } from './data';
import type { AudioTrackT } from '../audio-track/data';
import type { AudioEffectT } from '../audio-effect/data';
import { AudioPlayer } from './methods';

/**
 * Convenience wrapper for concurrent track playback.
 * NOT a component — instantiated by user code.
 *
 * Deep-copies the effect data so mutations don't affect the
 * original AudioEffect component.
 *
 * @example
 * ```typescript
 * const tc = new TrackController(audioPlayer, myTrack, myEffect, true);
 * tc.play();   // starts looping playback
 * tc.volume = 0.5; // change volume for next play()
 * tc.stop();
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
  }

  /** Whether a source is currently playing. */
  get isPlaying(): boolean {
    if (this._sourceId === null) return false;
    return this._audioPlayer._activeSources.has(this._sourceId);
  }

  // ── Effect accessors ──

  get pitchShift(): number {
    return this._pitchShift;
  }
  set pitchShift(v: number) {
    this._pitchShift = v;
  }

  get speedShift(): number {
    return this._speedShift;
  }
  set speedShift(v: number) {
    this._speedShift = v;
  }

  get volume(): number {
    return this._volume;
  }
  set volume(v: number) {
    this._volume = v;
  }

  get pan(): number {
    return this._pan;
  }
  set pan(v: number) {
    this._pan = v;
  }

  // ── Playback ──

  /** Starts playback, returning the source ID. */
  play(): number {
    const id = AudioPlayer._playController(this._audioPlayer, this);
    this._sourceId = id;
    return id;
  }

  /** Stops the current source. */
  stop(): void {
    if (this._sourceId !== null) {
      AudioPlayer.stop(this._audioPlayer, this._sourceId);
      this._sourceId = null;
    }
  }
}
