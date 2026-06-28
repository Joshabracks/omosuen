import { ComponentData } from '../component';
import type { NexusT } from '../component/nexus/data';
export declare function queueInit(id: number): void;
export declare function processInitQueue(scene: NexusT, targetFrameTime: number): Promise<void>;
export declare function isInitializing(): boolean;
export declare function getInitializingComponent(): ComponentData | null;
export declare function clearInitQueue(): void;
export declare function getInitQueueSize(): number;
export declare function getInitQueueLength(): number;
//# sourceMappingURL=init.d.ts.map