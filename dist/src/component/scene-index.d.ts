import type { NexusT } from './nexus/data';
import type { TransformT } from './transform/data';
import type { SpriteT } from './sprite/data';
import type { VisionSourceT } from './vision-source/data';
import type { CellMapT } from './cell-map/data';
export declare const sceneIndex: {
    count: number;
    nexuses: NexusT[];
    transforms: TransformT[];
    sprites: SpriteT[];
    selfLit: boolean[];
    visionSourceCount: number;
    visionSources: VisionSourceT[];
    cellMapCount: number;
    cellMaps: CellMapT[];
    generation: number;
};
export declare function beginSceneIndex(): void;
export declare function addSpriteEntry(nexus: NexusT, transform: TransformT, sprite: SpriteT, selfLit: boolean): void;
export declare function addVisionSourceEntry(source: VisionSourceT): void;
export declare function addCellMapEntry(cellMap: CellMapT): void;
export declare function endSceneIndex(): void;
export declare function indexNexusComponents(n: NexusT): TransformT | null;
//# sourceMappingURL=scene-index.d.ts.map