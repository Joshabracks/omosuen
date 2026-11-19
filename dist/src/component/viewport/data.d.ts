import { ComponentData, ComponentOptions, ComponentSerializer, ComponentUnique, ComponentInstanceMethods } from '../types';
import { Vector4D } from '../../math';
import type { ViewportMethods } from './methods';
export interface ViewportT extends ComponentData, ComponentInstanceMethods<ViewportMethods> {
    type: 'viewport';
    unique: ComponentUnique.FALSE;
    width: number;
    height: number;
    offsetX: number;
    offsetY: number;
    backgroundColor: Vector4D;
    canvas: HTMLCanvasElement | null;
    gl: WebGL2RenderingContext | null;
    container: HTMLElement;
    autoResize: boolean;
}
export interface ViewportOptions extends ComponentOptions {
    width?: number;
    height?: number;
    offsetX?: number;
    offsetY?: number;
    backgroundColor?: Vector4D;
    autoResize?: boolean;
}
export declare function builder(options: ViewportOptions): ViewportT;
export declare const ViewportSerializer: ComponentSerializer;
export declare const PROPERTY_ALLOWLIST: string[];
//# sourceMappingURL=data.d.ts.map