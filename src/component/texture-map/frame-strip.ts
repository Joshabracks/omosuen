/**
 * Frame packing — lay several separate images out as one horizontal strip and
 * report the frame rectangles.
 *
 * This is the *spatial* counterpart to channel packing, and the two compose.
 * When both are wanted, **lay out frames first and channel-pack second**: one
 * interleave over the finished strip costs three `getImageData` calls in total,
 * whereas packing per frame costs three per frame.
 *
 * If a spritesheet already exists as one image, this helper is the wrong tool —
 * `texture-map`'s `GridConfig` slices it with no compositing at all. Reach for
 * this only when the frames really are separate files.
 */

import { Vector2D, Vector4D } from '../../math';
import { FrameMap } from './types';
import { ChannelSource } from './channel-pack';
import { createPackCanvas, get2d, resolveSource } from './image-source';

/** Vertical placement of a frame shorter than the strip. */
export type FrameAlign = 'top' | 'bottom' | 'center';

export interface FrameStripOptions {
  /**
   * Force every frame into a fixed cell. Frames are placed within the cell per
   * `align` and are never scaled. Default: cells are sized to the widest and
   * tallest frame.
   */
  cell?: Vector2D;
  /** Vertical placement within the cell. Default `'bottom'`. */
  align?: FrameAlign;
  /** Used in thrown errors to identify the offending strip. */
  label?: string;
}

export interface FrameStripResult {
  /** The composited strip, ready for a texture-map's `sourceImage`. */
  canvas: HTMLCanvasElement;
  /** Frame rectangles, ready for a texture-map's `imageType`. */
  frames: FrameMap;
  /** Overall strip dimensions. */
  size: Vector2D;
}

/**
 * Composites frames left to right into one strip.
 *
 * `'bottom'` is the default alignment because these are overwhelmingly
 * character/object frames of differing height that must share a ground line —
 * top-aligning them makes a walk cycle bob.
 *
 * ```ts
 * const { canvas, frames } = await packFrameStrip([
 *   './walk-0.png', './walk-1.png', './walk-2.png',
 * ]);
 * newComponent('texture-map', {
 *   textureMapKey: 'hero-walk',
 *   filePath: 'packed://hero/walk',   // dedup key only
 *   sourceImage: canvas,
 *   imageType: frames,
 * });
 * ```
 */
export async function packFrameStrip(
  frames: ChannelSource[],
  options: FrameStripOptions = {},
): Promise<FrameStripResult> {
  const label = options.label ?? 'packFrameStrip';
  if (frames.length === 0) {
    throw new Error(`[texture-map] ${label}: no frames supplied`);
  }

  const resolved = await Promise.all(
    frames.map((f, i) => resolveSource(f, `${label}[${i}]`)),
  );

  const drawable = resolved.map((source, i) => {
    if (source.kind === 'constant') {
      throw new Error(
        `[texture-map] ${label}[${i}]: a constant is not a frame. Frame ` +
          'sources must be images.',
      );
    }
    return source;
  });

  const cellWidth =
    options.cell?.x ?? Math.max(...drawable.map((s) => s.width));
  const cellHeight =
    options.cell?.y ?? Math.max(...drawable.map((s) => s.height));

  if (!(cellWidth > 0) || !(cellHeight > 0)) {
    throw new Error(
      `[texture-map] ${label}: computed cell size is ${cellWidth}x${cellHeight}`,
    );
  }

  const canvas = createPackCanvas(
    cellWidth * drawable.length,
    cellHeight,
    false,
  );
  const ctx = get2d(canvas);
  const align = options.align ?? 'bottom';
  const rects: Vector4D[] = [];

  for (let i = 0; i < drawable.length; i++) {
    const source = drawable[i];
    const x = i * cellWidth;
    const offsetY =
      align === 'top'
        ? 0
        : align === 'center'
          ? Math.floor((cellHeight - source.height) / 2)
          : cellHeight - source.height;

    if (source.kind === 'pixels') {
      // putImageData ignores the transform, so it cannot be offset directly —
      // stage it on its own canvas and draw that.
      const temp = createPackCanvas(source.width, source.height);
      const tempCtx = get2d(temp);
      const staged = tempCtx.createImageData(source.width, source.height);
      staged.data.set(source.data);
      tempCtx.putImageData(staged, 0, 0);
      ctx.drawImage(temp, x, offsetY);
    } else {
      ctx.drawImage(source.image, x, offsetY);
    }

    // The rect is the whole CELL, not the frame's own bounds — a sprite's
    // anchor is resolved against the cell, so varying rects would shift it.
    rects.push(new Vector4D(x, 0, cellWidth, cellHeight));
  }

  return {
    canvas,
    frames: rects,
    size: new Vector2D(cellWidth * drawable.length, cellHeight),
  };
}
