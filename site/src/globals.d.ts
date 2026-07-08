/* Omosuen UMD global loaded before the site bundle. */

interface OmosuenGlobal {
  init(config?: { logSuppression?: number; plugins?: unknown[] }): Promise<void>;
  registerPluginComponent(def: unknown): void;
  registerSceneModule(name: string, path: string): void;
  switchScene(name: string): Promise<unknown>;
  start(fps: number): void;
  version: string;
  Vector3D: new (x: number, y: number, z: number) => { x: number; y: number; z: number };
  Array3D: new (size: { x: number; y: number; z: number }, fill: number) => {
    set: (coords: { x: number; y: number; z: number }, value: number) => void;
  };
}

declare global {
  interface Window {
    Omosuen: OmosuenGlobal;
  }
}

export {};
