/**
 * The portable form of fog-of-war's sprite memory: every phantom (the frozen
 * "last seen here" stand-in left where a tracked sprite went out of sight), for
 * a game that saves and loads its own state rather than the engine's scene
 * serialization. The terrain half is `ExploredState` (cell-map/explored-state).
 *
 * Plain numbers, strings and arrays throughout, so it round-trips through JSON.
 * Types only -- nothing here runs.
 */

import type { PaletteEntry } from '../sprite/palette';

/**
 * Which sprite a phantom stands in for, described so it can be found again in
 * a scene that was rebuilt from a save and therefore has new engine ids.
 */
export interface PhantomOwnerRef {
  /**
   * Id of the nexus holding the sprite, then of each of its ancestors, nearest
   * first (the scene root excluded). A game whose entity identity is a nexus id
   * will find that id somewhere in this list.
   */
  nexusIds: number[];
  /** Names of those same nexuses, in the same order. */
  nexusNames: string[];
  spriteName: string;
  /** The sprite's position among the sprites of its own nexus. */
  spriteIndex: number;
}

/** One phantom: where it stands, what it looks like, and whose memory it is. */
export interface PhantomSnapshot {
  /** `null` when the sprite it stood in for no longer existed at export. */
  owner: PhantomOwnerRef | null;
  /** Base name its components were created from. */
  name: string;
  position: [x: number, y: number, z: number];
  rotationY: number;
  scale: [x: number, y: number, z: number];
  /** Dissolve progress, 0..1, and whether vision has reached it and set it running. */
  dissolve: number;
  dissolving: boolean;
  sprite: {
    textureMapKeys: {
      albedo: string;
      normal: string;
      material: string;
      emission: string;
    };
    frame: {
      albedo: number;
      normal: number;
      emission: number;
      material: number;
    };
    anchor: [x: number, y: number];
    tint: [r: number, g: number, b: number, a: number];
    paletteRemap: PaletteEntry[] | null;
    opacity: number;
    showSilhouette: boolean;
    silhouetteColor: [r: number, g: number, b: number, a: number];
    renderOrder: number;
    emissionIntensity: number;
    emissionColor: [r: number, g: number, b: number];
  };
}

/** Every phantom in a scene, oldest first. */
export interface PhantomState {
  version: 1;
  phantoms: PhantomSnapshot[];
}

/** How `importPhantoms` reconnects each phantom to the sprite it stands in for. */
export interface PhantomImportOptions {
  /**
   * Saved nexus id -> the id that nexus has now. The engine looks each owner's
   * `nexusIds` up in this (nearest first), then walks back down by name to the
   * sprite. Omitted, ids are taken as unchanged, which is right for an import
   * into the same running scene.
   */
  ids?: ReadonlyMap<number, number>;
  /**
   * Full control instead of `ids`: return the live sprite for an owner, or
   * `null` if it is gone. The value returned must be a sprite component.
   */
  resolveOwner?: (owner: PhantomOwnerRef) => unknown;
}
