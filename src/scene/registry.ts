import type { nexus } from '../component/nexus/data';

/**
 * Internal type for tracking scene source types
 */
type SceneSourceType = 'memory' | 'module' | 'serialized';

/**
 * Internal registry entry structure
 */
interface SceneRegistryEntry {
  type: SceneSourceType;
  source: nexus | string; // nexus for memory, string path for module/serialized
}

/**
 * Scene registry - maps scene names to their sources
 */
const sceneRegistry = new Map<string, SceneRegistryEntry>();

/**
 * Registers a pre-built nexus component as a scene that's immediately available.
 * Use this for small games or frequently-used scenes like main menus.
 *
 * @param name - Unique identifier for the scene
 * @param scene - Root nexus component for the scene (parent should be null)
 *
 * @example
 * ```typescript
 * const mainMenu = await newComponent("nexus", { name: "MainMenuRoot" });
 * registerScene("MainMenu", mainMenu);
 * ```
 */
export function registerScene(name: string, scene: nexus): void {
  if (sceneRegistry.has(name)) {
    console.error(
      `[SCENE REGISTRY ERROR] Scene "${name}" is already registered`,
    );
    return;
  }

  if (scene.parent !== null) {
    console.warn(
      `[SCENE REGISTRY WARNING] Scene "${name}" has a non-null parent. Scenes should be root-level nexus components.`,
    );
  }

  sceneRegistry.set(name, {
    type: 'memory',
    source: scene,
  });

  console.info(`[SCENE REGISTRY] Scene "${name}" registered (memory)`);
}

/**
 * Registers a JavaScript module path as a scene source.
 * The module will be loaded dynamically when the scene is first requested.
 * Use this for medium/large games to enable code-splitting.
 *
 * Module Requirements:
 * - Must export a default nexus component, OR
 * - Must export a function that returns a nexus (sync or async), OR
 * - Must export a `createScene()` function that returns a nexus
 *
 * @param name - Unique identifier for the scene
 * @param modulePath - Path to the JavaScript module file
 *
 * @example
 * ```typescript
 * registerSceneModule("Level1", "./scenes/level1.js");
 * ```
 */
export function registerSceneModule(name: string, modulePath: string): void {
  if (sceneRegistry.has(name)) {
    console.error(
      `[SCENE REGISTRY ERROR] Scene "${name}" is already registered`,
    );
    return;
  }

  sceneRegistry.set(name, {
    type: 'module',
    source: modulePath,
  });

  console.info(
    `[SCENE REGISTRY] Scene "${name}" registered (module: ${modulePath})`,
  );
}

/**
 * Registers a serialized file path as a scene source.
 * The file will be fetched and deserialized when the scene is first requested.
 * Use this for large games, save/load systems, or user-generated content.
 *
 * File Requirements:
 * - Must be valid JSON containing a serialized nexus component
 * - Will be deserialized using the existing NexusSerializer
 *
 * @param name - Unique identifier for the scene
 * @param filePath - Path or URL to the JSON file
 *
 * @example
 * ```typescript
 * registerSceneSerialized("Level1", "/scenes/level1.json");
 * registerSceneSerialized("SavedGame", "/saves/player-save-1.json");
 * ```
 */
export function registerSceneSerialized(name: string, filePath: string): void {
  if (sceneRegistry.has(name)) {
    console.error(
      `[SCENE REGISTRY ERROR] Scene "${name}" is already registered`,
    );
    return;
  }

  sceneRegistry.set(name, {
    type: 'serialized',
    source: filePath,
  });

  console.info(
    `[SCENE REGISTRY] Scene "${name}" registered (serialized: ${filePath})`,
  );
}

/**
 * Checks if a scene is registered with the given name.
 *
 * @param name - Scene name to check
 * @returns True if the scene is registered, false otherwise
 *
 * @example
 * ```typescript
 * if (hasScene("Level1")) {
 *   await switchScene("Level1");
 * }
 * ```
 */
export function hasScene(name: string): boolean {
  return sceneRegistry.has(name);
}

/**
 * Gets the registry entry for a scene (internal use only).
 * Returns the entry or null if not found.
 *
 * @internal
 */
export function getSceneEntry(name: string): SceneRegistryEntry | null {
  return sceneRegistry.get(name) ?? null;
}

/**
 * Lists all registered scene names.
 *
 * @returns Array of scene names
 *
 * @example
 * ```typescript
 * const scenes = listScenes();
 * console.log(`Available scenes: ${scenes.join(", ")}`);
 * ```
 */
export function listScenes(): string[] {
  return Array.from(sceneRegistry.keys());
}

/**
 * Unregisters a scene from the registry.
 * Note: This does NOT unload the scene if it's currently active.
 * Use `unloadScene()` or `switchScene()` to unload scenes.
 *
 * @param name - Scene name to unregister
 *
 * @example
 * ```typescript
 * unregisterScene("OldLevel");
 * ```
 */
export function unregisterScene(name: string): void {
  if (!sceneRegistry.has(name)) {
    console.warn(`[SCENE REGISTRY WARNING] Scene "${name}" is not registered`);
    return;
  }

  sceneRegistry.delete(name);
  console.info(`[SCENE REGISTRY] Scene "${name}" unregistered`);
}
