import { CellMapT } from '../../cell-map';
import { LightT } from '../../light';
import { VisionSourceT } from '../../vision-source';
import { SpriteT } from '../../sprite';
import { CameraT } from '../data';
export declare function clearRenderablesCache(cameraId: number): void;
export declare function collectRenderables(camera: CameraT): {
    sprites: SpriteT[];
    cellMaps: CellMapT[];
    lights: LightT[];
    visionSources: VisionSourceT[];
};
//# sourceMappingURL=index.d.ts.map