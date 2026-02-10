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
  ImageRegistry,
  builder as imageRegistryBuilder,
  PROPERTY_ALLOWLIST as ImageRegistryPropertyAllowlist,
} from './image-registry';
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
import type { COMPONENT_TYPE } from './types';

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
  'image-registry': imageRegistryBuilder,
  'atlas-manager': atlasManagerBuilder,
  sprite: spriteBuilder,
  transform: transformBuilder,
  'animation-controller': animationControllerBuilder,
  'cell-map': cellMapBuilder,
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
  'image-registry': ImageRegistry,
  'atlas-manager': AtlasManager,
  sprite: Sprite,
  transform: Transform,
  'animation-controller': AnimationController,
  'cell-map': CellMap,
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
  'image-registry': ImageRegistryPropertyAllowlist,
  'atlas-manager': AtlasManagerPropertyAllowlist,
  sprite: SpritePropertyAllowlist,
  transform: TransformPropertyAllowlist,
  'animation-controller': AnimationControllerPropertyAllowlist,
  'cell-map': CellMapPropertyAllowlist,
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
