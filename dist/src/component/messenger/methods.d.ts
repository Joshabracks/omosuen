import { ComponentData, ComponentMethods } from '../types';
import type { MessengerT } from './data';
import type { MessageEnvelope, MessageBody, MessageReceiverOptions, ListenerEntry, ListenerHandle, ALL_MESSAGES, ANY_MESSAGES } from './types';
export declare const MESSAGE_QUEUE: MessageEnvelope[];
export declare const MESSAGE_LISTENERS: Map<number, ListenerEntry[]>;
export interface MessengerMethods extends ComponentMethods {
    send: (m: MessengerT, message: string, receiverOptions: MessageReceiverOptions | null | undefined, body?: MessageBody) => void;
    broadcast: (m: MessengerT, message: string, body?: MessageBody) => void;
    on: (m: MessengerT, pattern: string | RegExp | typeof ALL_MESSAGES | typeof ANY_MESSAGES, callbackKey: string) => ListenerHandle;
    removeListener: (m: MessengerT, handle: ListenerHandle) => void;
    init: (component: ComponentData) => Promise<void>;
    dispose: (component: ComponentData) => void;
}
export declare const Messenger: MessengerMethods;
//# sourceMappingURL=methods.d.ts.map