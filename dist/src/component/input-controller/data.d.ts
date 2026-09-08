import { ComponentData, ComponentOptions, ComponentSerializer, ComponentUnique, ComponentInstanceMethods } from '../types';
import type { InputControllerMethods } from './methods';
export type InputEventType = 'keydown' | 'keyup' | 'keypress' | 'mousedown' | 'mouseup' | 'mousemove' | 'click' | 'dblclick' | 'contextmenu' | 'wheel' | 'pointerdown' | 'pointerup' | 'pointermove' | 'pointercancel' | 'touchstart' | 'touchend' | 'touchmove' | 'touchcancel' | 'gamepadconnected' | 'gamepaddisconnected';
export interface ActionBinding {
    eventType: InputEventType;
    key?: string;
    button?: number;
    gamepadButton?: number;
    gamepadAxis?: number;
    action: string;
}
export type ActionCallback = (event?: Event, value?: number) => void;
export interface InputControllerT extends ComponentData, ComponentInstanceMethods<InputControllerMethods> {
    type: 'input-controller';
    unique: ComponentUnique.FALSE;
    bindings: ActionBinding[];
    activeInputs: Set<string>;
    actionCallbacks: Map<string, ActionCallback[]>;
    _eventHandlers: Map<string, EventListener>;
    preventDefault: boolean;
    target: EventTarget;
}
export interface InputControllerOptions extends ComponentOptions {
    bindings?: ActionBinding[];
    preventDefault?: boolean;
    target?: EventTarget;
}
export declare function builder(options: InputControllerOptions): InputControllerT;
export declare const InputControllerSerializer: ComponentSerializer;
export declare const PROPERTY_ALLOWLIST: string[];
//# sourceMappingURL=data.d.ts.map