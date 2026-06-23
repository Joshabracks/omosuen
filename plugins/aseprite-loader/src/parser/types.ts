/**
 * Intermediate model produced by the .aseprite parser. Engine-agnostic: the
 * importer (which DOES depend on the engine) consumes this to build components.
 */

/** A layer definition (from the frame-0 layer chunks). */
export interface AseLayer {
  /** Index = declaration order; cels reference layers by this index. */
  index: number;
  /** Layer name (package-specific; never interpreted by the parser). */
  name: string;
  /** Visibility flag (per-layer, not per-frame). */
  visible: boolean;
  /** 0 = image, 1 = group, 2 = tilemap. */
  type: number;
  /** Group-nesting depth (informational). */
  childLevel: number;
  /** Blend mode (0 = normal). */
  blendMode: number;
  /** Layer opacity 0-255. */
  opacity: number;
}

/** A cel: one layer's pixels on one frame, as a trimmed sub-rectangle. */
export interface AseCel {
  /** Index of the owning layer. */
  layerIndex: number;
  /** Trim offset on the canvas (top-left of the sub-rect). */
  x: number;
  y: number;
  /** Sub-rect dimensions (may be smaller than the canvas). */
  w: number;
  h: number;
  /** Cel opacity 0-255. */
  opacity: number;
  /** RGBA pixels (length w*h*4) after inflate; null until materialized. */
  pixels: Uint8Array | null;
  /** For linked cels: the frame whose cel (same layer) this reuses. */
  linkedFrame?: number;
}

/** A single animation frame: its display duration and the cels on it. */
export interface AseFrame {
  /** Display duration in milliseconds (Aseprite per-frame timing). */
  durationMs: number;
  /** Cels present on this frame (one per layer that has content). */
  cels: AseCel[];
}

/** A named animation tag (clip) over a frame range. */
export interface AseTag {
  name: string;
  /** Inclusive frame range. */
  from: number;
  to: number;
  /** 0 = forward, 1 = reverse, 2 = ping-pong, 3 = ping-pong reverse. */
  loopDir: number;
  /** Repeat count; 0 = infinite. */
  repeat: number;
}

/** Fully-parsed Aseprite file (pixels inflated, linked cels resolved). */
export interface AseFile {
  width: number;
  height: number;
  /** Color depth in bits-per-pixel: 32 = RGBA, 16 = grayscale, 8 = indexed. */
  colorDepth: number;
  frameCount: number;
  layers: AseLayer[];
  frames: AseFrame[];
  tags: AseTag[];
}
