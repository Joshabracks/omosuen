import { ComponentData, ComponentMethods } from '../types';
import { FogOfWarT, FogOfWarStyle } from './data';
export declare function spriteFogPresence(spriteId: number | undefined): number;
export declare function phantomFogAlpha(phantomNexusId: number): number;
export declare function isPhantomCoveredBySprite(phantomNexusId: number): boolean;
export interface FogOfWarMethods extends ComponentMethods {
    type: 'fog-of-war';
    getMemoryStyle: (fow: FogOfWarT) => FogOfWarStyle;
    setMemoryStyle: (fow: FogOfWarT, style: FogOfWarStyle) => void;
    getNeverViewedStyle: (fow: FogOfWarT) => FogOfWarStyle;
    setNeverViewedStyle: (fow: FogOfWarT, style: FogOfWarStyle) => void;
    getLightInfluence: (fow: FogOfWarT) => number;
    setLightInfluence: (fow: FogOfWarT, lightInfluence: number) => void;
    getNearBufferCells: (fow: FogOfWarT) => number;
    setNearBufferCells: (fow: FogOfWarT, nearBufferCells: number) => void;
    update: (component: ComponentData, deltaTime: number) => void;
    dispose: (component: ComponentData) => void;
}
export declare const FogOfWar: FogOfWarMethods;
//# sourceMappingURL=methods.d.ts.map