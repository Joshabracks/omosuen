/**
 * Omosuen Engine
 * An axonometric game engine with a static z-axis camera.
 */

// ============================================================================
// Component Exports
// ============================================================================
export * from "./component";

// ============================================================================
// Math Exports
// ============================================================================
export * from "./math";

// ============================================================================
// Engine Core
// ============================================================================

/**
 * Engine version
 */
export const version = "0.1.0";

/**
 * Engine name
 */
export const name = "Omosuen";

/**
 * Initialize the Omosuen engine
 */
export function init() {
  console.log(`${name} Engine v${version} initialized`);
}

/**
 * Default export for backward compatibility
 * Contains core engine properties and methods
 */
export default {
  version,
  name,
  init
};
