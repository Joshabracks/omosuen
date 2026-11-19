// The Aseprite → entity importer. Parses an .aseprite buffer (or URLs),
// composites the selected frames into in-memory canvases, and builds the
// entity's texture-maps + sprites + animation-controller into a nexus. The work
// itself lives in `session.ts`; these are the stable programmatic entry points.
import { AsepriteSession } from './session.js';
/**
 * Parses an Aseprite buffer and builds a fully-animated, optionally-layered
 * entity into `config.parent`: composited texture-maps + sprites + an
 * animation-controller (tags → animations with per-frame durations). Only the
 * selected `layers` × `frames` are decoded. Browser-only (uses canvas); the
 * parser it calls is environment-agnostic.
 */
export async function importAseprite(buffer, config) {
    const session = await AsepriteSession.create([
        {
            key: '',
            buffer,
            visibleOnly: config.visibleOnly ?? true,
            layers: config.layers,
            frames: config.frames,
        },
    ], {
        mode: 'single',
        parent: config.parent,
        atlasManager: config.atlasManager,
        packageId: config.packageId,
        flatten: config.flatten ?? true,
        anchor: config.anchor,
        anchorMode: config.anchorMode,
        position: config.position,
        scale: config.scale,
        layerSlots: config.layerSlots,
    });
    return { controller: session.controller, sprites: session.sprites, loader: session };
}
/**
 * Multi-source variant: ingests several .aseprite files into ONE entity nexus by
 * "horizontal" ingestion — one sprite (and one texture-map) per unique LAYER
 * NAME across the whole set, not one per source. A set where every source has
 * `main`/`outline` layers produces exactly 2 sprites total, however many sources
 * are in the set.
 *
 * Naming (vs the single-source `importAseprite`, which stays un-prefixed):
 *   - sprite / layer name : `${layerName}`  (flattened set: `${packageId}`) — shared, not per-source
 *   - texture key         : `aseprite:${artSetKey}:${layerName}`
 *   - animation name      : `${sourceKey}-${tagName}` — still per-source; this is how a caller
 *     "swaps costumes": play `${key}-walk` on the same small shared sprite set.
 *
 * Frame-index allocation: every source is assigned a disjoint block of the
 * SHARED frame-index space, `[offset, offset + frameCount)`, in source order;
 * every layer's texture-map uses those same indices, since the engine's
 * `AnimationController` applies one frame index to every layer in lockstep. A
 * texture-map holds only the frames some entity has selected, so a layer some
 * source doesn't contribute to has no frame data in that source's block — if a
 * caller leaves such a layer visible while that source's animation plays, the
 * renderer warns and skips drawing that frame rather than crashing.
 *
 * Texture-maps are shared by every entity of the same art set and hold the
 * union of their selections; each frame is reference counted, so entities with
 * different `layers` / `frames` coexist and the last one to let go of a frame
 * frees it. Files are fetched + indexed once per URL.
 */
export async function importAsepriteSources(entries, config) {
    // Object.keys preserves insertion order for non-numeric-string keys (the
    // documented requirement); this order drives frame-offset allocation, so it
    // must be stable across a set's declaration and its cache key.
    const specs = Object.keys(entries).map((key) => ({
        key,
        filePath: entries[key].filePath,
        visibleOnly: entries[key].visibleOnly,
        layers: entries[key].layers,
        frames: entries[key].frames,
    }));
    const session = await AsepriteSession.create(specs, {
        mode: 'set',
        parent: config.parent,
        atlasManager: config.atlasManager,
        sharedParent: config.sharedParent,
        packageId: config.packageId,
        flatten: config.flatten ?? true,
        anchor: config.anchor,
        anchorMode: config.anchorMode,
        position: config.position,
        scale: config.scale,
        layerSlots: config.layerSlots,
    });
    return { controller: session.controller, sprites: session.sprites, loader: session };
}
