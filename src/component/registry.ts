import {
  Nexus,
  builder as nexusBuilder,
  PROPERTY_ALLOWLIST as NexusPropertyAllowlist,
} from './nexus';
import {
  UIOverlay,
  builder as uiOverlayBuilder,
  PROPERTY_ALLOWLIST as UIOverlayPropertyAllowlist,
} from './ui-overlay';
import {
  DataLayer,
  builder as dataLayerBuilder,
  PROPERTY_ALLOWLIST as DataLayerPropertyAllowlist,
} from './data-layer';
import {
  FlagManager,
  builder as flagManagerBuilder,
  PROPERTY_ALLOWLIST as FlagManagerPropertyAllowlist,
} from './flag-manager';
import {
  Messenger,
  builder as messengerBuilder,
  PROPERTY_ALLOWLIST as MessengerPropertyAllowlist,
} from './messenger';
import {
  Viewport,
  builder as viewportBuilder,
  PROPERTY_ALLOWLIST as ViewportPropertyAllowlist,
} from './viewport';
import {
  TextureMap,
  builder as textureMapBuilder,
  PROPERTY_ALLOWLIST as TextureMapPropertyAllowlist,
} from './texture-map';
import {
  AtlasManager,
  builder as atlasManagerBuilder,
  PROPERTY_ALLOWLIST as AtlasManagerPropertyAllowlist,
} from './atlas-manager';
import {
  Sprite,
  builder as spriteBuilder,
  PROPERTY_ALLOWLIST as SpritePropertyAllowlist,
} from './sprite';
import {
  Transform,
  builder as transformBuilder,
  PROPERTY_ALLOWLIST as TransformPropertyAllowlist,
} from './transform';
import {
  AnimationController,
  builder as animationControllerBuilder,
  PROPERTY_ALLOWLIST as AnimationControllerPropertyAllowlist,
} from './animation-controller';
import {
  CellMap,
  builder as cellMapBuilder,
  PROPERTY_ALLOWLIST as CellMapPropertyAllowlist,
} from './cell-map';
import {
  Camera,
  builder as cameraBuilder,
  PROPERTY_ALLOWLIST as CameraPropertyAllowlist,
} from './camera';
import {
  InputController,
  builder as inputControllerBuilder,
  PROPERTY_ALLOWLIST as InputControllerPropertyAllowlist,
} from './input-controller';
import {
  Collider,
  builder as colliderBuilder,
  PROPERTY_ALLOWLIST as ColliderPropertyAllowlist,
} from './collider';
import {
  EventCollider,
  builder as eventColliderBuilder,
  PROPERTY_ALLOWLIST as EventColliderPropertyAllowlist,
} from './event-collider';
import {
  Timer,
  builder as timerBuilder,
  PROPERTY_ALLOWLIST as TimerPropertyAllowlist,
} from './timer';
import {
  Light,
  builder as lightBuilder,
  PROPERTY_ALLOWLIST as LightPropertyAllowlist,
} from './light';
import {
  AudioTrack,
  builder as audioTrackBuilder,
  PROPERTY_ALLOWLIST as AudioTrackPropertyAllowlist,
} from './audio-track';
import {
  AudioEffect,
  builder as audioEffectBuilder,
  PROPERTY_ALLOWLIST as AudioEffectPropertyAllowlist,
} from './audio-effect';
import {
  AudioPlayer,
  builder as audioPlayerBuilder,
  PROPERTY_ALLOWLIST as AudioPlayerPropertyAllowlist,
} from './audio-player';
import type {
  COMPONENT_TYPE,
  ComponentData,
  ComponentOptions,
  ComponentMethods,
  ComponentSerializer,
} from './types';

/**
 * Method type registry for non-component functions.
 * Used for UI bindings, HTML constructors, message listeners, and other registered functions.
 */
export type METHOD_TYPE =
  | 'ui-binding'
  | 'html-constructor'
  | 'message-listener';

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export const BUILDERS: Record<COMPONENT_TYPE, Function> = {
  nexus: nexusBuilder,
  'ui-overlay': uiOverlayBuilder,
  'data-layer': dataLayerBuilder,
  'flag-manager': flagManagerBuilder,
  messenger: messengerBuilder,
  viewport: viewportBuilder,
  'texture-map': textureMapBuilder,
  'atlas-manager': atlasManagerBuilder,
  sprite: spriteBuilder,
  transform: transformBuilder,
  'animation-controller': animationControllerBuilder,
  'cell-map': cellMapBuilder,
  camera: cameraBuilder,
  'input-controller': inputControllerBuilder,
  collider: colliderBuilder,
  'event-collider': eventColliderBuilder,
  timer: timerBuilder,
  light: lightBuilder,
  'audio-track': audioTrackBuilder,
  'audio-effect': audioEffectBuilder,
  'audio-player': audioPlayerBuilder,
};

/**
 * Unified method registry for component methods and registered functions.
 * - Component types (nexus, ui-overlay, etc.) contain component methods
 * - Method types (ui-binding, html-constructor, message-listener) contain registered functions
 */
export const MethodRegistry: Record<
  COMPONENT_TYPE | METHOD_TYPE,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Record<string, any>
> = {
  nexus: Nexus,
  'ui-overlay': UIOverlay,
  'data-layer': DataLayer,
  'flag-manager': FlagManager,
  messenger: Messenger,
  viewport: Viewport,
  'texture-map': TextureMap,
  'atlas-manager': AtlasManager,
  sprite: Sprite,
  transform: Transform,
  'animation-controller': AnimationController,
  'cell-map': CellMap,
  camera: Camera,
  'input-controller': InputController,
  collider: Collider,
  'event-collider': EventCollider,
  timer: Timer,
  light: Light,
  'audio-track': AudioTrack,
  'audio-effect': AudioEffect,
  'audio-player': AudioPlayer,
  'ui-binding': {},
  'html-constructor': {},
  'message-listener': {},
};

/**
 * Registry of component-specific property allowlists.
 * Used by the component Proxy wrapper to distinguish data properties from methods.
 */
export const PROPERTY_ALLOWLIST: Record<COMPONENT_TYPE, string[]> = {
  nexus: NexusPropertyAllowlist,
  'ui-overlay': UIOverlayPropertyAllowlist,
  'data-layer': DataLayerPropertyAllowlist,
  'flag-manager': FlagManagerPropertyAllowlist,
  messenger: MessengerPropertyAllowlist,
  viewport: ViewportPropertyAllowlist,
  'texture-map': TextureMapPropertyAllowlist,
  'atlas-manager': AtlasManagerPropertyAllowlist,
  sprite: SpritePropertyAllowlist,
  transform: TransformPropertyAllowlist,
  'animation-controller': AnimationControllerPropertyAllowlist,
  'cell-map': CellMapPropertyAllowlist,
  camera: CameraPropertyAllowlist,
  'input-controller': InputControllerPropertyAllowlist,
  collider: ColliderPropertyAllowlist,
  'event-collider': EventColliderPropertyAllowlist,
  timer: TimerPropertyAllowlist,
  light: LightPropertyAllowlist,
  'audio-track': AudioTrackPropertyAllowlist,
  'audio-effect': AudioEffectPropertyAllowlist,
  'audio-player': AudioPlayerPropertyAllowlist,
};

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
const methodTypeCache: Record<string, Record<string, Function>> = {};

export function invalidateMethodCache(): void {
  for (const key in methodTypeCache) {
    delete methodTypeCache[key];
  }
}

/**
 * Registers a method in the unified method registry.
 * Can be used for component methods, UI bindings, HTML constructors, etc.
 *
 * @param type - The component or method type to register for
 * @param key - The unique key for this method
 * @param func - The function implementation
 *
 * @example
 * ```typescript
 * // Register a UI binding
 * registerMethod('ui-binding', 'closeMenu', (e) => { ... });
 *
 * // Register a component method
 * registerMethod('ui-overlay', 'fadeButton-show', (u) => { ... });
 *
 * // Register an HTML constructor
 * registerMethod('html-constructor', 'myOverlay', (overlay) => '<div>...</div>');
 * ```
 */
export function registerMethod(
  type: COMPONENT_TYPE | METHOD_TYPE,
  key: string,
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  func: Function,
): void {
  if (!MethodRegistry[type]) {
    console.error(
      `Cannot register method '${key}': type '${type}' does not exist in registry`,
    );
    return;
  }
  MethodRegistry[type][key] = func;
  invalidateMethodCache();
}

/**
 * Unregisters a method from the unified method registry.
 *
 * @param type - The component or method type to unregister from
 * @param key - The unique key for the method to remove
 *
 * @example
 * ```typescript
 * unregisterMethod('ui-binding', 'closeMenu');
 * ```
 */
export function unregisterMethod(
  type: COMPONENT_TYPE | METHOD_TYPE,
  key: string,
): void {
  if (!MethodRegistry[type]) {
    console.error(
      `Cannot unregister method '${key}': type '${type}' does not exist in registry`,
    );
    return;
  }
  delete MethodRegistry[type][key];
  invalidateMethodCache();
}

/**
 * Checks if a method exists in the unified method registry.
 *
 * @param type - The component or method type to check
 * @param key - The unique key for the method
 * @returns True if the method exists, false otherwise
 *
 * @example
 * ```typescript
 * if (hasMethod('ui-binding', 'closeMenu')) {
 *   // Method is registered and ready to use
 * }
 * ```
 */
export function hasMethod(
  type: COMPONENT_TYPE | METHOD_TYPE,
  key: string,
): boolean {
  if (!MethodRegistry[type]) {
    return false;
  }
  return typeof MethodRegistry[type][key] === 'function';
}

/**
 * Registers a UI binding event handler.
 * Convenience wrapper around registerMethod('ui-binding', ...).
 *
 * @param key - The unique key for this binding
 * @param func - The event handler function (signature: (e: Event) => void)
 *
 * @example
 * ```typescript
 * registerBinding('closeMenu', (e) => {
 *   document.getElementById('menu').style.display = 'none';
 * });
 * ```
 */
export function registerBinding(key: string, func: (e: Event) => void): void {
  registerMethod('ui-binding', key, func);
}

/**
 * Retrieves a UI binding event handler.
 *
 * @param key - The unique key for the binding
 * @returns The binding function, or null if not found
 */
export function getBinding(key: string): ((e: Event) => void) | null {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const func = MethodRegistry['ui-binding'][key];
  return typeof func === 'function' ? (func as (e: Event) => void) : null;
}

/**
 * Checks if a UI binding exists.
 *
 * @param key - The unique key for the binding
 * @returns True if the binding exists, false otherwise
 */
export function hasBinding(key: string): boolean {
  return hasMethod('ui-binding', key);
}

/**
 * Registers an HTML constructor function.
 * Convenience wrapper around registerMethod('html-constructor', ...).
 *
 * @param key - The unique key for this constructor
 * @param func - The constructor function (signature: (overlay: UIOverlayT) => string)
 *
 * @example
 * ```typescript
 * registerHtmlConstructor('myOverlay', (overlay) => {
 *   return `<div id="${overlay.name}">Hello World</div>`;
 * });
 * ```
 */
export function registerHtmlConstructor(
  key: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  func: (overlay: any) => string,
): void {
  registerMethod('html-constructor', key, func);
}

/**
 * Retrieves an HTML constructor function.
 *
 * @param key - The unique key for the constructor
 * @returns The constructor function, or null if not found
 */
export function getHtmlConstructor(
  key: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): ((overlay: any) => string) | null {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const func = MethodRegistry['html-constructor'][key];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return typeof func === 'function' ? (func as (overlay: any) => string) : null;
}

/**
 * Checks if an HTML constructor exists.
 *
 * @param key - The unique key for the constructor
 * @returns True if the constructor exists, false otherwise
 */
export function hasHtmlConstructor(key: string): boolean {
  return hasMethod('html-constructor', key);
}

// ── Plugin component types ──────────────────────────────────────────────────
//
// Built-in component types are registered statically above (BUILDERS,
// MethodRegistry, PROPERTY_ALLOWLIST) and via SERIALIZERS in scene/loader.ts.
// Plugin component types are registered at runtime through the functions below.
// COMPONENT_TYPE stays a strict closed union for built-ins; a plugin's string
// `type` is cast to it once, here, at the registration boundary — the registries
// are plain lookups so a runtime key that isn't in the union resolves fine.

/**
 * The full definition a plugin supplies to register a new component type.
 */
export interface ComponentTypeDefinition {
  /** Unique component type string (e.g. 'state-overlay'). Free-form at runtime. */
  type: string;
  builder: (
    options: ComponentOptions,
  ) => ComponentData | Promise<ComponentData>;
  /** MethodRegistry entry: carries `type` plus init/update/dispose/etc. */
  methods: ComponentMethods;
  propertyAllowlist?: string[];
  serializer?: ComponentSerializer;
}

/**
 * Serializers for plugin component types. Built-in serializers live in
 * scene/loader.ts's SERIALIZERS map; the loader falls back to this for plugin
 * types via getPluginSerializer(). Kept here (not imported into the loader the
 * other way) so the scene→component import direction stays one-way.
 */
const pluginSerializers: Record<string, ComponentSerializer> = {};

/**
 * Returns the serializer registered for a plugin component type, if any.
 * Consumed by scene/loader.ts as a fallback to the built-in SERIALIZERS map.
 */
export function getPluginSerializer(
  type: string,
): ComponentSerializer | undefined {
  return pluginSerializers[type];
}

/**
 * Internal: writes a component type into every registry. Performs the single
 * `as COMPONENT_TYPE` cast that bridges a plugin's string type to the strict
 * registries. Use {@link registerPluginComponent} from plugin code.
 */
export function registerComponentType(def: ComponentTypeDefinition): void {
  const type = def.type as COMPONENT_TYPE;
  if (BUILDERS[type]) {
    console.error(
      `[plugin] component type '${def.type}' is already registered`,
    );
    return;
  }
  BUILDERS[type] = def.builder;
  MethodRegistry[type] = def.methods;
  PROPERTY_ALLOWLIST[type] = def.propertyAllowlist ?? [];
  if (def.serializer) pluginSerializers[type] = def.serializer;
  invalidateMethodCache();
}

/**
 * Public plugin entry point. Validates a ComponentTypeDefinition, then registers
 * it. Called by the engine's `plugins` init option (TS defs) and by
 * self-registering JS plugin files via the `Omosuen` global.
 *
 * Plugin types must be registered before a scene that uses them is loaded /
 * deserialized (same ordering rule as registerBinding).
 *
 * @example
 * ```typescript
 * Omosuen.registerPluginComponent({
 *   type: 'state-overlay',
 *   builder, methods, propertyAllowlist, serializer,
 * });
 * ```
 */
export function registerPluginComponent(def: ComponentTypeDefinition): void {
  if (
    !def ||
    typeof def !== 'object' ||
    typeof def.type !== 'string' ||
    typeof def.builder !== 'function' ||
    !def.methods
  ) {
    console.warn(
      '[plugin] registerPluginComponent: invalid ComponentTypeDefinition',
      def,
    );
    return;
  }
  registerComponentType(def);
}

/**
 * Removes a plugin component type from every registry. For teardown/tests.
 */
export function unregisterComponentType(type: string): void {
  delete (BUILDERS as Record<string, unknown>)[type];
  delete (MethodRegistry as Record<string, unknown>)[type];
  delete (PROPERTY_ALLOWLIST as Record<string, unknown>)[type];
  delete pluginSerializers[type];
  invalidateMethodCache();
}
