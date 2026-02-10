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
   * Default: 12
   */
  frameRate: number;

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
 * Animation playback state.
 */
export type AnimationState = 'playing' | 'paused' | 'stopped';
