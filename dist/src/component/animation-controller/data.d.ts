import { ComponentData, ComponentOptions, ComponentSerializer, ComponentUnique, ComponentInstanceMethods } from '../types';
import type { AnimationControllerMethods } from './methods';
import type { Animation, AnimationLayer, AnimationState } from './types';
import type { ChannelType } from '../sprite/types';
import type { SpriteT } from '../sprite/data';
export interface AnimationControllerT extends ComponentData, ComponentInstanceMethods<AnimationControllerMethods> {
    type: 'animation-controller';
    unique: ComponentUnique.LOCAL;
    animations: Map<string, Animation>;
    state: AnimationState;
    currentAnimation: string | null;
    currentFrameIndex: number;
    frameTime: number;
    speed: number;
    channels: ChannelType[];
    layers: AnimationLayer[];
    _layerSprites?: (SpriteT | null)[];
}
export interface AnimationControllerOptions extends ComponentOptions {
    animations?: Animation[];
    channels?: ChannelType[];
    speed?: number;
    layers?: AnimationLayer[];
}
export declare function builder(options: AnimationControllerOptions): AnimationControllerT;
export declare const AnimationControllerSerializer: ComponentSerializer;
export declare const PROPERTY_ALLOWLIST: string[];
//# sourceMappingURL=data.d.ts.map