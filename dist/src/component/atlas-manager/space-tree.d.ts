import type { AtlasSpace } from './types';
export interface SpaceTreeConfig {
    cmp: (a: AtlasSpace, b: AtlasSpace) => number;
    primary: (s: AtlasSpace) => number;
    primaryMin: (needX: number, needY: number) => number;
    secondary: (s: AtlasSpace) => number;
    secondaryMin: (needX: number, needY: number) => number;
}
export declare class SpaceTree {
    private root;
    private readonly cmp;
    private readonly primary;
    private readonly primaryMin;
    private readonly secondary;
    private readonly secondaryMin;
    constructor(config: SpaceTreeConfig);
    insert(space: AtlasSpace): void;
    remove(space: AtlasSpace): void;
    findBestFit(needX: number, needY: number): AtlasSpace | null;
    private query;
    private findNode;
    private deleteNode;
    private rebalanceUp;
    private rotateLeft;
    private rotateRight;
    private update;
    private balanceFactor;
}
//# sourceMappingURL=space-tree.d.ts.map