import type { ComponentData } from '../component/types';
import type { NexusT } from '../component/nexus/data';
export declare function queueDispose(id: number): void;
export declare function markForDisposal(component: ComponentData): void;
export declare function processDisposeQueue(scene: NexusT): void;
export declare function clearDisposeQueue(): void;
export declare function getDisposeQueueSize(): number;
//# sourceMappingURL=dispose.d.ts.map