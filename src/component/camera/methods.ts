import { ComponentData, ComponentMethods } from '../types';
import { Vector3D } from '../../math';
import { CameraT } from './data';
import { SpriteT } from '../sprite/data';
import { CellMapT } from '../cell-map/data';
import { LightT } from '../light/data';
import { VisionSourceT } from '../vision-source/data';
import { render } from './render';
import { collectRenderables } from './collect-renderables';
import { pan } from './pan';
import { screenPick, screenToWorldRay, PickBuffer, PickOptions } from './screen-pick';
import {
  setZoom,
  setPixelScale,
  setZoomTarget,
  resetZoomTarget,
  setOrbitYaw,
  orbitBy,
  resize,
} from './set';
import { init } from './init';
import { dispose } from './dispose';

export interface CameraMethods extends ComponentMethods {
  render: (camera: CameraT, deltaTime: number) => void;
  collectRenderables: (camera: CameraT) => {
    sprites: SpriteT[];
    cellMaps: CellMapT[];
    lights: LightT[];
    visionSources: VisionSourceT[];
  };
  pan: (camera: CameraT, offsetX: number, offsetY: number) => void;
  setZoom: (camera: CameraT, zoom: number) => void;
  setZoomTarget: (camera: CameraT, x: number, y: number) => void;
  resetZoomTarget: (camera: CameraT) => void;
  /** Sets orbit yaw in degrees (rotates world X/Z around +Y before projection). */
  setOrbitYaw: (camera: CameraT, degrees: number) => void;
  /** Rotates orbit yaw by a relative amount (degrees) — drag / keyboard. */
  orbitBy: (camera: CameraT, deltaDegrees: number) => void;
  setPixelScale: (camera: CameraT, pixelScale: number) => void;
  /** Re-syncs the offscreen framebuffer to the current viewport size. */
  resize: (camera: CameraT) => void;
  /**
   * Casts a screen shape into the world and fills `out` (near→far) with the
   * sprites / colliders / event-colliders / non-empty cells it intersects.
   * `pointsXY` is a flat [x0,y0,...] of viewport pixels; `pointCount` is 1
   * (point), 2 (line), 3 (triangle) or 4 (quad). Returns the hit count.
   */
  screenPick: (
    camera: CameraT,
    pointsXY: number[],
    pointCount: number,
    out: PickBuffer,
    options?: PickOptions,
  ) => number;
  /**
   * Converts a viewport pixel to a world-space ray (a representative point on
   * the line + normalized into-scene direction). Returns false if the camera
   * isn't wired into a scene with a viewport.
   */
  screenToWorldRay: (
    camera: CameraT,
    px: number,
    py: number,
    outOrigin: Vector3D,
    outDir: Vector3D,
  ) => boolean;
  init: (component: ComponentData) => Promise<void>;
  dispose: (component: ComponentData) => void;
}

export const Camera: CameraMethods = {
  type: 'camera',
  render,
  collectRenderables,
  pan,
  setZoom,
  setZoomTarget,
  resetZoomTarget,
  setOrbitYaw,
  orbitBy,
  setPixelScale,
  resize,
  screenPick,
  screenToWorldRay,
  init,
  dispose,
};
