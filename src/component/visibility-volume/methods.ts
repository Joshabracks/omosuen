import { ComponentData, ComponentMethods } from '../types';
import { VisibilityVolumeT } from './data';
import { bumpRenderableVersion } from '../renderable-version';
import { clearExploredSweepCache } from '../camera/render/explored-sweep';

/**
 * Methods interface for the visibility-volume component.
 */
export interface VisibilityVolumeMethods extends ComponentMethods {
  type: 'visibility-volume';
  init: (component: ComponentData) => Promise<void>;
  dispose: (component: ComponentData) => void;
  setSize: (volume: VisibilityVolumeT, x: number, y: number, z: number) => void;
  getSize: (volume: VisibilityVolumeT) => { x: number; y: number; z: number };
  setEnabled: (volume: VisibilityVolumeT, enabled: boolean) => void;
  getEnabled: (volume: VisibilityVolumeT) => boolean;
  setFadeWidth: (volume: VisibilityVolumeT, fadeWidth: number) => void;
  getFadeWidth: (volume: VisibilityVolumeT) => number;
  setMarksExplored: (volume: VisibilityVolumeT, marks: boolean) => void;
  setPriority: (volume: VisibilityVolumeT, priority: number) => void;
}

export const VisibilityVolume: VisibilityVolumeMethods = {
  type: 'visibility-volume',

  async init(_component: ComponentData): Promise<void> {
    // No-op
  },

  dispose(component: ComponentData): void {
    const volume = component as VisibilityVolumeT;
    volume._disposed = true;
    bumpRenderableVersion('visibility-volume');
    if (volume.id !== undefined) clearExploredSweepCache(volume.id);
  },

  setSize(volume: VisibilityVolumeT, x: number, y: number, z: number): void {
    volume.size.x = x;
    volume.size.y = y;
    volume.size.z = z;
  },

  getSize(volume: VisibilityVolumeT): { x: number; y: number; z: number } {
    return { x: volume.size.x, y: volume.size.y, z: volume.size.z };
  },

  setEnabled(volume: VisibilityVolumeT, enabled: boolean): void {
    volume.enabled = enabled;
  },

  getEnabled(volume: VisibilityVolumeT): boolean {
    return volume.enabled;
  },

  setFadeWidth(volume: VisibilityVolumeT, fadeWidth: number): void {
    volume.fadeWidth = fadeWidth;
  },

  getFadeWidth(volume: VisibilityVolumeT): number {
    return volume.fadeWidth;
  },

  setMarksExplored(volume: VisibilityVolumeT, marks: boolean): void {
    volume.marksExplored = marks;
  },

  setPriority(volume: VisibilityVolumeT, priority: number): void {
    volume.priority = priority;
  },
};
