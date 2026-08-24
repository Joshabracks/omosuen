import { CellMapT } from '../../cell-map';
import { LightT } from '../../light';
import { SpriteT } from '../../sprite';
import { CameraT } from '../data';
export declare function clearRenderablesCache(cameraId: number): void;
export declare function collectRenderables(camera: CameraT): {
    sprites: SpriteT[];
    cellMaps: CellMapT[];
    lights: LightT[];
};
//# sourceMappingURL=index.d.ts.map