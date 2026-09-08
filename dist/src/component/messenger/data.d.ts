import { ComponentData, ComponentOptions, ComponentSerializer, ComponentUnique, ComponentInstanceMethods } from '../types';
import type { MessengerMethods } from './methods';
import type { ListenerConfig } from './types';
export interface MessengerT extends ComponentData, ComponentInstanceMethods<MessengerMethods> {
    type: 'messenger';
    unique: ComponentUnique.FALSE;
    listeners: ListenerConfig[];
}
export interface MessengerOptions extends ComponentOptions {
    listeners?: ListenerConfig[];
}
export declare function builder(options: MessengerOptions): MessengerT;
export declare const MessengerSerializer: ComponentSerializer;
export declare const PROPERTY_ALLOWLIST: string[];
//# sourceMappingURL=data.d.ts.map