// Local in-repo type shim for the `omosuen` peer dependency, used only to build
// this plugin inside the Omosuen monorepo (it is NOT shipped — see package.json
// `files`). A published install resolves these from the real `omosuen` package's
// declarations instead. Keep this a minimal structural subset of the engine's
// public API — just what the parser/importer/component touch.
//
// NOTE: webpack externalizes `omosuen` to the `Omosuen` global, so every value
// imported here (newComponent, Vector*, ComponentUnique, …) resolves at runtime
// to the engine's singletons.

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

  // Creating components by string type (the importer builds texture-maps,
  // sprites, an animation-controller, and a transform). Loose `any` options/
  // return avoids re-declaring every component's option type here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function newComponent(
    type: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    options: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parent?: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any>;

  // Re-wraps a raw component reference (e.g. component.parent) as its proxy so
  // proxy methods (getComponentByType, etc.) are reachable.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function castTo<T = any>(component: unknown): T;

  // Active scene root (used to find the atlas-manager).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function getActiveScene(): any;

  export enum ComponentUnique {
    FALSE = 0,
    LOCAL = 1,
    GLOBAL = 2,
    NAME = 3,
  }

  export class Vector2D {
    x: number;
    y: number;
    constructor(x: number, y: number);
  }
  export class Vector3D {
    x: number;
    y: number;
    z: number;
    constructor(x: number, y: number, z: number);
  }
  export class Vector4D {
    x: number;
    y: number;
    z: number;
    w: number;
    constructor(x: number, y: number, z: number, w: number);
  }
}
