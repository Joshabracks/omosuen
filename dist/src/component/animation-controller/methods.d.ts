import { ComponentData, ComponentMethods } from '../types';
import { AnimationControllerT } from './data';
import type { Animation, AnimationLayer, AnimationState } from './types';
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
    setLayerVisible: (controller: AnimationControllerT, layerName: string, visible: boolean) => void;
    addLayer: (controller: AnimationControllerT, layer: AnimationLayer) => void;
    getLayer: (controller: AnimationControllerT, layerName: string) => AnimationLayer | null;
    getLayers: (controller: AnimationControllerT) => AnimationLayer[];
}
export declare const AnimationController: AnimationControllerMethods;
//# sourceMappingURL=methods.d.ts.map