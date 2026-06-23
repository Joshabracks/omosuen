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
import { AudioTrackSerializer } from '../component/audio-track/data';
import { AudioEffectSerializer } from '../component/audio-effect/data';
import { AudioPlayerSerializer } from '../component/audio-player/data';
import { AnimationControllerSerializer } from '../component/animation-controller/data';
import { AtlasManagerSerializer } from '../component/atlas-manager/data';
import { TextureMapSerializer } from '../component/texture-map/data';
import { CellMapSerializer } from '../component/cell-map/data';
import { Nexus } from '../component/nexus/methods';
import { getSceneEntry, hasScene } from './registry';
import type {
  ComponentData,
  ComponentSerializer,
  COMPONENT_TYPE,
  DeserializationError,
  DeserializeResult,
} from '../component/types';
import {
  resetComponentCount,
  setComponentCount,
  wrapInProxy,
} from '../component/types';
import { queueInit } from '../loop/init';
import { registerMethod, getPluginSerializer } from '../component/registry';

/**
 * Registry of component serializers, keyed by component type.
 * Nexus is excluded — it requires special recursive child handling.
 */
const SERIALIZERS: Partial<Record<COMPONENT_TYPE, ComponentSerializer>> = {
  'ui-overlay': UIOverlaySerializer,
  'data-layer': DataLayerSerializer,
  'flag-manager': FlagManagerSerializer,
  viewport: ViewportSerializer,
  camera: CameraSerializer,
  transform: TransformSerializer,
  sprite: SpriteSerializer,
  collider: ColliderSerializer,
  'event-collider': EventColliderSerializer,
  light: LightSerializer,
  timer: TimerSerializer,
  messenger: MessengerSerializer,
  'input-controller': InputControllerSerializer,
  'audio-track': AudioTrackSerializer,
  'audio-effect': AudioEffectSerializer,
  'audio-player': AudioPlayerSerializer,
  'animation-controller': AnimationControllerSerializer,
  'atlas-manager': AtlasManagerSerializer,
  'texture-map': TextureMapSerializer,
  'cell-map': CellMapSerializer,
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
    const importPath =
      (modulePath.startsWith('/') ? '' : '/') +
      modulePath.replace(/\.ts$/, '.js');
    const module = await importFunc(importPath);

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

    // Recursively serialize all child components. Skip loader-generated
    // children (e.g. the sprites/controller/texture-maps an `aseprite` component
    // builds on init): they are regenerated from the source declaration on load,
    // so persisting them would duplicate components and bloat the scene.
    for (const child of nexus.components) {
      if (child._generated) continue;
      serializedChildren.push(serializeComponentRecursive(child));
    }

    componentData = {
      type: 'nexus',
      name: nexus.name,
      unique: nexus.unique,
      components: serializedChildren,
    };
  } else {
    const serializer =
      SERIALIZERS[component.type] ?? getPluginSerializer(component.type);
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
    initOverride: component.initOverride,
    loader: component.loader,
  };
}

/**
 * Loads a script module for a nexus component.
 * Dynamically imports the script file and registers its exported init/update
 * functions in MethodRegistry under keys derived from the filename.
 *
 * @param nexus - The nexus component with a script field
 */
export async function loadScript(nexus: NexusT): Promise<void> {
  if (!nexus.script) return;

  const scriptPath = nexus.script as string;
  const importPath = '/' + scriptPath.replace(/\.ts$/, '.js');

  // Import the module
  const importFunc = new Function('modulePath', 'return import(modulePath)');
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const module = await importFunc(importPath);

  if (!module || typeof module !== 'object') {
    console.error(
      `[SCENE LOADER ERROR] Script "${scriptPath}" for nexus "${nexus.name}" did not return a valid module`,
    );
    return;
  }

  // Derive registry keys from filename
  const filename = scriptPath.split('/').pop() || scriptPath;
  const baseName = filename
    .replace(/\.omo\.(ts|js)$/, '')
    .replace(/\.(ts|js)$/, '');

  if (!baseName) {
    console.error(
      `[SCENE LOADER ERROR] Could not derive base name from script path "${scriptPath}" for nexus "${nexus.name}"`,
    );
    return;
  }

  // Register exports
  let registered = false;

  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  if (typeof module.init === 'function') {
    const key = `${baseName}-init`;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    registerMethod('nexus', key, module.init);
    nexus.initOverride = key;
    registered = true;
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  if (typeof module.update === 'function') {
    const key = `${baseName}-update`;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    registerMethod('nexus', key, module.update);
    nexus.updateOverride = key;
    registered = true;
  }

  if (!registered) {
    console.warn(
      `[SCENE LOADER WARNING] Script "${scriptPath}" for nexus "${nexus.name}" exports neither init() nor update()`,
    );
    return;
  }

  console.info(
    `[SCENE LOADER] Script "${scriptPath}" loaded for nexus "${nexus.name}"`,
  );
}

/**
 * Recursively deserializes a component and its children.
 * Restores generic ComponentData fields and tracks max ID for counter reset.
 *
 * Returns `{ component, errors }`:
 *   - `component`: the Proxy-wrapped component, or null if deserialization
 *     produced no usable object (unknown type, missing required identity
 *     fields, catastrophic exception).
 *   - `errors`: every structured problem encountered in this subtree. For
 *     a nexus root this includes the nexus's own errors *plus* all errors
 *     from recursively-deserialized children, flattened into one array.
 *
 * @param data - Serialized component data
 * @param maxId - Track the maximum ID seen during deserialization (passed by reference via object)
 */

export async function deserializeComponentRecursive(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any,
  maxId: { value: number } = { value: -1 },
): Promise<DeserializeResult<ComponentData>> {
  try {
    if (!data || typeof data !== 'object') {
      return {
        component: null,
        errors: [
          {
            code: 'INVALID_DATA',
            message: 'deserializeComponentRecursive received non-object data',
          },
        ],
      };
    }

    const errors: DeserializationError[] = [];

    // Call component-specific deserializer
    if (data.type === 'nexus') {
      const nexusResult = await Promise.resolve(
        NexusSerializer.deserialize(data),
      );
      errors.push(...nexusResult.errors);
      if (!nexusResult.component) {
        return { component: null, errors };
      }
      const nexusComp = nexusResult.component as NexusT;

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
      if (data.initOverride !== undefined) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
        nexusComp.initOverride = data.initOverride;
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (data.loader !== undefined) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
        nexusComp.loader = data.loader;
      }

      // Load script module before wrapping (registers methods in MethodRegistry)
      await loadScript(nexusComp);

      // Wrap in proxy BEFORE adding children so child.parent = proxy
      const proxy = wrapInProxy(nexusComp);
      if (nexusComp.id !== undefined) {
        queueInit(nexusComp.id);
      }

      // Recursively deserialize children. Collect ALL their errors — even
      // errors from children whose own component could not be constructed.
      if (data.components && Array.isArray(data.components)) {
        for (const childData of data.components) {
          const childResult = await deserializeComponentRecursive(
            childData,
            maxId,
          );
          errors.push(...childResult.errors);
          if (childResult.component) {
            Nexus.addComponent(proxy as NexusT, childResult.component);
          }
        }
      }

      return { component: proxy, errors };
    }

    // Non-nexus component
    const serializer =
      SERIALIZERS[data.type as COMPONENT_TYPE] ??
      getPluginSerializer(data.type as string);
    if (!serializer) {
      errors.push({
        code: 'UNKNOWN_COMPONENT_TYPE',
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        message: `Unknown component type: ${data.type}`,
      });
      return { component: null, errors };
    }

    const result = await Promise.resolve(serializer.deserialize(data));
    errors.push(...result.errors);
    const component = result.component;
    if (!component) {
      return { component: null, errors };
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
    if (data.initOverride !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      component.initOverride = data.initOverride;
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

    return { component: proxy, errors };
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? `${error.message}\n${error.stack || ''}`
        : String(error);
    console.error(
      `[SCENE LOADER ERROR] Failed to deserialize component: ${errorMessage}`,
    );
    return {
      component: null,
      errors: [
        {
          code: 'DESERIALIZE_EXCEPTION',
          message: `Unexpected exception during deserialization: ${errorMessage}`,
        },
      ],
    };
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
    const result = await deserializeComponentRecursive(data, maxId);

    // Surface any accumulated errors to the console so the failure mode is
    // visible even when the top-level component did come back non-null.
    if (result.errors.length > 0) {
      for (const err of result.errors) {
        const suffix =
          err.count !== undefined && err.count > 1 ? ` (×${err.count})` : '';
        console.warn(`[SCENE LOADER ${err.code}] ${err.message}${suffix}`);
      }
    }

    const scene = result.component as NexusT | null;
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
