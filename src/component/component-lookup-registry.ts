/**
 * General-purpose component lookup registries -- by type, and by name -- so
 * low-volume/unique component lookups (atlas-manager, viewport, camera, ...)
 * can be answered in close to O(1) instead of a full scene tree walk.
 *
 * `renderable-version.ts` (sprite/cell-map/light) is a deliberately different
 * mechanism for a different volume regime -- this registry is for
 * low-volume/unique types only, not superseding that one.
 */
import type { ComponentData, COMPONENT_TYPE } from './types';
import { ComponentUnique } from './types';
import { getConfig } from '../config';

/**
 * Curated low-volume types that default to opted in, regardless of their
 * `ComponentUnique` setting (none of these are `GLOBAL` except
 * `atlas-manager` -- `camera` is `LOCAL`, `viewport`/`texture-map` are
 * `FALSE`, included here because they're low-volume in practice, not because
 * they're structurally unique).
 */
const BUILT_IN_DEFAULT_TYPES = new Set<string>([
  'camera',
  'atlas-manager',
  'texture-map',
  'viewport',
]);

/**
 * Types discovered to be `ComponentUnique.GLOBAL` from having seen at least
 * one live instance (see `noteUniqueness`). `ComponentUnique` is a static
 * property of a type's own definition (every instance of a given type always
 * has the same `unique` value), but nothing in the engine maintains a
 * type-keyed map of it independent of an actual instance -- so this is
 * populated lazily, the first time any instance of a type is registered.
 * Before that first sighting, a `GLOBAL` type not also in
 * `BUILT_IN_DEFAULT_TYPES` is safely (not incorrectly) treated as opted out:
 * if zero instances have ever existed, the registry and a real tree walk
 * agree there's nothing to find either way, so there's no correctness gap --
 * only a "not yet accelerated" one, resolved the moment the first instance
 * is added.
 */
const KNOWN_GLOBAL_TYPES = new Set<string>();

function noteUniqueness(component: ComponentData): void {
  if (component.unique === ComponentUnique.GLOBAL) {
    KNOWN_GLOBAL_TYPES.add(component.type);
  }
}

/**
 * Whether `type` is opted into the type registry: an explicit
 * `OmosuenConfig.componentRegistrationOverrideList` entry wins if present,
 * otherwise the built-in default (curated list, or discovered `GLOBAL`).
 */
export function isTypeOptedIn(type: string): boolean {
  const override =
    getConfig().componentRegistrationOverrideList?.[type as COMPONENT_TYPE];
  if (override !== undefined) return override;
  return BUILT_IN_DEFAULT_TYPES.has(type) || KNOWN_GLOBAL_TYPES.has(type);
}

const TYPE_REGISTRY = new Map<string, Set<ComponentData>>();
const EMPTY_SET: ReadonlySet<ComponentData> = new Set();

/** Adds `component` to the type registry if its type is opted in. No-op otherwise. */
export function registerByType(component: ComponentData): void {
  noteUniqueness(component);
  if (!isTypeOptedIn(component.type)) return;
  let set = TYPE_REGISTRY.get(component.type);
  if (!set) {
    set = new Set();
    TYPE_REGISTRY.set(component.type, set);
  }
  set.add(component);
}

/** Removes `component` from the type registry. Safe no-op if it was never registered. */
export function unregisterByType(component: ComponentData): void {
  TYPE_REGISTRY.get(component.type)?.delete(component);
}

/**
 * The registry's current `Set` for `type` -- empty (never allocated) if
 * nothing of this type is opted in or has ever been registered. For an
 * opted-in type, this set is always complete (every live instance is in
 * it), so an empty result here reliably means zero instances exist anywhere
 * -- safe to trust as a negative result, unlike the name registry below.
 */
export function getTypeRegistrySet(type: string): ReadonlySet<ComponentData> {
  return TYPE_REGISTRY.get(type) ?? EMPTY_SET;
}

/**
 * Identity check robust to the engine's raw-vs-proxy duality: a `.parent`
 * field, and a caller-supplied nexus reference obtained some other way, can
 * each independently be either a component's raw target or its Proxy
 * wrapper -- `===` between them is not reliable even when they represent the
 * same logical component (confirmed empirically: a component's `.parent`
 * chain can report the correct id while failing a `===` check against an
 * `getActiveScene()`-obtained reference to that same nexus). `.id` is the
 * stable identity this codebase already relies on elsewhere for this
 * exact reason (see `getComponentById`'s own `n.id === id` check).
 */
export function sameComponent(
  a: ComponentData | null,
  b: ComponentData | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.id !== undefined && a.id === b.id;
}

/**
 * Bubble-up ancestry check: is `candidate` a descendant of `n`? Walks
 * `candidate.parent` up to the root (or until it hits `n`) using the
 * existing parent links -- no additional bookkeeping, since reparenting
 * isn't a real operation in this engine (confirmed: `component.parent` is
 * set exactly once, inside `Nexus.addComponent`, nowhere else).
 */
export function isWithinSubtree(
  candidate: ComponentData,
  n: ComponentData,
): boolean {
  let current = candidate.parent;
  while (current) {
    if (sameComponent(current, n)) return true;
    current = current.parent;
  }
  return false;
}

const NAME_REGISTRY = new Map<string, ComponentData[]>();
const EMPTY_ARRAY: readonly ComponentData[] = [];

/** Adds `component` to the name registry under its current `.name`. */
export function registerByName(component: ComponentData): void {
  let arr = NAME_REGISTRY.get(component.name);
  if (!arr) {
    arr = [];
    NAME_REGISTRY.set(component.name, arr);
  }
  arr.push(component);
}

/** Removes `component` from the name registry. Safe no-op if it was never registered. */
export function unregisterByName(component: ComponentData): void {
  const arr = NAME_REGISTRY.get(component.name);
  if (!arr) return;
  const idx = arr.indexOf(component);
  if (idx !== -1) arr.splice(idx, 1);
  if (arr.length === 0) NAME_REGISTRY.delete(component.name);
}

/**
 * Components explicitly opted into the name registry (via `registerByName`
 * at add time) under `name`. This is deliberately **not** consulted by
 * `getComponentByName`/`getComponentsByName` -- unlike the type registry,
 * name registration is opt-in per *instance*, not per type, so an
 * empty/partial result here does not mean no component has this name: an
 * unregistered component could still be sitting in the tree, unregistered,
 * with the same name. Trusting this as a complete answer for a general
 * "find by name" search would silently miss it. Use this only when you
 * specifically want "components deliberately registered under this name",
 * not "every component with this name".
 */
export function getRegisteredByName(name: string): readonly ComponentData[] {
  return NAME_REGISTRY.get(name) ?? EMPTY_ARRAY;
}
