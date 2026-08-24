// The Aseprite → entity importer. Parses an .aseprite buffer, composites frames
// into in-memory canvases, and builds the entity's texture-maps + sprites +
// animation-controller into a nexus. Engine runtime (newComponent, Vector*) is
// imported from 'omosuen' and externalized to the engine global at bundle time —
// these are the engine's own singletons, never re-bundled.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { newComponent, Vector2D, Vector3D, Vector4D } from 'omosuen';
import { parseAseprite } from './parser/parser.js';
/**
 * Per-art-set instance blueprints, keyed by `artSetKey` (every source key +
 * filePath in the set, order-sensitive). Lets repeat spawns of the same set
 * skip all the heavy import work (see importAsepriteSources).
 */
const BLUEPRINTS = new Map();
/**
 * Parses an Aseprite buffer and builds a fully-animated, optionally-layered
 * entity into `config.parent`: composited texture-maps + sprites + an
 * animation-controller (tags → animations with per-frame durations). Browser-only
 * (uses canvas); the parser it calls is environment-agnostic.
 */
export async function importAseprite(buffer, config) {
    const ase = await parseAseprite(buffer);
    const flatten = config.flatten ?? true;
    const visibleOnly = config.visibleOnly ?? true;
    const anchor = resolveAnchor(ase, config);
    const parent = config.parent;
    // Idempotent: drop any previously-generated children before rebuilding.
    removeGeneratedChildren(parent);
    // Ensure a transform exists (persists across re-inits — see ensureTransform).
    await ensureTransform(parent, config.packageId, config);
    // Image layers only, filtered by visibility; composited ascending by index.
    const renderLayers = ase.layers.filter((l) => l.type === 0 && (!visibleOnly || l.visible));
    // Build one strip canvas per produced sprite (a `w*frameCount × h` sheet).
    const builds = [];
    if (flatten) {
        builds.push({
            name: config.packageId,
            canvas: compositeStrip(ase, renderLayers),
        });
    }
    else {
        for (const layer of renderLayers) {
            builds.push({ name: layer.name, canvas: compositeStrip(ase, [layer]) });
        }
    }
    // Frame rectangles into the strip (one per frame).
    const frameRects = buildFrameRects(ase);
    // Create a texture-map + sprite per build.
    const sprites = [];
    let renderOrder = 0;
    for (const build of builds) {
        const texKey = `aseprite:${config.packageId}:${build.name}`;
        const tm = await newComponent('texture-map', {
            name: texKey,
            textureMapKey: texKey,
            // Synthetic, unique source path keeps the atlas dedup key correct.
            filePath: `aseprite://${config.packageId}/${build.name}`,
            sourceImage: build.canvas,
            imageType: frameRects,
        }, parent);
        if (tm)
            tm._generated = true;
        const sprite = await newComponent('sprite', {
            name: build.name,
            textureMapKeys: {
                albedo: texKey,
                normal: '',
                material: '',
                emission: '',
            },
            frame: { albedo: 0, normal: 0, material: 0, emission: 0 },
            anchor,
            renderOrder: renderOrder++,
            visible: true,
        }, parent);
        if (sprite) {
            sprite._generated = true;
            sprites.push(sprite);
        }
    }
    // Animation-controller: tags → animations, sprites → layers.
    const layers = sprites.map((s) => ({
        name: s.name,
        spriteName: s.name,
        visible: true,
        slot: config.layerSlots?.[s.name],
    }));
    const controller = await newComponent('animation-controller', {
        name: `${config.packageId} Anim`,
        animations: buildAnimations(ase),
        layers,
        channels: ['albedo'],
    }, parent);
    if (controller)
        controller._generated = true;
    // Pack the newly-registered in-memory frames into the atlas (proxy method).
    await config.atlasManager.processTextureMaps();
    return { controller: controller ?? null, sprites };
}
/**
 * Multi-source variant: ingests several .aseprite files into ONE entity nexus by
 * "horizontal" ingestion — one sprite (and one texture-map) per unique LAYER
 * NAME across the whole set, not one per source. A set where every source has
 * `main`/`outline` layers produces exactly 2 sprites total, however many sources
 * are in the set. Each layer's texture-map holds every contributing source's
 * frames concatenated left-to-right in one canvas.
 *
 * Naming (vs the single-source `importAseprite`, which stays un-prefixed):
 *   - sprite / layer name : `${layerName}`  (flattened set: `${packageId}`) — shared, not per-source
 *   - texture key         : `aseprite:${artSetKey}:${layerName}`
 *   - synthetic filePath  : `aseprite://${artSetKey}/${layerName}`
 *   - animation name      : `${sourceKey}-${tagName}` — still per-source; this is how a caller
 *     "swaps costumes": play `${key}-walk` on the same small shared sprite set.
 *
 * Frame-index allocation: every source is assigned a disjoint block of the
 * SHARED frame-index space, `[frameOffset, frameOffset + ase.frameCount)`, in
 * source order. Every layer's texture-map reserves that same block for that
 * source — the engine's `AnimationController` applies one frame index to every
 * layer in lockstep (`updateSpriteFrames`), so a source's frames must land at
 * the same offset in every layer, not just within one. A layer some source
 * doesn't contribute to simply has no frame data in that source's block —
 * `originalFrames` is sparse (safe: atlas-manager resolves frames by
 * position/size key, not array position). If a caller leaves such a layer
 * visible while that source's animation plays, the renderer warns and skips
 * drawing that frame rather than crashing — hide layers the active source
 * doesn't use, same as any other layer-visibility toggle.
 *
 * `layerSlots`/`flatten` are set-level (apply to the whole set), not per-source
 * — a flattened source has no real layer name to union against others', so
 * mixed flatten states have no clean shared-sprite meaning.
 *
 * The once-per-loader steps (removeGeneratedChildren, ensure transform,
 * processTextureMaps) run exactly once around the per-layer loop.
 */
export async function importAsepriteSources(entries, config) {
    const parent = config.parent;
    // Object.entries preserves insertion order for non-numeric-string keys (the
    // documented requirement — see AsepriteSourceEntry/component.ts's `sources`
    // docs); this order drives both frame-offset allocation and canvas x-cursor
    // placement, so it must be stable across a set's declaration and its cache key.
    const sourceKeys = Object.keys(entries);
    const artSetKey = sourceKeys
        .map((k) => `${k}=${entries[k].filePath}`)
        .join('+');
    // Fast path: another entity already imported this art set and its SHARED
    // resources still exist in the current scene → build only the per-instance
    // sprites + controller from the cached blueprint (no fetch / parse / composite
    // / atlas work).
    const blueprint = BLUEPRINTS.get(artSetKey);
    if (blueprint && sharedResourcesExist(config, blueprint)) {
        return spawnFromBlueprint(parent, blueprint, config);
    }
    // Full import. Fetch every source's buffer NOW (in parallel) — only reached
    // when there's no cached blueprint, so repeat spawns never hit the network.
    const buffers = await Promise.all(sourceKeys.map(async (key) => {
        const e = entries[key];
        const res = await fetch(e.filePath);
        if (!res.ok) {
            console.error(`[aseprite-loader] failed to fetch source '${key}' ('${e.filePath}'): ${res.status} ${res.statusText}`);
            return null;
        }
        return res.arrayBuffer();
    }));
    // Idempotent rebuild + shared transform — ONCE, around the loop.
    removeGeneratedChildren(parent);
    await ensureTransform(parent, config.packageId, config);
    const flatten = config.flatten ?? true;
    // Parse every source that fetched successfully; allocate its frame-offset
    // block in the same pass (source order = allocation order).
    const parsedSources = [];
    let runningOffset = 0;
    for (let i = 0; i < sourceKeys.length; i++) {
        const buffer = buffers[i];
        if (!buffer)
            continue; // fetch failed for this source
        const key = sourceKeys[i];
        const entry = entries[key];
        const ase = await parseAseprite(buffer);
        const renderLayers = ase.layers.filter((l) => l.type === 0 && (!entry.visibleOnly || l.visible));
        parsedSources.push({ key, ase, renderLayers, frameOffset: runningOffset });
        runningOffset += ase.frameCount;
    }
    // Union layer names across every source (first-seen order), or degenerate to
    // one synthetic flattened entry — either way, EXACTLY one entry per shared sprite.
    let layerUnion;
    if (flatten) {
        const contributions = parsedSources
            .filter((s) => s.renderLayers.length > 0)
            .map((s) => ({ source: s, layers: s.renderLayers }));
        layerUnion =
            contributions.length > 0
                ? [{ name: config.packageId, contributions }]
                : [];
    }
    else {
        const order = [];
        const byName = new Map();
        for (const s of parsedSources) {
            for (const layer of s.renderLayers) {
                if (!byName.has(layer.name)) {
                    byName.set(layer.name, []);
                    order.push(layer.name);
                }
                byName.get(layer.name).push({ source: s, layers: [layer] });
            }
        }
        layerUnion = order.map((name) => ({ name, contributions: byName.get(name) }));
    }
    const allSprites = [];
    const allLayers = [];
    const bpBuilds = [];
    let renderOrder = 0;
    for (const entry of layerUnion) {
        const texKey = `aseprite:${artSetKey}:${entry.name}`;
        // Shared texture-map: composited once per key (skipped entirely if another
        // entity already registered this exact set+layer), owned by the scene root
        // so entity dispose never drops shared art.
        await config.atlasManager.getOrCreateTextureMap(texKey, async () => {
            const { canvas, originalFrames } = compositeLayerAcrossSources(entry);
            const tm = await newComponent('texture-map', {
                name: texKey,
                textureMapKey: texKey,
                filePath: `aseprite://${artSetKey}/${entry.name}`,
                sourceImage: canvas,
                // Frame rects are sparse/cross-source-offset — set directly below,
                // bypassing extractOriginalFrames's array-position-tied derivation.
                imageType: [],
            }, config.sharedParent);
            if (tm) {
                tm._generated = true;
                tm.originalFrames = originalFrames;
            }
            return tm ?? null;
        });
        // Anchor from the first contributing source (deterministic via source
        // order) — see the doc comment's mixed-dimension-sources gotcha.
        const anchor = resolveAnchor(entry.contributions[0].source.ase, config);
        const slot = config.layerSlots?.[entry.name];
        const bp = {
            spriteName: entry.name,
            texKey,
            anchor,
            renderOrder: renderOrder++,
            slot,
        };
        bpBuilds.push(bp);
        const sprite = await buildInstanceSprite(parent, bp);
        if (sprite)
            allSprites.push(sprite);
        allLayers.push({ name: entry.name, spriteName: entry.name, visible: true, slot });
    }
    // Tags stay namespaced per source (`walk` → `${key}-walk`), with every frame
    // number shifted into that source's allocated block of the shared frame space.
    const allAnimations = [];
    for (const s of parsedSources) {
        for (const anim of buildAnimations(s.ase)) {
            allAnimations.push({
                ...anim,
                name: `${s.key}-${anim.name}`,
                frames: anim.frames.map((f) => f + s.frameOffset),
            });
        }
    }
    // Shared animation-map (one per art set), referenced by the controller by key.
    const animationMapKey = artSetKey;
    await getOrCreateAnimationMap(config.sharedParent, animationMapKey, allAnimations);
    const controller = await newComponent('animation-controller', {
        name: `${config.packageId} Anim`,
        animations: animationMapKey, // reference the shared animation-map by key
        layers: allLayers,
        channels: ['albedo'],
    }, parent);
    if (controller)
        controller._generated = true;
    // Single atlas pass for the whole loader (all layers' frames at once).
    await config.atlasManager.processTextureMaps();
    BLUEPRINTS.set(artSetKey, { builds: bpBuilds, animationMapKey });
    return { controller: controller ?? null, sprites: allSprites };
}
/**
 * Builds one layer-name's combined canvas: every contributing source's frames,
 * concatenated left-to-right in source order, each frame tagged with its
 * `frameIndex` in the SHARED cross-source frame space (`source.frameOffset + f`)
 * so it lines up with every other layer's texture-map at the same frame index.
 * Canvas height is the max of contributing sources' heights (top-left aligned;
 * a shorter source's frames simply don't fill the bottom rows).
 */
function compositeLayerAcrossSources(entry) {
    let totalWidth = 0;
    let maxHeight = 0;
    for (const c of entry.contributions) {
        totalWidth += c.source.ase.width * c.source.ase.frameCount;
        maxHeight = Math.max(maxHeight, c.source.ase.height);
    }
    const canvas = createCanvas(totalWidth, maxHeight);
    const ctx = get2d(canvas);
    const originalFrames = [];
    let xCursor = 0;
    for (const c of entry.contributions) {
        const { ase } = c.source;
        for (let f = 0; f < ase.frameCount; f++) {
            const frame = ase.frames[f];
            const destX = xCursor + f * ase.width;
            for (const layer of c.layers) {
                const cel = frame.cels.find((cc) => cc.layerIndex === layer.index);
                if (cel)
                    blitCel(ctx, cel, layer.opacity, destX + cel.x, cel.y);
            }
            originalFrames.push({
                frameIndex: c.source.frameOffset + f,
                position: new Vector2D(destX, 0),
                size: new Vector2D(ase.width, ase.height),
            });
        }
        xCursor += ase.frameCount * ase.width;
    }
    return { canvas, originalFrames };
}
/** Creates one per-instance sprite from a blueprint build entry. */
async function buildInstanceSprite(parent, b) {
    const sprite = await newComponent('sprite', {
        name: b.spriteName,
        textureMapKeys: { albedo: b.texKey, normal: '', material: '', emission: '' },
        frame: { albedo: 0, normal: 0, material: 0, emission: 0 },
        anchor: b.anchor,
        renderOrder: b.renderOrder,
        visible: true,
    }, parent);
    if (sprite)
        sprite._generated = true;
    return sprite ?? null;
}
/** True when a cached blueprint's shared resources still exist in this scene. */
function sharedResourcesExist(config, blueprint) {
    if (blueprint.builds.length === 0)
        return false;
    const firstTex = config.atlasManager.getTextureMap(blueprint.builds[0].texKey);
    if (!firstTex)
        return false;
    return findAnimationMap(config.sharedParent, blueprint.animationMapKey) !== null;
}
/**
 * Blueprint fast-path: rebuild only the per-instance sprites + controller for one
 * entity, referencing the already-shared texture-maps + animation-map by key.
 */
async function spawnFromBlueprint(parent, blueprint, config) {
    removeGeneratedChildren(parent);
    await ensureTransform(parent, config.packageId, config);
    const sprites = [];
    const layers = [];
    for (const b of blueprint.builds) {
        const sprite = await buildInstanceSprite(parent, b);
        if (sprite)
            sprites.push(sprite);
        layers.push({
            name: b.spriteName,
            spriteName: b.spriteName,
            visible: true,
            slot: b.slot,
        });
    }
    const controller = await newComponent('animation-controller', {
        name: `${config.packageId} Anim`,
        animations: blueprint.animationMapKey,
        layers,
        channels: ['albedo'],
    }, parent);
    if (controller)
        controller._generated = true;
    return { controller: controller ?? null, sprites };
}
/** Finds an animation-map by key anywhere under `sharedParent`. */
function findAnimationMap(sharedParent, key) {
    const maps = (sharedParent.getComponentsByType('animation-map', true) ??
        []);
    return maps.find((m) => m.animationMapKey === key) ?? null;
}
/** Returns the shared animation-map for `key`, creating it once if absent. */
async function getOrCreateAnimationMap(sharedParent, key, animations) {
    const existing = findAnimationMap(sharedParent, key);
    if (existing)
        return existing;
    const map = await newComponent('animation-map', { name: key, animationMapKey: key, animations }, sharedParent);
    if (map)
        map._generated = true;
    return map ?? null;
}
/**
 * Resolves the sprite anchor: an explicit pixel `anchor` wins; else the named
 * mode against the parsed canvas size ('bottom-center' = foot-anchored); else
 * center.
 */
function resolveAnchor(ase, config) {
    return (config.anchor ??
        (config.anchorMode === 'bottom-center'
            ? new Vector2D(ase.width / 2, ase.height)
            : new Vector2D(ase.width / 2, ase.height / 2)));
}
/**
 * Ensures the nexus has a transform. It is NOT flagged `_generated`, so it
 * survives `removeGeneratedChildren` — keeping any runtime position across
 * re-inits.
 */
async function ensureTransform(parent, name, config) {
    if (!parent.getComponentByType('transform', false)) {
        await newComponent('transform', {
            name: `${name} Transform`,
            position: config.position ?? new Vector3D(0, 0, 0),
            scale: config.scale ?? new Vector3D(1, 1, 1),
        }, parent);
    }
}
/** One `Vector4D(f*w, 0, w, h)` frame rect per frame into the horizontal strip. */
function buildFrameRects(ase) {
    const rects = [];
    for (let f = 0; f < ase.frameCount; f++) {
        rects.push(new Vector4D(f * ase.width, 0, ase.width, ase.height));
    }
    return rects;
}
/**
 * Composites the given layers (ascending by index) of every frame onto a single
 * horizontal strip canvas: frame f occupies x = f*width. Each layer's trimmed
 * cel is blitted at its (x, y) offset honoring layer + cel opacity (normal blend).
 */
function compositeStrip(ase, layers) {
    const strip = createCanvas(ase.width * ase.frameCount, ase.height);
    const ctx = get2d(strip);
    for (let f = 0; f < ase.frameCount; f++) {
        const frame = ase.frames[f];
        for (const layer of layers) {
            const cel = frame.cels.find((c) => c.layerIndex === layer.index);
            if (cel)
                blitCel(ctx, cel, layer.opacity, f * ase.width + cel.x, cel.y);
        }
    }
    return strip;
}
/**
 * Blits one cel's RGBA pixels onto the destination context at (destX, destY),
 * applying combined layer×cel opacity. putImageData ignores globalAlpha, so the
 * cel goes through an intermediate canvas drawn with drawImage.
 */
function blitCel(ctx, cel, layerOpacity, destX, destY) {
    if (!cel.pixels || cel.w === 0 || cel.h === 0)
        return;
    const tmp = createCanvas(cel.w, cel.h);
    const tctx = get2d(tmp);
    tctx.putImageData(new ImageData(new Uint8ClampedArray(cel.pixels), cel.w, cel.h), 0, 0);
    const prevAlpha = ctx.globalAlpha;
    ctx.globalAlpha = (layerOpacity / 255) * (cel.opacity / 255);
    ctx.drawImage(tmp, destX, destY);
    ctx.globalAlpha = prevAlpha;
}
/**
 * Converts Aseprite tags into animations, carrying per-frame durations and
 * expanding reverse / ping-pong loop directions. With no tags, produces a single
 * `default` animation over every frame.
 */
function buildAnimations(ase) {
    if (ase.tags.length === 0) {
        const frames = frameRange(0, ase.frameCount - 1);
        return [
            {
                name: 'default',
                frames,
                frameDurations: frames.map((i) => ase.frames[i].durationMs),
                frameRate: 12,
                loop: true,
            },
        ];
    }
    return ase.tags.map((tag) => {
        let frames = frameRange(tag.from, tag.to);
        let durations = frames.map((i) => ase.frames[i].durationMs);
        if (tag.loopDir === 1) {
            // reverse
            frames = frames.slice().reverse();
            durations = durations.slice().reverse();
        }
        else if (tag.loopDir === 2 || tag.loopDir === 3) {
            // ping-pong: append the interior frames back-to-front
            const backFrames = frames.slice(1, -1).reverse();
            const backDurations = durations.slice(1, -1).reverse();
            frames = frames.concat(backFrames);
            durations = durations.concat(backDurations);
            if (tag.loopDir === 3) {
                frames.reverse();
                durations.reverse();
            }
        }
        return {
            name: tag.name,
            frames,
            frameDurations: durations,
            frameRate: 12,
            loop: tag.repeat === 0,
        };
    });
}
/** Inclusive integer range [from, to]. */
function frameRange(from, to) {
    const out = [];
    for (let i = from; i <= to; i++)
        out.push(i);
    return out;
}
/**
 * Disposes and removes this nexus's loader-generated children. Children are
 * engine component proxies, so `child.dispose()` dispatches the right teardown.
 */
function removeGeneratedChildren(parent) {
    const generated = parent.components.filter((c) => c._generated);
    for (const child of generated) {
        if (typeof child.dispose === 'function') {
            child.dispose();
        }
        else {
            child._disposed = true;
        }
    }
    parent.components = parent.components.filter((c) => !c._generated);
}
function createCanvas(w, h) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    return canvas;
}
function get2d(canvas) {
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        throw new Error('[aseprite] failed to acquire a 2D canvas context');
    }
    return ctx;
}
