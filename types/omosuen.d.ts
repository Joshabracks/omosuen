// Local in-repo type shim for the `omosuen` peer dependency, used only to build
// this plugin inside the Omosuen monorepo (it is NOT shipped — see package.json
// `files`). A published install resolves these from the real `omosuen` package's
// declarations instead. Keep this a minimal structural subset of the engine's
// public component API.

declare module 'omosuen' {
  export interface ComponentData {
    name: string;
    type: string;
    id?: number;
    parent: unknown;
    _disposed?: boolean;
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
}
