import { ComponentData, ComponentMethods } from '../types';
import { CameraT } from './data';
import { SpriteT } from '../sprite/data';
import { CellMapT } from '../cell-map/data';
import { LightT } from '../light/data';
import { render } from './render';
import { collectRenderables } from './collect-renderables';
import { pan } from './pan';
import { setZoom, setPixelScale, setZoomTarget, resetZoomTarget } from './set';
import { init } from './init';
import { dispose } from './dispose';

export interface CameraMethods extends ComponentMethods {
  render: (camera: CameraT, deltaTime: number) => void;
  collectRenderables: (camera: CameraT) => {
    sprites: SpriteT[];
    cellMaps: CellMapT[];
    lights: LightT[];
  };
  pan: (camera: CameraT, offsetX: number, offsetY: number) => void;
  setZoom: (camera: CameraT, zoom: number) => void;
  setZoomTarget: (camera: CameraT, x: number, y: number) => void;
  resetZoomTarget: (camera: CameraT) => void;
  setPixelScale: (camera: CameraT, pixelScale: number) => void;
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
  setPixelScale,
  init,
  dispose,
};
