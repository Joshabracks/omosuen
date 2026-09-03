/* Omosuen UMD global loaded before the site bundle. */

interface OmosuenVector2D {
  x: number;
  y: number;
}

interface OmosuenVector3D {
  x: number;
  y: number;
  z: number;
}

interface OmosuenVector4D {
  x: number;
  y: number;
  z: number;
  w: number;
}

interface OmosuenGlobal {
  init(config?: { logSuppression?: number; plugins?: unknown[] }): Promise<void>;
  registerPluginComponent(def: unknown): void;
  registerSceneModule(name: string, path: string): void;
  switchScene(name: string): Promise<unknown>;
  start(fps: number): void;
  version: string;
  newComponent(
    type: string,
    options: Record<string, unknown>,
    parent?: unknown,
  ): Promise<unknown>;
  castTo<T>(component: unknown): T;
  getActiveScene(): { name?: string } | null;
  ComponentUnique: {
    FALSE: number;
    LOCAL: number;
    GLOBAL: number;
    NAME: number;
  };
  Vector2D: new (x: number, y: number) => OmosuenVector2D;
  Vector3D: new (x: number, y: number, z: number) => OmosuenVector3D;
  Vector4D: new (x: number, y: number, z: number, w: number) => OmosuenVector4D;
  Array3D: new (size: { x: number; y: number; z: number }, fill: number) => {
    set: (coords: { x: number; y: number; z: number }, value: number) => void;
  };
}

declare global {
  /** Webpack DefinePlugin — `/` locally, `/omosuen/` on GitHub Pages. */
  const __BASE_PATH__: string;

  interface Window {
    Omosuen: OmosuenGlobal;
  }
}

export {};
