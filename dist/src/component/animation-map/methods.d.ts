import type { ComponentMethods } from '../types';
import type { AnimationMapT } from './data';
import type { Animation } from '../animation-controller/types';
export interface AnimationMapMethods extends ComponentMethods {
    type: 'animation-map';
    getAnimation: (am: AnimationMapT, name: string) => Animation | null;
    hasAnimation: (am: AnimationMapT, name: string) => boolean;
    getAnimationNames: (am: AnimationMapT) => string[];
}
export declare const AnimationMap: AnimationMapMethods;
//# sourceMappingURL=methods.d.ts.map