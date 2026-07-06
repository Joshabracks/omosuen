import { ComponentMethods } from '../types';
import { SpeedDialT } from './data';

export interface SpeedDialMethods extends ComponentMethods {
  type: 'speed-dial';
  setSpeed: (dial: SpeedDialT, speed: number) => void;
  getSpeed: (dial: SpeedDialT) => number;
}

/**
 * The speed-dial has no per-frame update of its own — the update traversal reads
 * its `speed` off the parent nexus's children and scales the subtree's dt. These
 * methods just get/set the multiplier (clamped to >= 0).
 */
export const SpeedDial: SpeedDialMethods = {
  type: 'speed-dial',

  setSpeed(dial: SpeedDialT, speed: number): void {
    dial.speed = Math.max(0, speed);
  },

  getSpeed(dial: SpeedDialT): number {
    return dial.speed;
  },
};
