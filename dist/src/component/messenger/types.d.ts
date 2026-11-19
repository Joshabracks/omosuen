import type { ComponentData, COMPONENT_TYPE } from '../types';
export declare const ALL_MESSAGES: unique symbol;
export declare const ANY_MESSAGES: unique symbol;
export interface ListenerConfig {
    pattern: string | RegExp | typeof ALL_MESSAGES | typeof ANY_MESSAGES;
    callbackKey: string;
}
export type MessageBody = Record<string, unknown>;
export interface MessageEnvelope {
    message: string;
    sender: ComponentData;
    receiver: ComponentData;
    messenger: ComponentData;
    body: MessageBody;
    receiverOptions?: MessageReceiverOptions;
}
export interface MessageReceiverOptions {
    mode: 'match-any' | 'match-all' | 'broadcast';
    names?: string[];
    types?: COMPONENT_TYPE[];
    ids?: number[];
}
export interface ListenerEntry extends ListenerConfig {
    id: number;
    messenger: ComponentData;
}
export interface ListenerHandle {
    id: number;
}
export type MessageCallback = (envelope: MessageEnvelope) => void;
//# sourceMappingURL=types.d.ts.map