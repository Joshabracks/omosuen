import type { NexusT } from '../../component/nexus/data';
import type { AtlasManagerT } from '../../component/atlas-manager/data';
import type { SpriteT } from '../../component/sprite/data';
import type { AnimationControllerT } from '../../component/animation-controller/data';
import { Vector2D, Vector3D } from '../../math';
export interface AsepriteImportConfig {
    parent: NexusT;
    atlasManager: AtlasManagerT;
    packageId: string;
    flatten?: boolean;
    visibleOnly?: boolean;
    anchor?: Vector2D;
    position?: Vector3D;
    scale?: Vector3D;
    layerSlots?: Record<string, string>;
}
export interface AsepriteImportResult {
    controller: AnimationControllerT | null;
    sprites: SpriteT[];
}
export declare function importAseprite(buffer: ArrayBuffer, config: AsepriteImportConfig): Promise<AsepriteImportResult>;
//# sourceMappingURL=import.d.ts.map