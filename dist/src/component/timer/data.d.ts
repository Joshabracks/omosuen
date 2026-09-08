import { ComponentData, ComponentOptions, ComponentSerializer, ComponentUnique, ComponentInstanceMethods } from '../types';
import type { TimerMethods } from './methods';
export interface TimerT extends ComponentData, ComponentInstanceMethods<TimerMethods> {
    type: 'timer';
    unique: ComponentUnique.FALSE;
    time: number;
    speed: number;
    duration: number;
    repeat: number | boolean;
    destroy: boolean;
    running: boolean;
    events: Set<string>;
}
export interface TimerOptions extends ComponentOptions {
    time?: number;
    speed?: number;
    duration: number;
    repeat?: number | boolean;
    destroy?: boolean;
    events?: string[];
}
export declare function builder(options: TimerOptions): TimerT;
export declare const TimerSerializer: ComponentSerializer;
export declare const PROPERTY_ALLOWLIST: string[];
//# sourceMappingURL=data.d.ts.map