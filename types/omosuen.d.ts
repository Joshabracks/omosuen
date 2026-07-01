// Local in-repo type shim for the `omosuen` peer dependency, used only to build
// this plugin inside the Omosuen monorepo (it is NOT shipped — see package.json
// `files`). A published install resolves these from the real `omosuen` package's
// declarations instead. Keep this a minimal structural subset of the engine's
// public API — just what this component touches.
//
// NOTE: webpack externalizes `omosuen` to the `Omosuen` global, so every value
// imported here (registerPluginComponent, DataLayerSerializer, ...) resolves at
// runtime to the engine's singletons.

declare module 'omosuen' {
  export interface ComponentData {
    name: string;
    type: string;
    id?: number;
    parent: unknown;
    _disposed?: boolean;
    _generated?: boolean;
    [key: string]: unknown;
  }

  export interface ComponentOptions {
    name: string;
    [key: string]: unknown;
  }

  export interface ComponentMethods {
    type: string;
    init?: (component: ComponentData) => Promise<void> | void;
    update?: (component: ComponentData, deltaTime: number) => void;
    dispose?: (component: ComponentData) => void;
  }

  export interface ComponentSerializer {
    serialize: (component: ComponentData) => unknown;
    deserialize: (data: unknown) => unknown;
  }

  export interface ComponentTypeDefinition {
    type: string;
    builder: (
      options: ComponentOptions,
    ) => ComponentData | Promise<ComponentData>;
    methods: ComponentMethods;
    propertyAllowlist?: string[];
    serializer?: ComponentSerializer;
  }

  export function registerPluginComponent(def: ComponentTypeDefinition): void;

  // Re-wraps a raw component reference (e.g. component.parent) as its proxy so
  // proxy methods (getComponentByName, getComponentByType, ...) are reachable.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function castTo<T = any>(component: unknown): T;

  // Active scene root (proxy nexus) — used to resolve the mirrored data-layer.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function getActiveScene(): any;

  // Nexus snapshot serialization (whole-tree; skips `_generated` children).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function serializeComponentRecursive(component: unknown): any;

  // In-memory scene restore: resets/advances the global component-ID counter,
  // deserializes the tree, validates the root is a nexus. Returns the root nexus
  // proxy or null. (The in-memory analog of loading a serialized scene file.)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function deserializeScene(data: unknown): Promise<any | null>;

  // The data-layer's serializer (tags/validates Vectors). Reused to persist and
  // rehydrate a mirrored data-layer without inventing a parallel convention.
  export const DataLayerSerializer: ComponentSerializer;

  export enum ComponentUnique {
    FALSE = 0,
    LOCAL = 1,
    GLOBAL = 2,
    NAME = 3,
  }
}
