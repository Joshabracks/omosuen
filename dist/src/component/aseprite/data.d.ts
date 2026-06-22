import { ComponentData, ComponentOptions, ComponentSerializer, ComponentUnique, ComponentInstanceMethods } from '../types';
import type { AsepriteMethods } from './methods';
export interface AsepriteT extends ComponentData, ComponentInstanceMethods<AsepriteMethods> {
    type: 'aseprite';
    unique: ComponentUnique.LOCAL;
    filePath: string;
    flatten: boolean;
    visibleOnly: boolean;
    packageId: string;
    layerSlots?: Record<string, string>;
}
export interface AsepriteOptions extends ComponentOptions {
    filePath: string;
    flatten?: boolean;
    visibleOnly?: boolean;
    packageId?: string;
    layerSlots?: Record<string, string>;
}
export declare function builder(options: AsepriteOptions): AsepriteT;
export declare const AsepriteSerializer: ComponentSerializer;
export declare const PROPERTY_ALLOWLIST: string[];
//# sourceMappingURL=data.d.ts.map