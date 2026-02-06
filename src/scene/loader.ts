import type { NexusT } from '../component/nexus/data';
import { NexusSerializer } from '../component/nexus/data';
import type { UIOverlayT } from '../component/ui-overlay/data';
import { UIOverlaySerializer } from '../component/ui-overlay/data';
import { getSceneEntry, hasScene } from './registry';
import type { ComponentData } from '../component/types';

/**
 * Currently active scene (root nexus component)
 */
let activeScene: NexusT | null = null;

/**
 * Loads a scene from the registry by name.
 * The scene source type (memory, module, serialized) is determined automatically
 * from the registry entry.
 *
 * @param name - Name of the scene to load
 * @returns Promise that resolves to the loaded nexus component, or null on failure
 *
 * @example
 * ```typescript
 * const scene = await loadScene("Level1");
 * if (scene) {
 *   console.log("Scene loaded successfully");
 * }
 * ```
 */
export async function loadScene(name: string): Promise<NexusT | null> {
  if (!hasScene(name)) {
    console.error(`[SCENE LOADER ERROR] Scene "${name}" is not registered`);
    return null;
  }

  const entry = getSceneEntry(name);
  if (!entry) {
    console.error(
      `[SCENE LOADER ERROR] Failed to retrieve scene "${name}" from registry`,
    );
    return null;
  }

  try {
    switch (entry.type) {
      case 'memory':
        return loadFromMemory(name, entry.source as NexusT);

      case 'module':
        return await loadFromModule(name, entry.source as string);

      case 'serialized':
        return await loadFromSerialized(name, entry.source as string);

      default:
        console.error(
          `[SCENE LOADER ERROR] Unknown scene type for "${name}": ${entry.type}`,
        );
        return null;
    }
  } catch (error) {
    console.error(
      `[SCENE LOADER ERROR] Failed to load scene "${name}":`,
      error,
    );
    return null;
  }
}

/**
 * Loads a scene from memory (pre-built nexus component)
 */
function loadFromMemory(name: string, scene: NexusT): NexusT {
  console.info(`[SCENE LOADER] Loading scene "${name}" from memory`);
  return scene;
}

/**
 * Loads a scene from a JavaScript module using dynamic import
 */
async function loadFromModule(
  name: string,
  modulePath: string,
): Promise<NexusT | null> {
  console.info(
    `[SCENE LOADER] Loading scene "${name}" from module: ${modulePath}`,
  );

  try {
    // Use Function constructor to bypass webpack's static analysis
    // This ensures the import is handled at runtime by the browser, not bundled by webpack
    const importFunc = new Function('modulePath', 'return import(modulePath)');
    const module = await importFunc(modulePath);

    // Try different export patterns
    let scene: NexusT | null = null;

    // Pattern 1: Default export is a nexus
    if (module.default && module.default.type === 'nexus') {
      scene = module.default as NexusT;
    }
    // Pattern 2: Default export is a function that returns a nexus
    else if (typeof module.default === 'function') {
      const result = await module.default();
      if (result && result.type === 'nexus') {
        scene = result as NexusT;
      }
    }
    // Pattern 3: Named export `createScene` function
    else if (typeof module.createScene === 'function') {
      const result = await module.createScene();
      if (result && result.type === 'nexus') {
        scene = result as NexusT;
      }
    }

    if (!scene) {
      console.error(
        `[SCENE LOADER ERROR] Module "${modulePath}" does not export a valid nexus component. ` +
          `Expected: default export of nexus, function returning nexus, or createScene() function.`,
      );
      return null;
    }

    console.info(
      `[SCENE LOADER] Scene "${name}" loaded successfully from module`,
    );
    return scene;
  } catch (error) {
    console.error(
      `[SCENE LOADER ERROR] Failed to import module "${modulePath}":`,
      error,
    );
    return null;
  }
}

/**
 * Recursively deserializes a component and its children
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deserializeComponentRecursive(data: any): ComponentData | null {
  try {
    if (data.type === 'nexus') {
      // Deserialize the nexus itself (creates empty nexus)
      const nexusComp = NexusSerializer.deserialize(data) as NexusT;

      // Recursively deserialize child components if they exist
      if (data.components && Array.isArray(data.components)) {
        for (const childData of data.components) {
          const child = deserializeComponentRecursive(childData);
          if (child) {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-expect-error
            nexusComp.addComponent(child);
          }
        }
      }

      return nexusComp;
    } else if (data.type === 'ui-overlay') {
      // Deserialize UI Overlay
      return UIOverlaySerializer.deserialize(data) as UIOverlayT;
    } else {
      console.error(
        `[SCENE LOADER ERROR] Unknown component type: ${data.type}`,
      );
      return null;
    }
  } catch (error) {
    console.error(
      `[SCENE LOADER ERROR] Failed to deserialize component:`,
      error,
    );
    return null;
  }
}

/**
 * Loads a scene from a serialized JSON file
 */
async function loadFromSerialized(
  name: string,
  filePath: string,
): Promise<NexusT | null> {
  console.info(`[SCENE LOADER] Loading scene "${name}" from file: ${filePath}`);

  try {
    // Fetch the file
    const response = await fetch(filePath);

    if (!response.ok) {
      console.error(
        `[SCENE LOADER ERROR] Failed to fetch "${filePath}": ${response.status} ${response.statusText}`,
      );
      return null;
    }

    // Parse JSON
    const data = await response.json();

    // Recursively deserialize the entire scene hierarchy
    const scene = deserializeComponentRecursive(data) as NexusT;

    if (!scene || scene.type !== 'nexus') {
      console.error(
        `[SCENE LOADER ERROR] Deserialized data from "${filePath}" is not a valid nexus component`,
      );
      return null;
    }

    console.info(
      `[SCENE LOADER] Scene "${name}" loaded successfully from file`,
    );
    return scene;
  } catch (error) {
    console.error(
      `[SCENE LOADER ERROR] Failed to load serialized scene "${filePath}":`,
      error,
    );
    return null;
  }
}

/**
 * Unloads the currently active scene by disposing its components.
 * After calling this, the active scene will be null.
 *
 * @example
 * ```typescript
 * unloadScene(); // Disposes current scene
 * ```
 */
export function unloadScene(): void {
  if (!activeScene) {
    console.warn('[SCENE LOADER WARNING] No active scene to unload');
    return;
  }

  const sceneName = activeScene.name;
  console.info(`[SCENE LOADER] Unloading scene "${sceneName}"`);

  // Dispose the scene using existing disposal system
  activeScene.dispose();

  // Clear active scene reference
  activeScene = null;

  console.info(`[SCENE LOADER] Scene "${sceneName}" unloaded`);
}

/**
 * Switches to a different scene by unloading the current scene (if any)
 * and loading the new scene. This is the primary method for scene transitions.
 *
 * @param name - Name of the scene to switch to
 * @returns Promise that resolves to the loaded scene, or null on failure
 *
 * @example
 * ```typescript
 * // Simple scene switch
 * await switchScene("Level1");
 *
 * // With error handling
 * const scene = await switchScene("Level1");
 * if (!scene) {
 *   console.error("Failed to load Level1");
 *   await switchScene("MainMenu"); // Fallback
 * }
 * ```
 */
export async function switchScene(name: string): Promise<NexusT | null> {
  console.info(`[SCENE LOADER] Switching to scene "${name}"`);

  // Unload current scene if any
  if (activeScene) {
    unloadScene();
  }

  // Load new scene
  const scene = await loadScene(name);

  if (!scene) {
    console.error(`[SCENE LOADER ERROR] Failed to switch to scene "${name}"`);
    return null;
  }

  // Set as active
  activeScene = scene;

  console.info(`[SCENE LOADER] Scene "${name}" is now active`);
  return scene;
}

/**
 * Gets the currently active scene.
 *
 * @returns The active nexus component, or null if no scene is active
 *
 * @example
 * ```typescript
 * const scene = getActiveScene();
 * if (scene) {
 *   console.log(`Active scene: ${scene.name}`);
 * }
 * ```
 */
export function getActiveScene(): NexusT | null {
  return activeScene;
}
