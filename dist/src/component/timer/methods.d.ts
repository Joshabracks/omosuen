import { ComponentData, ComponentMethods } from '../types';
import { TimerT } from './data';
export interface TimerMethods extends ComponentMethods {
    type: 'timer';
    init: (component: ComponentData) => Promise<void>;
    update: (component: ComponentData, deltaTime: number) => void;
    dispose: (component: ComponentData) => void;
    setTime: (timer: TimerT, time: number) => void;
    getTime: (timer: TimerT) => number;
    setSpeed: (timer: TimerT, speed: number) => void;
    getSpeed: (timer: TimerT) => number;
    setDuration: (timer: TimerT, duration: number) => void;
    getDuration: (timer: TimerT) => number;
    setRepeat: (timer: TimerT, repeat: number | boolean) => void;
    getRepeat: (timer: TimerT) => number | boolean;
    addEvent: (timer: TimerT, key: string) => void;
    removeEvent: (timer: TimerT, key: string) => void;
    start: (timer: TimerT) => void;
    stop: (timer: TimerT) => void;
    restart: (timer: TimerT) => void;
}
export declare const Timer: TimerMethods;
//# sourceMappingURL=methods.d.ts.map