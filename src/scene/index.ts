/**
 * Scene Management System
 *
 * A minimal system for registering and managing game scenes.
 * Scenes are simply root-level nexus components that can be loaded
 * from memory, JavaScript modules, or serialized files.
 */

// ============================================================================
// Registry Functions
// ============================================================================
export {
  registerScene,
  registerSceneModule,
  registerSceneSerialized,
  hasScene,
  listScenes,
  unregisterScene,
} from "./registry";

// ============================================================================
// Loader Functions
// ============================================================================
export {
  loadScene,
  unloadScene,
  switchScene,
  getActiveScene,
} from "./loader";
