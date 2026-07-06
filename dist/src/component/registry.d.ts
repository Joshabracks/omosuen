import type { COMPONENT_TYPE, ComponentData, ComponentOptions, ComponentMethods, ComponentSerializer } from './types';
export type METHOD_TYPE = 'ui-binding' | 'html-constructor' | 'message-listener';
export declare const BUILDERS: Record<COMPONENT_TYPE, Function>;
export declare const MethodRegistry: Record<COMPONENT_TYPE | METHOD_TYPE, Record<string, any>>;
export declare const PROPERTY_ALLOWLIST: Record<COMPONENT_TYPE, string[]>;
export declare function invalidateMethodCache(): void;
export declare function registerMethod(type: COMPONENT_TYPE | METHOD_TYPE, key: string, func: Function): void;
export declare function unregisterMethod(type: COMPONENT_TYPE | METHOD_TYPE, key: string): void;
export declare function hasMethod(type: COMPONENT_TYPE | METHOD_TYPE, key: string): boolean;
export declare function registerBinding(key: string, func: (e: Event) => void): void;
export declare function getBinding(key: string): ((e: Event) => void) | null;
export declare function hasBinding(key: string): boolean;
export declare function registerHtmlConstructor(key: string, func: (overlay: any) => string): void;
export declare function getHtmlConstructor(key: string): ((overlay: any) => string) | null;
export declare function hasHtmlConstructor(key: string): boolean;
export interface ComponentTypeDefinition {
    type: string;
    builder: (options: ComponentOptions) => ComponentData | Promise<ComponentData>;
    methods: ComponentMethods;
    propertyAllowlist?: string[];
    serializer?: ComponentSerializer;
}
export declare function getPluginSerializer(type: string): ComponentSerializer | undefined;
export declare function registerComponentType(def: ComponentTypeDefinition): void;
export declare function registerPluginComponent(def: ComponentTypeDefinition): void;
export declare function unregisterComponentType(type: string): void;
//# sourceMappingURL=registry.d.ts.map