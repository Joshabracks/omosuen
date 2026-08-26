import { ComponentData, ComponentMethods } from '../types';
import { VisionSourceT } from './data';
import { bumpRenderableVersion } from '../renderable-version';
import { clearExploredSweepCache } from '../camera/render/explored-sweep';

/**
 * Methods interface for vision-source component.
 * Provides type-safe method signatures for the $ Proxy.
 */
export interface VisionSourceMethods extends ComponentMethods {
  type: 'vision-source';
  init: (component: ComponentData) => Promise<void>;
  dispose: (component: ComponentData) => void;
  setRadius: (visionSource: VisionSourceT, radius: number) => void;
  getRadius: (visionSource: VisionSourceT) => number;
  setFadeWidth: (visionSource: VisionSourceT, fadeWidth: number) => void;
  getFadeWidth: (visionSource: VisionSourceT) => number;
  setEnabled: (visionSource: VisionSourceT, enabled: boolean) => void;
  getEnabled: (visionSource: VisionSourceT) => boolean;
}

export const VisionSource: VisionSourceMethods = {
  type: 'vision-source',

  async init(_component: ComponentData): Promise<void> {
    // No-op
  },

  dispose(component: ComponentData): void {
    const visionSource = component as VisionSourceT;
    visionSource._disposed = true;
    bumpRenderableVersion('vision-source');
    if (visionSource.id !== undefined) clearExploredSweepCache(visionSource.id);
  },

  setRadius(visionSource: VisionSourceT, radius: number): void {
    visionSource.radius = radius;
  },

  getRadius(visionSource: VisionSourceT): number {
    return visionSource.radius;
  },

  setFadeWidth(visionSource: VisionSourceT, fadeWidth: number): void {
    visionSource.fadeWidth = fadeWidth;
  },

  getFadeWidth(visionSource: VisionSourceT): number {
    return visionSource.fadeWidth;
  },

  setEnabled(visionSource: VisionSourceT, enabled: boolean): void {
    visionSource.enabled = enabled;
  },

  getEnabled(visionSource: VisionSourceT): boolean {
    return visionSource.enabled;
  },
};
