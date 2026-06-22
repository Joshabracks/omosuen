import { ComponentData, ComponentMethods, castTo } from '../types';
import type { AsepriteT } from './data';
import type { NexusT } from '../nexus/data';
import type { AtlasManagerT } from '../atlas-manager/data';
import { getActiveScene } from '../../scene';
import { importAseprite } from '../../asset/aseprite/import';

export interface AsepriteMethods extends ComponentMethods {
  init: (component: ComponentData) => Promise<void>;
  reload: (component: AsepriteT) => Promise<void>;
  dispose: (component: ComponentData) => void;
}

export const Aseprite: AsepriteMethods = {
  type: 'aseprite',

  /**
   * Fetches the `.aseprite` file statically, parses it, and builds the entity's
   * sprites + animation-controller + texture-maps into this component's nexus.
   * Runs on scene load (and on `reload`).
   */
  async init(component: ComponentData): Promise<void> {
    const a = component as AsepriteT;
    if (!a.parent) {
      console.warn(
        `[aseprite] Cannot initialize '${a.name}' - no parent nexus`,
      );
      return;
    }
    const parent = castTo<NexusT>(a.parent);

    const scene = getActiveScene();
    if (!scene) {
      console.warn(
        `[aseprite] Cannot initialize '${a.name}' - no active scene`,
      );
      return;
    }
    const atlasManager = scene.getComponentByType(
      'atlas-manager',
      true,
    ) as AtlasManagerT | null;
    if (!atlasManager) {
      console.warn(
        `[aseprite] '${a.name}' found no atlas-manager in the scene; cannot ingest`,
      );
      return;
    }

    try {
      const response = await fetch(a.filePath);
      if (!response.ok) {
        console.error(
          `[aseprite] Failed to fetch '${a.filePath}' for '${a.name}': ${response.status} ${response.statusText}`,
        );
        return;
      }
      const buffer = await response.arrayBuffer();
      await importAseprite(buffer, {
        parent,
        atlasManager,
        packageId: a.packageId,
        flatten: a.flatten,
        visibleOnly: a.visibleOnly,
        layerSlots: a.layerSlots,
      });
    } catch (error) {
      console.error(`[aseprite] Failed to import '${a.filePath}'`, error);
    }
  },

  /**
   * Re-runs ingestion (e.g. after the source file changed). Idempotent — the
   * importer first removes the previously-generated children.
   */
  async reload(component: AsepriteT): Promise<void> {
    await Aseprite.init(component);
  },

  dispose(c: ComponentData): void {
    (c as AsepriteT)._disposed = true;
  },
};
