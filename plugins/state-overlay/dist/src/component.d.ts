import { State } from '../vendor/state-street/index.js';
import type { ComponentData, ComponentOptions, ComponentTypeDefinition } from 'omosuen';
/**
 * A State Street configuration bundle: the same four arguments State Street's
 * constructor takes. Registered by key (see {@link registerStateBundle}) and
 * referenced from a state-overlay component's `bundleKey` — mirrors how the
 * built-in ui-overlay references a registered HTML constructor by key.
 */
export interface StateBundle {
    template: string;
    data?: Record<string, any>;
    components?: Record<string, (ctx: any) => string>;
    methods?: Record<string, (ctx: any) => void | string>;
}
/**
 * Registers a State Street UI bundle under a key. Call before the scene that
 * uses a state-overlay with this `bundleKey` is loaded.
 */
export declare function registerStateBundle(key: string, bundle: StateBundle): void;
export interface StateOverlayOptions extends ComponentOptions {
    bundleKey?: string;
    cssOverrides?: Record<string, string>;
}
export interface StateOverlayT extends ComponentData {
    type: 'state-overlay';
    container: HTMLElement;
    bundleKey?: string;
    cssOverrides: Record<string, string>;
    state: State | null;
    _stateBuilt: boolean;
}
/**
 * The full plugin definition. Pass to `Omosuen.init({ plugins: [stateOverlayDefinition] })`
 * (TS path) or register it from a self-registering JS file (see browser.ts).
 */
export declare const stateOverlayDefinition: ComponentTypeDefinition;
