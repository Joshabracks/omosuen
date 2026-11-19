import type { AseFile, AseLayer, AseTag } from './parser/types.js';
/**
 * Which layers to decode: layer names (every same-named layer matches), or a
 * predicate. A predicate can't be serialized — on a component it only lives for
 * the session (see the README).
 */
export type LayerSelection = readonly string[] | ((name: string, layer: AseLayer) => boolean);
/**
 * One frame selector:
 * - `'walk'` — every frame of that tag (→ animation `walk`)
 * - `117` — one absolute frame (→ one-frame animation `117`)
 * - `'walk:3'` or `{ tag: 'walk', frame: 3 }` — one frame of a tag, by its
 *   position inside the tag (→ one-frame animation `walk:3`)
 * - `{ tag: 'walk' }` — same as `'walk'`
 *
 * A tag whose own name contains `:<digits>` is still matched by its exact name
 * first.
 */
export type FrameSelector = string | number | {
    tag: string;
    frame?: number;
};
/** An animation in a file's own (local) frame numbers. */
export interface AnimationSpec {
    name: string;
    frames: number[];
    frameDurations: number[];
    frameRate: number;
    loop: boolean;
}
/** A resolved selector: the frames it needs and the animation it exposes. */
export interface FrameGroup {
    /** Normalized selector name — also the animation name. */
    id: string;
    /** Local frame numbers this group keeps decoded, ascending, unique. */
    frames: number[];
    /** Null for a hold-only group (frames kept, no animation). */
    animation: AnimationSpec | null;
}
/** Group id for the default selection's untagged frames (never an animation). */
export declare const UNTAGGED_GROUP = "*";
/** The normalized name a selector resolves to (also its animation name). */
export declare function selectorId(sel: FrameSelector): string;
/** Converts a tag to an animation, expanding reverse / ping-pong directions. */
export declare function tagAnimation(ase: AseFile, tag: AseTag, name?: string): AnimationSpec;
/** Resolves one selector, or null when it names nothing in this file. */
export declare function resolveFrameSelector(ase: AseFile, sel: FrameSelector): FrameGroup | null;
/**
 * Resolves a selector list. `frames` is the union of every group's frames;
 * `missing` lists selectors that matched nothing (callers warn).
 */
export declare function resolveFrameSelectors(ase: AseFile, sels: readonly FrameSelector[]): {
    groups: FrameGroup[];
    frames: number[];
    missing: string[];
};
/**
 * The selection used when no `frames` are given: one group per tag (each
 * exposing its animation), plus a hold-only group for frames no tag covers —
 * so every frame stays decoded, as before. A file without tags gets a single
 * `default` animation over every frame.
 */
export declare function defaultFrameGroups(ase: AseFile): FrameGroup[];
/** Ascending, de-duplicated union of the groups' frames. */
export declare function unionFrames(groups: Iterable<FrameGroup>): number[];
export interface LayerResolveOptions {
    /** Used only when `selection` is undefined: keep just Aseprite-visible layers. */
    visibleOnly?: boolean;
    /** Names added on top of the base selection (a later `extend`). */
    include?: ReadonlySet<string>;
    /** Names removed from the base selection (a later `release`). Wins over `include`. */
    exclude?: ReadonlySet<string>;
    /** Only image layers (type 0) — groups/tilemaps carry no pixels. Default true. */
    imageOnly?: boolean;
}
/**
 * The selected layers, in file (draw) order. With no `selection`, the base is
 * every layer, or every visible layer when `visibleOnly` is set — the saved
 * visibility is the default, an explicit `selection` overrides it.
 */
export declare function resolveLayers(ase: AseFile, selection: LayerSelection | undefined, opts?: LayerResolveOptions): AseLayer[];
/** Names in `wanted` that match no image layer in the file (for warnings). */
export declare function missingLayerNames(ase: AseFile, wanted: Iterable<string>): string[];
