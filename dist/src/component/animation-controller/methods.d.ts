import { ComponentData, ComponentMethods } from '../types';
import { AnimationControllerT } from './data';
import type { Animation, AnimationState } from './types';
import type { ChannelType } from '../sprite/types';
export interface AnimationControllerMethods extends ComponentMethods {
    init: (component: ComponentData) => Promise<void>;
    update: (component: ComponentData, deltaTime: number) => void;
    addAnimation: (controller: AnimationControllerT, animation: Animation) => void;
    removeAnimation: (controller: AnimationControllerT, name: string) => void;
    hasAnimation: (controller: AnimationControllerT, name: string) => boolean;
    getAnimation: (controller: AnimationControllerT, name: string) => Animation | null;
    play: (controller: AnimationControllerT, name: string, restart?: boolean) => void;
    pause: (controller: AnimationControllerT) => void;
    resume: (controller: AnimationControllerT) => void;
    stop: (controller: AnimationControllerT) => void;
    getState: (controller: AnimationControllerT) => AnimationState;
    isPlaying: (controller: AnimationControllerT) => boolean;
    getCurrentAnimation: (controller: AnimationControllerT) => string | null;
    getCurrentFrame: (controller: AnimationControllerT) => number;
    setSpeed: (controller: AnimationControllerT, speed: number) => void;
    getSpeed: (controller: AnimationControllerT) => number;
    setChannels: (controller: AnimationControllerT, channels: ChannelType[]) => void;
    getChannels: (controller: AnimationControllerT) => ChannelType[];
}
export declare const AnimationController: AnimationControllerMethods;
//# sourceMappingURL=methods.d.ts.map