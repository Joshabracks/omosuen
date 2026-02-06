import { ComponentData, ComponentMethods } from '../types';
import { FlagManagerT } from './data';

/**
 * Methods interface for flag-manager component.
 * Provides type-safe method signatures for the $ Proxy.
 */
export interface FlagManagerMethods extends ComponentMethods {
  hasFlag: (fm: FlagManagerT, flag: string) => boolean;
  hasAllFlags: (fm: FlagManagerT, flags: string | string[]) => boolean;
  hasAnyFlag: (fm: FlagManagerT, flags: string | string[]) => boolean;
  hasNoneOfFlags: (fm: FlagManagerT, flags: string | string[]) => boolean;
  addFlag: (fm: FlagManagerT, flag: string) => void;
  addFlags: (fm: FlagManagerT, flags: string[]) => void;
  removeFlag: (fm: FlagManagerT, flag: string) => void;
  removeFlags: (fm: FlagManagerT, flags: string[]) => void;
  getFlags: (fm: FlagManagerT) => string[];
  clearFlags: (fm: FlagManagerT) => void;
  dispose: (component: ComponentData) => void;
}

/**
 * Static methods object for flag-manager component.
 * Provides flag management operations on Set<string>.
 *
 * @example
 * ```typescript
 * const flagManager = await newComponent("flag-manager", { name: "Game Flags" });
 *
 * // Add flags
 * FlagManager.addFlag(flagManager, "tutorialComplete");
 * FlagManager.addFlags(flagManager, ["level1", "level2"]);
 *
 * // Query flags
 * if (FlagManager.hasFlag(flagManager, "tutorialComplete")) {
 *   console.log("Tutorial complete!");
 * }
 *
 * if (FlagManager.hasAllFlags(flagManager, ["level1", "level2"])) {
 *   console.log("Both levels complete!");
 * }
 *
 * // Get all flags
 * const allFlags = FlagManager.getFlags(flagManager);
 *
 * // Remove flags
 * FlagManager.removeFlag(flagManager, "tempFlag");
 * FlagManager.clearFlags(flagManager);
 *
 * // Or use via $ Proxy
 * $.addFlag(flagManager, "bossDefeated");
 * if ($.hasFlag(flagManager, "bossDefeated")) { }
 * ```
 */
export const FlagManager: FlagManagerMethods = {
  type: 'flag-manager',

  /**
   * Checks if a specific flag exists.
   *
   * @param fm - The flag-manager component
   * @param flag - The flag to check for
   * @returns true if the flag exists, false otherwise
   *
   * @example
   * ```typescript
   * if (FlagManager.hasFlag(flagManager, "tutorialComplete")) {
   *   console.log("Player completed tutorial");
   * }
   * ```
   */
  hasFlag: (fm: FlagManagerT, flag: string): boolean => {
    return fm.flags.has(flag);
  },

  /**
   * Checks if ALL specified flags exist.
   *
   * @param fm - The flag-manager component
   * @param flags - Single flag string or array of flags to check
   * @returns true if all flags exist, false if any are missing
   *
   * @example
   * ```typescript
   * // Check single flag
   * if (FlagManager.hasAllFlags(flagManager, "step1")) { }
   *
   * // Check multiple flags
   * if (FlagManager.hasAllFlags(flagManager, ["step1", "step2", "step3"])) {
   *   console.log("Tutorial fully complete!");
   * }
   * ```
   */
  hasAllFlags: (fm: FlagManagerT, flags: string | string[]): boolean => {
    const flagArray = Array.isArray(flags) ? flags : [flags];
    return flagArray.every((flag) => fm.flags.has(flag));
  },

  /**
   * Checks if ANY of the specified flags exist.
   *
   * @param fm - The flag-manager component
   * @param flags - Single flag string or array of flags to check
   * @returns true if at least one flag exists, false if none exist
   *
   * @example
   * ```typescript
   * // Check single flag
   * if (FlagManager.hasAnyFlag(flagManager, "speedBoost")) { }
   *
   * // Check multiple flags
   * if (FlagManager.hasAnyFlag(flagManager, ["speedBoost", "shield", "doubleJump"])) {
   *   console.log("Player has at least one power-up");
   * }
   * ```
   */
  hasAnyFlag: (fm: FlagManagerT, flags: string | string[]): boolean => {
    const flagArray = Array.isArray(flags) ? flags : [flags];
    return flagArray.some((flag) => fm.flags.has(flag));
  },

  /**
   * Checks if NONE of the specified flags exist.
   *
   * @param fm - The flag-manager component
   * @param flags - Single flag string or array of flags to check
   * @returns true if none of the flags exist, false if any exist
   *
   * @example
   * ```typescript
   * // Check single flag
   * if (FlagManager.hasNoneOfFlags(flagManager, "gameOver")) { }
   *
   * // Check multiple flags
   * if (FlagManager.hasNoneOfFlags(flagManager, ["gameOver", "playerDied", "timesUp"])) {
   *   console.log("Game is still active");
   * }
   * ```
   */
  hasNoneOfFlags: (fm: FlagManagerT, flags: string | string[]): boolean => {
    const flagArray = Array.isArray(flags) ? flags : [flags];
    return !flagArray.some((flag) => fm.flags.has(flag));
  },

  /**
   * Adds a single flag.
   * If the flag already exists, this is a no-op.
   *
   * @param fm - The flag-manager component
   * @param flag - The flag to add
   *
   * @example
   * ```typescript
   * FlagManager.addFlag(flagManager, "bossDefeated");
   * ```
   */
  addFlag: (fm: FlagManagerT, flag: string): void => {
    fm.flags.add(flag);
  },

  /**
   * Adds multiple flags at once.
   * Flags that already exist are ignored (no duplicates).
   *
   * @param fm - The flag-manager component
   * @param flags - Array of flags to add
   *
   * @example
   * ```typescript
   * FlagManager.addFlags(flagManager, [
   *   "level1Complete",
   *   "level2Complete",
   *   "level3Complete"
   * ]);
   * ```
   */
  addFlags: (fm: FlagManagerT, flags: string[]): void => {
    flags.forEach((flag) => fm.flags.add(flag));
  },

  /**
   * Removes a single flag.
   * If the flag doesn't exist, this is a no-op.
   *
   * @param fm - The flag-manager component
   * @param flag - The flag to remove
   *
   * @example
   * ```typescript
   * FlagManager.removeFlag(flagManager, "tempBoost");
   * ```
   */
  removeFlag: (fm: FlagManagerT, flag: string): void => {
    fm.flags.delete(flag);
  },

  /**
   * Removes multiple flags at once.
   * Flags that don't exist are ignored.
   *
   * @param fm - The flag-manager component
   * @param flags - Array of flags to remove
   *
   * @example
   * ```typescript
   * // Remove all power-ups
   * FlagManager.removeFlags(flagManager, [
   *   "speedBoost",
   *   "shield",
   *   "doubleJump"
   * ]);
   * ```
   */
  removeFlags: (fm: FlagManagerT, flags: string[]): void => {
    flags.forEach((flag) => fm.flags.delete(flag));
  },

  /**
   * Gets all flags as an array.
   * Returns a new array, safe to modify without affecting the flag-manager.
   *
   * @param fm - The flag-manager component
   * @returns Array of all flag strings
   *
   * @example
   * ```typescript
   * const allFlags = FlagManager.getFlags(flagManager);
   * console.log("Active flags:", allFlags);
   * // ["level1Complete", "level2Complete", "tutorialComplete"]
   * ```
   */
  getFlags: (fm: FlagManagerT): string[] => {
    return Array.from(fm.flags);
  },

  /**
   * Removes all flags.
   * Clears the entire flag set.
   *
   * @param fm - The flag-manager component
   *
   * @example
   * ```typescript
   * // Reset all flags (e.g., new game)
   * FlagManager.clearFlags(flagManager);
   * ```
   */
  clearFlags: (fm: FlagManagerT): void => {
    fm.flags.clear();
  },

  /**
   * Disposes the flag-manager component.
   * Clears all flags and marks the component as disposed.
   *
   * @param component - The component to dispose
   *
   * @example
   * ```typescript
   * // Called automatically by engine disposal system
   * FlagManager.dispose(flagManager);
   * ```
   */
  dispose: (component: ComponentData): void => {
    const fm = component as FlagManagerT;
    fm.flags.clear();
    fm._disposed = true;
  },
};
