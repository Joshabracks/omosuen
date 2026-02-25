/**
 * Defines the uniqueness constraints for components.
 *
 * - FALSE (0): Multiple instances allowed per Nexus
 * - LOCAL (1): Only one instance per parent Nexus (replaces boolean true)
 * - GLOBAL (2): Only one instance per entire scene hierarchy
 */
export enum ComponentUnique {
  FALSE = 0,
  LOCAL = 1,
  GLOBAL = 2,
}
