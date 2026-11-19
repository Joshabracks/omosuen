import type { ComponentData } from './types';
export declare function isTypeOptedIn(type: string): boolean;
export declare function registerByType(component: ComponentData): void;
export declare function unregisterByType(component: ComponentData): void;
export declare function getTypeRegistrySet(type: string): ReadonlySet<ComponentData>;
export declare function sameComponent(a: ComponentData | null, b: ComponentData | null): boolean;
export declare function isWithinSubtree(candidate: ComponentData, n: ComponentData): boolean;
export declare function registerByName(component: ComponentData): void;
export declare function unregisterByName(component: ComponentData): void;
export declare function getRegisteredByName(name: string): readonly ComponentData[];
//# sourceMappingURL=component-lookup-registry.d.ts.map