export interface ScoredVisionEntry {
    score: number;
}
export declare function visionSourceScore(camX: number, camY: number, camZ: number, x: number, y: number, z: number, outer: number): number;
export declare function selectNearestVisionSources<T extends ScoredVisionEntry>(entries: T[], max: number): number;
//# sourceMappingURL=vision-selection.d.ts.map