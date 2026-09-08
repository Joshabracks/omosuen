import { ComponentData, ComponentMethods } from '../types';
import { InputControllerT, ActionBinding, ActionCallback, InputEventType } from './data';
export interface InputControllerMethods extends ComponentMethods {
    init: (component: ComponentData) => Promise<void>;
    update: (component: ComponentData, deltaTime: number) => void;
    dispose: (component: ComponentData) => void;
    bindAction: (ic: InputControllerT, binding: ActionBinding) => void;
    unbindAction: (ic: InputControllerT, action: string, eventType?: InputEventType) => void;
    onAction: (ic: InputControllerT, action: string, callback: ActionCallback) => void;
    offAction: (ic: InputControllerT, action: string, callback?: ActionCallback) => void;
    isActionPressed: (ic: InputControllerT, action: string) => boolean;
    getAxis: (ic: InputControllerT, negative: string, positive: string) => number;
}
export declare const InputController: InputControllerMethods;
//# sourceMappingURL=methods.d.ts.map