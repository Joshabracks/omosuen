import { ComponentData, ComponentMethods } from '../types';
import { Vector3D } from '../../math';
import { CameraT } from './data';
import { SpriteT } from '../sprite/data';
import { CellMapT } from '../cell-map/data';
import { LightT } from '../light/data';
import { PickBuffer, PickOptions } from './screen-pick';
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
    setOrbitYaw: (camera: CameraT, degrees: number) => void;
    orbitBy: (camera: CameraT, deltaDegrees: number) => void;
    setPixelScale: (camera: CameraT, pixelScale: number) => void;
    resize: (camera: CameraT) => void;
    setRevealTarget: (camera: CameraT, x: number, y: number, z: number) => void;
    clearRevealTarget: (camera: CameraT) => void;
    setRevealVolume: (camera: CameraT, min: {
        x: number;
        y: number;
        z: number;
    }, max: {
        x: number;
        y: number;
        z: number;
    }) => void;
    clearRevealVolume: (camera: CameraT) => void;
    screenPick: (camera: CameraT, pointsXY: number[], pointCount: number, out: PickBuffer, options?: PickOptions) => number;
    screenToWorldRay: (camera: CameraT, px: number, py: number, outOrigin: Vector3D, outDir: Vector3D) => boolean;
    init: (component: ComponentData) => Promise<void>;
    dispose: (component: ComponentData) => void;
}
export declare const Camera: CameraMethods;
//# sourceMappingURL=methods.d.ts.map