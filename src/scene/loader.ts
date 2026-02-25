import type { NexusT } from '../component/nexus/data';
import { NexusSerializer } from '../component/nexus/data';
import { UIOverlaySerializer } from '../component/ui-overlay/data';
import { DataLayerSerializer } from '../component/data-layer/data';
import { FlagManagerSerializer } from '../component/flag-manager/data';
import { ViewportSerializer } from '../component/viewport/data';
import { CameraSerializer } from '../component/camera/data';
import { TransformSerializer } from '../component/transform/data';
import { SpriteSerializer } from '../component/sprite/data';
import { ColliderSerializer } from '../component/collider/data';
import { EventColliderSerializer } from '../component/event-collider/data';
import { LightSerializer } from '../component/light/data';
import { TimerSerializer } from '../component/timer/data';
import { MessengerSerializer } from '../component/messenger/data';
import { InputControllerSerializer } from '../component/input-controller/data';
import { AudioManagerSerializer } from '../component/audio-manager/data';
import { AudioControllerSerializer } from '../component/audio-controller/data';
import { AnimationControllerSerializer } from '../component/animation-controller/data';
import { AtlasManagerSerializer } from '../component/atlas-manager/data';
import { Nexus } from '../component/nexus/methods';
import { getSceneEntry, hasScene } from './registry';
import type { ComponentData, ComponentSerializer, COMPONENT_TYPE } from '../component/types';
import { resetComponentCount, setComponentCount, wrapInProxy } from '../component/types';
import { queueInit } from '../loop/init';

/**
 * Registry of component serializers, keyed by component type.
 * Nexus is excluded — it requires special recursive child handling.
 */
const SERIALIZERS: Partial<Record<COMPONENT_TYPE, ComponentSerializer>> = {
  'ui-overlay': UIOverlaySerializer,
  'data-layer': DataLayerSerializer,
  'flag-manager': FlagManagerSerializer,
  'viewport': ViewportSerializer,
  'camera': CameraSerializer,
  'transform': TransformSerializer,
  'sprite': SpriteSerializer,
  'collider': ColliderSerializer,
  'event-collider': EventColliderSerializer,
  'light': LightSerializer,
  'timer': TimerSerializer,
  'messenger': MessengerSerializer,
  'input-controller': InputControllerSerializer,
  'audio-manager': AudioManagerSerializer,
  'audio-controller': AudioControllerSerializer,
  'animation-controller': AnimationControllerSerializer,
  'atlas-manager': AtlasManagerSerializer,
};

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
    const errorMessage =
      error instanceof Error
        ? `${error.message}\n${error.stack || ''}`
        : String(error);
    console.error(
      `[SCENE LOADER ERROR] Failed to import module "${modulePath}": ${errorMessage}`,
    );
    return null;
  }
}

/**
 * Recursively serializes a component and its children.
 * Handles all component types by calling their respective serializers.
 *
 * @param component - Component to serialize (usually a nexus root)
 * @returns Plain object suitable for JSON.stringify()
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function serializeComponentRecursive(component: ComponentData): any {
  // Get component-specific serialized data
  let componentData;

  if (component.type === 'nexus') {
    const nexus = component as NexusT;
    const serializedChildren = [];

    // Recursively serialize all child components
    for (const child of nexus.components) {
      serializedChildren.push(serializeComponentRecursive(child));
    }

    componentData = {
      type: 'nexus',
      name: nexus.name,
      unique: nexus.unique,
      components: serializedChildren,
    };
  } else {
    const serializer = SERIALIZERS[component.type];
    if (serializer) {
      componentData = serializer.serialize(component);
    } else {
      console.warn(
        `[SCENE LOADER] Unknown component type for serialization: ${component.type}`,
      );
      componentData = {
        type: component.type,
        name: component.name,
      };
    }
  }

  // Merge generic ComponentData fields with component-specific data
  return {
    ...componentData,
    // Generic fields (overwrite component-specific if they set them)
    id: component.id,
    overrideKey: component.overrideKey,
    updateOverride: component.updateOverride,
    loader: component.loader,
  };
}

/**
 * Recursively deserializes a component and its children.
 * Restores generic ComponentData fields and tracks max ID for counter reset.
 *
 * @param data - Serialized component data
 * @param maxId - Track the maximum ID seen during deserialization (passed by reference via object)
 * @returns Deserialized component or null on error
 */

export function deserializeComponentRecursive(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any,
  maxId: { value: number } = { value: -1 },
): ComponentData | null {
  try {
    let component: ComponentData | null = null;

    // Call component-specific deserializer
    if (data.type === 'nexus') {
      // Deserialize the nexus itself (creates empty nexus)
      const nexusComp = NexusSerializer.deserialize(data) as NexusT;

      // Restore generic fields BEFORE wrapping so the proxy has them
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (typeof data.id === 'number') {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
        nexusComp.id = data.id;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        if (data.id > maxId.value) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
          maxId.value = data.id;
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (data.overrideKey !== undefined) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
        nexusComp.overrideKey = data.overrideKey;
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (data.updateOverride !== undefined) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
        nexusComp.updateOverride = data.updateOverride;
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (data.loader !== undefined) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
        nexusComp.loader = data.loader;
      }

      // Wrap in proxy BEFORE adding children so child.parent = proxy
      const proxy = wrapInProxy(nexusComp);
      if (nexusComp.id !== undefined) {
        queueInit(nexusComp.id);
      }

      // Add children to the PROXY so parent references are correct
      if (data.components && Array.isArray(data.components)) {
        for (const childData of data.components) {
          const child = deserializeComponentRecursive(childData, maxId);
          if (child) {
            Nexus.addComponent(proxy as NexusT, child);
          }
        }
      }

      return proxy;
    } else {
      const serializer =
        SERIALIZERS[data.type as COMPONENT_TYPE];
      if (serializer) {
        component = serializer.deserialize(data) as ComponentData;
      } else {
        console.error(
          `[SCENE LOADER ERROR] Unknown component type: ${data.type}`,
        );
        return null;
      }
    }

    if (!component) {
      return null;
    }

    // Restore generic ComponentData fields
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    if (typeof data.id === 'number') {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      component.id = data.id;
      // Track maximum ID
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (data.id > maxId.value) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
        maxId.value = data.id;
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    if (data.overrideKey !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      component.overrideKey = data.overrideKey;
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    if (data.updateOverride !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      component.updateOverride = data.updateOverride;
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    if (data.loader !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      component.loader = data.loader;
    }

    // Wrap in Proxy for method dispatch (matches newComponent() behavior)
    const proxy = wrapInProxy(component);

    // Queue for initialization (viewport creates canvas, camera sets up GL, etc.)
    if (component.id !== undefined) {
      queueInit(component.id);
    }

    return proxy;
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? `${error.message}\n${error.stack || ''}`
        : String(error);
    console.error(
      `[SCENE LOADER ERROR] Failed to deserialize component: ${errorMessage}`,
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
    // Reset component ID counter before deserialization
    resetComponentCount();

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

    // Track maximum ID during deserialization
    const maxId = { value: -1 };

    // Recursively deserialize the entire scene hierarchy
    const scene = deserializeComponentRecursive(data, maxId) as NexusT;

    if (!scene || scene.type !== 'nexus') {
      console.error(
        `[SCENE LOADER ERROR] Deserialized data from "${filePath}" is not a valid nexus component`,
      );
      return null;
    }

    // Set component counter to continue from max deserialized ID
    if (maxId.value >= 0) {
      setComponentCount(maxId.value + 1);
      console.info(
        `[SCENE LOADER] Component ID counter set to ${maxId.value + 1} (highest deserialized ID: ${maxId.value})`,
      );
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
