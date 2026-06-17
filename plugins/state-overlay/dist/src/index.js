// omosuen-state-overlay — public ESM entry.
//
// Strict/bundler consumers: pass `stateOverlayDefinition` to the engine's
// `plugins` init option, or call `registerStateOverlay()` once after the engine
// is initialized. Register UI bundles with `registerStateBundle(key, bundle)`.
import { registerPluginComponent } from 'omosuen';
import { stateOverlayDefinition } from './component.js';
export { stateOverlayDefinition, registerStateBundle, } from './component.js';
/**
 * Convenience: register the `state-overlay` component type with the engine.
 * Equivalent to passing `stateOverlayDefinition` in `Omosuen.init({ plugins })`.
 */
export function registerStateOverlay() {
    registerPluginComponent(stateOverlayDefinition);
}
