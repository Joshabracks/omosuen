/**
 * Animation definition for frame-based sprite animation.
 */
export interface Animation {
  /**
   * Unique name for this animation.
   */
  name: string;

  /**
   * Array of frame indices to play in sequence.
   * Can be non-sequential for complex animations (e.g., [0, 2, 1, 3]).
   */
  frames: number[];

  /**
   * Playback speed in frames per second.
   * Default: 12. Used as the per-frame duration fallback when `frameDurations`
   * is absent (or an entry is missing/<=0).
   */
  frameRate: number;

  /**
   * Optional per-frame durations in milliseconds, parallel to `frames`
   * (indexed by position within `frames`, NOT by the frame number value).
   * When present, durations[i] governs how long frames[i] is shown; entries
   * that are missing/undefined/<=0 fall back to 1000/frameRate. Sourced from
   * Aseprite's per-frame durations, which are non-uniform (held key-poses).
   */
  frameDurations?: number[];

  /**
   * Whether the animation loops continuously.
   * Default: true
   */
  loop: boolean;

  /**
   * Optional callback method key to invoke when animation completes.
   * Only called for non-looping animations.
   * Method signature: (controller: AnimationControllerT) => void
   */
  onComplete?: string;
}

/**
 * A logical animation layer: binds a layer name to a sibling sprite component
 * (by name) that the controller drives in lockstep. Multiple sprites stacked in
 * one nexus (body/outline/hair/armor/weapon) each become a layer. Layers sharing
 * a `slot` are mutually exclusive — showing one hides the others in that slot
 * (e.g. swapping between hair A/B/C). Used for runtime sprite compositing.
 */
export interface AnimationLayer {
  /** Logical layer name (e.g. the Aseprite layer name). */
  name: string;

  /** Name of the sibling sprite component this layer drives. */
  spriteName: string;

  /**
   * Optional slot/purpose. Layers sharing a slot are mutually exclusive toggles.
   * Free-form and package-specific — never inferred or hardcoded.
   */
  slot?: string;

  /** Current visibility intent; mirrored onto the bound sprite's `visible`. */
  visible: boolean;
}

/**
 * Animation playback state.
 */
export type AnimationState = 'playing' | 'paused' | 'stopped';
