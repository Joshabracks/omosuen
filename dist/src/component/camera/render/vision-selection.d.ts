export interface ScoredVisionEntry {
    score: number;
    priority?: number;
}
export interface ShapeProjection {
    camIsoX: number;
    camIsoY: number;
    sinA: number;
    heightScale: number;
    cosYaw: number;
    sinYaw: number;
}
export declare function projectedShapeScore(proj: ShapeProjection, x: number, y: number, z: number, outer: number): number;
export declare function visionSourceScore(camX: number, camY: number, camZ: number, x: number, y: number, z: number, outer: number): number;
export declare function selectNearestVisionSources<T extends ScoredVisionEntry>(entries: T[], max: number): number;
//# sourceMappingURL=vision-selection.d.ts.map