import { CellMapT } from '../../cell-map';
import { LightT } from '../../light';
import { NexusT } from '../../nexus';
import type { SpriteT } from '../../sprite';
import { TextureMapT } from '../../texture-map';
import { TransformT } from '../../transform';
import { ViewportT } from '../../viewport';
import { CameraT } from '../data';
export declare function renderSprites(camera: CameraT, viewport: ViewportT, sprites: SpriteT[], cellMaps: CellMapT[], transform: TransformT, sceneRoot: NexusT, gl: WebGL2RenderingContext, textureMapCache: Map<string, TextureMapT>, lights: LightT[], subPixelOffset: {
    remainderX: number;
    remainderY: number;
}, sinA: number, heightScale: number): void;
//# sourceMappingURL=render-sprites.d.ts.map