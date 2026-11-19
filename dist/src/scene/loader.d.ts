import type { NexusT } from '../component/nexus/data';
import type { ComponentData, DeserializeResult } from '../component/types';
export declare function loadScene(name: string): Promise<NexusT | null>;
export declare function serializeComponentRecursive(component: ComponentData): any;
export declare function loadScript(nexus: NexusT): Promise<void>;
export declare function deserializeComponentRecursive(data: any, maxId?: {
    value: number;
}): Promise<DeserializeResult<ComponentData>>;
export declare function deserializeScene(data: any): Promise<NexusT | null>;
export declare function unloadScene(): void;
export declare function switchScene(name: string): Promise<NexusT | null>;
export declare function getActiveScene(): NexusT | null;
//# sourceMappingURL=loader.d.ts.map