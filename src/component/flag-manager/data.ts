import {
  ComponentData,
  ComponentOptions,
  ComponentSerializer,
  ComponentInstanceMethods,
} from '../types';
import { ComponentUnique } from '../constants';
import type { FlagManagerMethods } from './methods';

/**
 * Flag-manager component for storing and querying boolean flags.
 * Uses GLOBAL uniqueness - only one flag-manager allowed per scene hierarchy.
 *
 * Flags are simple string identifiers used for tracking game state:
 * - Quest completion ("quest_1_complete", "tutorial_finished")
 * - World state ("boss_defeated", "secret_unlocked")
 * - Player progression ("has_double_jump", "can_swim")
 */
export interface FlagManagerT
  extends ComponentData, ComponentInstanceMethods<FlagManagerMethods> {
  type: 'flag-manager';
  unique: ComponentUnique.GLOBAL;
  flags: Set<string>;
}

/**
 * Builder function for flag-manager component.
 * Creates a new flag-manager with empty flag set.
 *
 * @param options - Component creation options
 * @returns A new flag-manager component instance
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
 *   console.log("Player has completed tutorial");
 * }
 *
 * // Or use $ Proxy
 * if ($.hasFlag(flagManager, "tutorialComplete")) { }
 * ```
 */
export function builder(options: ComponentOptions): FlagManagerT {
  // Create data-only object. Methods will be added by Proxy wrapper in newComponent()
  return {
    type: 'flag-manager' as const,
    name: options.name,
    unique: ComponentUnique.GLOBAL,
    parent: null,
    _disposed: false,
    flags: new Set<string>(),
  } as unknown as FlagManagerT;
}

/**
 * Serializes a flag-manager component to a plain object.
 * Converts Set<string> to Array<string> for JSON compatibility.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serialize(component: ComponentData): any {
  const fm = component as FlagManagerT;

  return {
    type: 'flag-manager',
    name: fm.name,
    unique: ComponentUnique.GLOBAL,
    flags: Array.from(fm.flags),
  };
}

/**
 * Deserializes a plain object back into a flag-manager component.
 * Reconstructs Set<string> from Array<string>.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deserialize(data: any): FlagManagerT {
  const { type, name, flags } = data;

  // Validate required fields
  const errors = [];
  if (type !== 'flag-manager') {
    errors.push(`type ${type} does not match "flag-manager"`);
  }
  if (!name) {
    errors.push('flag-manager requires a name');
  }
  if (errors.length) {
    throw new Error(errors.join('\n'));
  }

  // Create component using builder
  const flagManager = builder({ name });

  // Restore flags from array
  if (flags && Array.isArray(flags)) {
    flags.forEach((flag: unknown) => {
      if (typeof flag === 'string') {
        flagManager.flags.add(flag);
      } else {
        console.warn(
          `[flag-manager] Skipping non-string flag during deserialization: ${flag}`,
        );
      }
    });
  }

  return flagManager;
}

export const FlagManagerSerializer: ComponentSerializer = {
  serialize,
  deserialize,
};

/**
 * Allowlist of flag-manager-specific properties accessible via component Proxy.
 * These properties can be accessed directly without triggering method lookup.
 */
export const PROPERTY_ALLOWLIST: string[] = ['flags'];
