import type { ComponentData, ComponentMethods } from '../types';
import type { TextureMapT } from './data';
import type { OriginalFrame, PackedFrame } from './types';

export interface TextureMapMethods extends ComponentMethods {
  type: 'texture-map';

  /**
   * Gets an original frame by index.
   *
   * @param tm - TextureMap component
   * @param frameIndex - Index of the frame to retrieve
   * @returns The original frame, or undefined if not found
   */
  getOriginalFrame: (
    tm: TextureMapT,
    frameIndex: number,
  ) => OriginalFrame | undefined;

  /**
   * Gets a packed frame by index.
   *
   * @param tm - TextureMap component
   * @param frameIndex - Index of the frame to retrieve
   * @returns The packed frame, or undefined if not found or not yet packed
   */
  getPackedFrame: (
    tm: TextureMapT,
    frameIndex: number,
  ) => PackedFrame | undefined;

  /**
   * Checks if this texture map has been packed (has packed frames).
   *
   * @param tm - TextureMap component
   * @returns True if packed frames exist, false otherwise
   */
  isPacked: (tm: TextureMapT) => boolean;

  /**
   * Gets the total number of frames in this texture map.
   *
   * @param tm - TextureMap component
   * @returns Number of frames
   */
  getFrameCount: (tm: TextureMapT) => number;

  /**
   * Clears all packed frame data.
   * Used when recompiling atlases or during cleanup.
   *
   * @param tm - TextureMap component
   */
  clearPackedFrames: (tm: TextureMapT) => void;

  /**
   * Sets the packed frames for this texture map.
   * Called by AtlasManager after packing.
   *
   * @param tm - TextureMap component
   * @param packedFrames - Array of packed frames
   */
  setPackedFrames: (tm: TextureMapT, packedFrames: PackedFrame[]) => void;

  /**
   * Disposes of this texture map.
   *
   * @param component - Component to dispose
   */
  dispose: (component: ComponentData) => void;
}

export const TextureMap: TextureMapMethods = {
  type: 'texture-map',

  getOriginalFrame: (
    tm: TextureMapT,
    frameIndex: number,
  ): OriginalFrame | undefined => {
    return tm.originalFrames.find((frame) => frame.frameIndex === frameIndex);
  },

  getPackedFrame: (
    tm: TextureMapT,
    frameIndex: number,
  ): PackedFrame | undefined => {
    return tm.packedFrames.find((frame) => frame.frameIndex === frameIndex);
  },

  isPacked: (tm: TextureMapT): boolean => {
    return tm.packedFrames.length > 0;
  },

  getFrameCount: (tm: TextureMapT): number => {
    return tm.originalFrames.length;
  },

  clearPackedFrames: (tm: TextureMapT): void => {
    tm.packedFrames = [];
  },

  setPackedFrames: (tm: TextureMapT, packedFrames: PackedFrame[]): void => {
    tm.packedFrames = packedFrames;
  },

  dispose: (component: ComponentData): void => {
    const tm = component as unknown as TextureMapT;
    tm.originalFrames = [];
    tm.packedFrames = [];
    tm._disposed = true;
  },
};
