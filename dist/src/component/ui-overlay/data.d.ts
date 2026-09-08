import { ComponentData, ComponentOptions, ComponentSerializer, ComponentUnique, ComponentInstanceMethods } from '../types';
import type { UIOverlayMethods } from './methods';
type UIAction = 'click' | 'dblclick' | 'mousedown' | 'mouseup' | 'mousemove' | 'mouseenter' | 'mouseleave' | 'mouseover' | 'mouseout' | 'contextmenu' | 'keydown' | 'keyup' | 'keypress' | 'focus' | 'blur' | 'focusin' | 'focusout' | 'input' | 'change' | 'submit' | 'reset' | 'invalid' | 'touchstart' | 'touchend' | 'touchmove' | 'touchcancel' | 'pointerdown' | 'pointerup' | 'pointermove' | 'pointerenter' | 'pointerleave' | 'pointerover' | 'pointerout' | 'pointercancel' | 'gotpointercapture' | 'lostpointercapture' | 'drag' | 'dragstart' | 'dragend' | 'dragenter' | 'dragleave' | 'dragover' | 'drop' | 'wheel' | 'animationstart' | 'animationend' | 'animationiteration' | 'transitionstart' | 'transitionend' | 'transitionrun' | 'transitioncancel' | 'copy' | 'cut' | 'paste' | 'select' | 'selectstart' | 'scroll' | 'resize' | 'load' | 'error' | 'abort' | 'play' | 'pause' | 'ended' | 'volumechange' | 'timeupdate' | 'canplay' | 'canplaythrough' | 'durationchange' | 'loadeddata' | 'loadedmetadata' | 'loadstart' | 'progress' | 'ratechange' | 'seeked' | 'seeking' | 'stalled' | 'suspend' | 'waiting';
export interface UIBinding {
    selector: string;
    onActions: UIAction[];
    methodKey: string;
    _methodFunc?: Function;
}
export interface UIOverlayT extends ComponentData, ComponentInstanceMethods<UIOverlayMethods> {
    type: 'ui-overlay';
    unique: ComponentUnique.FALSE;
    element: HTMLDivElement | null;
    bindings: UIBinding[];
    cssOverrides: Record<string, string>;
    previousOverlayId?: number;
    container: HTMLElement;
    showOverride?: string;
    hideOverride?: string;
    htmlConstructorKey?: string;
    _htmlConstructed: boolean;
}
export interface UIOverlayOptions extends ComponentOptions {
    htmlConstructorKey?: string;
    cssOverrides?: Record<string, string>;
    bindings?: UIBinding[];
    previousOverlayId?: number;
}
export declare function builder(options: UIOverlayOptions): UIOverlayT;
export declare const UIOverlaySerializer: ComponentSerializer;
export declare const PROPERTY_ALLOWLIST: string[];
export {};
//# sourceMappingURL=data.d.ts.map