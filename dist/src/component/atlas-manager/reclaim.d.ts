import type { AtlasDirtyRegion, PackedRegion, PackerState } from './types';
import type { Vector2D } from '../../math';
export declare function reclaimUnreferenced(packState: PackerState, packedByKey: Map<string, PackedRegion>, liveKeys: ReadonlySet<string>): number;
export declare function paddedRect(atlasIndex: number, position: Vector2D, size: Vector2D, padding: number, atlasSize: number): Omit<AtlasDirtyRegion, 'version'>;
//# sourceMappingURL=reclaim.d.ts.map