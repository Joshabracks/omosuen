import type { ComponentData, ComponentOptions, ComponentSerializer, ComponentInstanceMethods } from '../types';
import { ComponentUnique } from '../types';
import type { Animation } from '../animation-controller/types';
import type { AnimationMapMethods } from './methods';
export interface AnimationMapT extends ComponentData, ComponentInstanceMethods<AnimationMapMethods> {
    type: 'animation-map';
    unique: ComponentUnique.FALSE;
    animationMapKey: string;
    animations: Map<string, Animation>;
}
export declare const PROPERTY_ALLOWLIST: string[];
export interface AnimationMapOptions extends ComponentOptions {
    animationMapKey: string;
    animations?: Animation[];
}
export declare function builder(options: AnimationMapOptions): AnimationMapT;
export declare const AnimationMapSerializer: ComponentSerializer;
//# sourceMappingURL=data.d.ts.map