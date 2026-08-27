// Local in-repo type shim for the `omosuen` peer dependency, used only to build
// this plugin inside the Omosuen monorepo (it is NOT shipped — see package.json
// `files`). A published install resolves these from the real `omosuen` package's
// declarations instead. Keep this a minimal structural subset of the engine's
// public component + profiler API.

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

  export type LoopPhase =
    | 'init'
    | 'update'
    | 'dispose'
    | 'transforms'
    | 'onscreen'
    | 'render'
    | 'messages';

  export interface ComponentTypeTiming {
    totalMs: number;
    count: number;
  }

  export interface ComponentInstanceTiming {
    name: string;
    type: string;
    totalMs: number;
    count: number;
  }

  export interface FrameProfile {
    timestamp: number;
    /** Interval BEFORE this record's work ran — not its cost. See workTime. */
    frameTime: number;
    /** CPU ms this frame actually spent; what byType/phases sum to. */
    workTime: number;
    /** Interval this frame's cost produced; undefined on the newest record. */
    resultingInterval?: number;
    fps: number;
    phases: Record<LoopPhase, number>;
    byType: Record<string, ComponentTypeTiming>;
    byInstance: Record<number, ComponentInstanceTiming>;
  }

  export interface SpikeCaptureResult {
    durationSeconds: number;
    frameCount: number;
    avgWorkTime: number;
    medianWorkTime: number;
    p95WorkTime: number;
    maxWorkTime: number;
    worst: FrameProfile[];
  }

  export function setProfilingEnabled(enabled: boolean): void;
  export function isProfilingEnabled(): boolean;
  export function getLastFrameProfile(): FrameProfile | null;
  export function getFrameHistory(count?: number): FrameProfile[];
  export function startSpikeCapture(
    durationSeconds?: number,
    size?: number,
  ): Promise<SpikeCaptureResult>;
  export function isSpikeCaptureActive(): boolean;
}
