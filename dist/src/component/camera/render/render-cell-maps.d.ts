import { CellMapT } from '../../cell-map';
import { LightT } from '../../light';
import { NexusT } from '../../nexus';
import { TextureMapT } from '../../texture-map';
import { TransformT } from '../../transform';
import { CameraT } from '../data';
export declare function snapCameraPosition(camX: number, camY: number, pixelScale: number, zoom: number): {
    x: number;
    y: number;
    remainderX: number;
    remainderY: number;
};
export declare function renderCellMaps(camera: CameraT, cellMaps: CellMapT[], cameraTransform: TransformT, sceneRoot: NexusT, gl: WebGL2RenderingContext, textureMapCache: Map<string, TextureMapT>, lights: LightT[], sinA: number, heightScale: number): void;
//# sourceMappingURL=render-cell-maps.d.ts.map