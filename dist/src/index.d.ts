export { stateOverlayDefinition, registerStateBundle, } from './component.js';
export type { StateBundle, StateOverlayT, StateOverlayOptions, } from './component.js';
/**
 * Convenience: register the `state-overlay` component type with the engine.
 * Equivalent to passing `stateOverlayDefinition` in `Omosuen.init({ plugins })`.
 */
export declare function registerStateOverlay(): void;
