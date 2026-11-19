import type { NexusT } from '../component/nexus/data';
type SceneSourceType = 'memory' | 'module' | 'serialized';
interface SceneRegistryEntry {
    type: SceneSourceType;
    source: NexusT | string;
}
export declare function registerScene(name: string, scene: NexusT): void;
export declare function registerSceneModule(name: string, modulePath: string): void;
export declare function registerSceneSerialized(name: string, filePath: string): void;
export declare function hasScene(name: string): boolean;
export declare function getSceneEntry(name: string): SceneRegistryEntry | null;
export declare function listScenes(): string[];
export declare function unregisterScene(name: string): void;
export {};
//# sourceMappingURL=registry.d.ts.map