import { NexusT } from './nexus';
export declare function castTo<T>(component: ComponentData): T;
export declare function resetComponentCount(): void;
export declare function setComponentCount(count: number): void;
export declare enum ComponentUnique {
    FALSE = 0,
    LOCAL = 1,
    GLOBAL = 2,
    NAME = 3
}
export type COMPONENT_TYPE = 'nexus' | 'ui-overlay' | 'data-layer' | 'flag-manager' | 'fog-of-war' | 'messenger' | 'viewport' | 'texture-map' | 'atlas-manager' | 'sprite' | 'transform' | 'animation-controller' | 'animation-map' | 'cell-map' | 'camera' | 'input-controller' | 'collider' | 'event-collider' | 'timer' | 'speed-dial' | 'light' | 'vision-source' | 'audio-track' | 'audio-effect' | 'audio-player';
export interface ComponentOptions {
    name: string;
    overrideKey?: string;
    updateOverride?: string;
    initOverride?: string;
}
export interface ComponentData {
    name: string;
    type: COMPONENT_TYPE;
    id?: number;
    parent: ComponentData | null;
    _disposed?: boolean;
    loader?: boolean;
    _generated?: boolean;
    unique?: ComponentUnique;
    overrideKey?: string;
    updateOverride?: string;
    initOverride?: string;
    _initialized?: boolean;
    _initDefer?: number;
    ready?: Promise<boolean>;
    _hasUpdateWork?: boolean;
}
export interface ComponentMethods {
    type: COMPONENT_TYPE;
    dispose?: (component: ComponentData) => void;
    update?: (component: ComponentData, deltaTime: number) => void;
    init?: (component: ComponentData) => Promise<void>;
    initProgressive?: (component: ComponentData) => AsyncGenerator<void>;
}
export type ComponentInstanceMethods<T extends ComponentMethods> = {
    [K in keyof T as K extends 'type' ? never : K]: T[K] extends (first: infer _First, ...args: infer Args) => infer Return ? (...args: Args) => Return : never;
};
export declare function bubbleUpdateWorkTrue(component: ComponentData): void;
export declare function wrapInProxy(component: ComponentData): ComponentData;
export declare function newComponent(type: COMPONENT_TYPE, options: ComponentOptions, parent?: NexusT | null, registerByName?: boolean): Promise<ComponentData | null>;
export type SerializedData = Record<string, any>;
export interface DeserializationError {
    code: string;
    message: string;
    count?: number;
}
export interface DeserializeResult<T = ComponentData> {
    component: T | null;
    errors: DeserializationError[];
}
export interface ComponentSerializer {
    serialize(component: ComponentData): SerializedData;
    deserialize(data: SerializedData): DeserializeResult<ComponentData> | Promise<DeserializeResult<ComponentData>>;
}
//# sourceMappingURL=types.d.ts.map