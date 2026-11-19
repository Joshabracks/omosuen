import { ComponentData, ComponentOptions, ComponentSerializer, ComponentUnique, ComponentInstanceMethods } from '../types';
import { Vector3D } from '../../math';
import type { ColliderT } from '../collider/data';
import type { EventColliderMethods } from './methods';
export interface EventColliderT extends ComponentData, ComponentInstanceMethods<EventColliderMethods> {
    type: 'event-collider';
    unique: ComponentUnique.FALSE;
    shape: 'box' | 'sphere';
    size: Vector3D;
    radius: number;
    offset: Vector3D;
    triggers: Record<number, boolean>;
    onEnter: ((collider: ColliderT) => void) | null;
    onExit: ((collider: ColliderT) => void) | null;
    while: ((collider: ColliderT, deltaTime: number) => void) | null;
}
export interface EventColliderOptions extends ComponentOptions {
    shape?: 'box' | 'sphere';
    size?: Vector3D;
    radius?: number;
    offset?: Vector3D;
}
export declare function builder(options: EventColliderOptions): EventColliderT;
export declare const EventColliderSerializer: ComponentSerializer;
export declare const PROPERTY_ALLOWLIST: string[];
//# sourceMappingURL=data.d.ts.map