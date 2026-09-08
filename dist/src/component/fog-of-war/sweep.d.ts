import type { NexusT } from '../nexus/data';
import type { SpriteT } from '../sprite/data';
import type { TransformT } from '../transform/data';
export interface ResolvedSource {
    pos: {
        x: number;
        y: number;
        z: number;
    };
    localCell: {
        x: number;
        y: number;
        z: number;
    };
    outerSq: number;
    radius: number;
    fadeWidth: number;
}
export declare const PHANTOM_REVEAL_VISIBILITY = 0.35;
export declare const PHANTOM_RESPAWN_RADIUS = 0.75;
export declare function isSamePhantomPlace(a: {
    x: number;
    y: number;
    z: number;
}, b: {
    x: number;
    y: number;
    z: number;
}): boolean;
export declare function phantomSupersededBySprite(sprite: SpriteT | null | undefined, transform: TransformT | null | undefined, spawnPos: {
    x: number;
    y: number;
    z: number;
}): boolean;
export type FogDrawKind = 'skip' | 'memory' | 'live';
export declare function fogDrawKind(status: SpriteT['_fowStatus'], hasOwnVisionSource: boolean, trackedByFog: boolean, fogActive: boolean): FogDrawKind;
export declare function fogDiscards(kind: FogDrawKind, vis: number): boolean;
export declare const FOG_FADE_SECONDS = 0.25;
export declare function fogFadeStep(deltaTimeMs: number): number;
export declare function advanceFade(current: number, step: number): number;
export declare function phantomAlpha(covered: boolean, dissolve: number): number;
export declare function phantomIsSpent(covered: boolean, ownerPresence: number, dissolve: number): boolean;
export interface ObscuredTransition {
    sprite: SpriteT;
    transform: TransformT;
}
export interface FogSweepIndex {
    count: number;
    nexuses: NexusT[];
    transforms: TransformT[];
    sprites: SpriteT[];
    selfLit: boolean[];
}
export declare function computeFogVisibility(pos: {
    x: number;
    y: number;
    z: number;
}, sources: ResolvedSource[], mask: Uint8Array, cellDims: {
    x: number;
    y: number;
    z: number;
}, windowOriginLocalCell: {
    x: number;
    y: number;
    z: number;
}, cellSize: {
    x: number;
    y: number;
    z: number;
}, useLineOfSight?: boolean): number;
export declare function isVisibleFrom(pos: {
    x: number;
    y: number;
    z: number;
}, sources: ResolvedSource[], mask: Uint8Array, cellDims: {
    x: number;
    y: number;
    z: number;
}, windowOriginLocalCell: {
    x: number;
    y: number;
    z: number;
}, cellSize: {
    x: number;
    y: number;
    z: number;
}, useLineOfSight?: boolean): boolean;
export declare function sweepFogOfWar(index: FogSweepIndex, sources: ResolvedSource[], mask: Uint8Array, cellDims: {
    x: number;
    y: number;
    z: number;
}, windowOriginLocalCell: {
    x: number;
    y: number;
    z: number;
}, cellSize: {
    x: number;
    y: number;
    z: number;
}, newlyObscured: ObscuredTransition[], revealedPhantoms: NexusT[], useLineOfSight?: boolean): void;
//# sourceMappingURL=sweep.d.ts.map