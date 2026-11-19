// Resolves a loader's `layers` / `frames` selection against a parsed (or just
// indexed) Aseprite file. Pure: no engine, no DOM — shared by the parser's
// one-shot `parseAseprite(buffer, selection)` and the importer's lazy sessions.
/** Group id for the default selection's untagged frames (never an animation). */
export const UNTAGGED_GROUP = '*';
const TAG_FRAME = /^(.*):(\d+)$/;
/** The normalized name a selector resolves to (also its animation name). */
export function selectorId(sel) {
    if (typeof sel === 'number')
        return String(sel);
    if (typeof sel === 'string')
        return sel;
    return sel.frame === undefined ? sel.tag : `${sel.tag}:${sel.frame}`;
}
/** Converts a tag to an animation, expanding reverse / ping-pong directions. */
export function tagAnimation(ase, tag, name = tag.name) {
    let frames = inclusiveRange(tag.from, tag.to);
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
    return { name, frames, frameDurations: durations, frameRate: 12, loop: tag.repeat === 0 };
}
function singleFrame(ase, id, frame) {
    return {
        id,
        frames: [frame],
        animation: {
            name: id,
            frames: [frame],
            frameDurations: [ase.frames[frame].durationMs],
            frameRate: 12,
            loop: true,
        },
    };
}
function tagGroup(ase, tag) {
    return { id: tag.name, frames: inclusiveRange(tag.from, tag.to), animation: tagAnimation(ase, tag) };
}
function tagFrameGroup(ase, tag, local) {
    const frame = tag.from + local;
    if (!Number.isInteger(local) || local < 0 || frame > tag.to)
        return null;
    return singleFrame(ase, `${tag.name}:${local}`, frame);
}
/** Resolves one selector, or null when it names nothing in this file. */
export function resolveFrameSelector(ase, sel) {
    const findTag = (name) => ase.tags.find((t) => t.name === name);
    if (typeof sel === 'number') {
        if (!Number.isInteger(sel) || sel < 0 || sel >= ase.frameCount)
            return null;
        return singleFrame(ase, String(sel), sel);
    }
    if (typeof sel === 'string') {
        const tag = findTag(sel);
        if (tag)
            return tagGroup(ase, tag);
        const m = TAG_FRAME.exec(sel);
        if (!m)
            return null;
        const inner = findTag(m[1]);
        return inner ? tagFrameGroup(ase, inner, Number(m[2])) : null;
    }
    if (!sel || typeof sel.tag !== 'string')
        return null;
    const tag = findTag(sel.tag);
    if (!tag)
        return null;
    return sel.frame === undefined ? tagGroup(ase, tag) : tagFrameGroup(ase, tag, sel.frame);
}
/**
 * Resolves a selector list. `frames` is the union of every group's frames;
 * `missing` lists selectors that matched nothing (callers warn).
 */
export function resolveFrameSelectors(ase, sels) {
    const groups = [];
    const seen = new Set();
    const missing = [];
    for (const sel of sels) {
        const g = resolveFrameSelector(ase, sel);
        if (!g) {
            missing.push(selectorId(sel));
            continue;
        }
        if (seen.has(g.id))
            continue;
        seen.add(g.id);
        groups.push(g);
    }
    return { groups, frames: unionFrames(groups), missing };
}
/**
 * The selection used when no `frames` are given: one group per tag (each
 * exposing its animation), plus a hold-only group for frames no tag covers —
 * so every frame stays decoded, as before. A file without tags gets a single
 * `default` animation over every frame.
 */
export function defaultFrameGroups(ase) {
    if (ase.frameCount === 0)
        return [];
    if (ase.tags.length === 0) {
        const frames = inclusiveRange(0, ase.frameCount - 1);
        return [
            {
                id: 'default',
                frames,
                animation: {
                    name: 'default',
                    frames,
                    frameDurations: frames.map((i) => ase.frames[i].durationMs),
                    frameRate: 12,
                    loop: true,
                },
            },
        ];
    }
    const groups = [];
    const covered = new Set();
    const seen = new Set();
    for (const tag of ase.tags) {
        if (seen.has(tag.name))
            continue;
        seen.add(tag.name);
        const g = tagGroup(ase, tag);
        for (const f of g.frames)
            covered.add(f);
        groups.push(g);
    }
    const untagged = [];
    for (let f = 0; f < ase.frameCount; f++)
        if (!covered.has(f))
            untagged.push(f);
    if (untagged.length > 0)
        groups.push({ id: UNTAGGED_GROUP, frames: untagged, animation: null });
    return groups;
}
/** Ascending, de-duplicated union of the groups' frames. */
export function unionFrames(groups) {
    const set = new Set();
    for (const g of groups)
        for (const f of g.frames)
            set.add(f);
    return Array.from(set).sort((a, b) => a - b);
}
/**
 * The selected layers, in file (draw) order. With no `selection`, the base is
 * every layer, or every visible layer when `visibleOnly` is set — the saved
 * visibility is the default, an explicit `selection` overrides it.
 */
export function resolveLayers(ase, selection, opts = {}) {
    const imageOnly = opts.imageOnly ?? true;
    const names = Array.isArray(selection) ? new Set(selection) : null;
    const pred = typeof selection === 'function' ? selection : null;
    return ase.layers.filter((l) => {
        if (imageOnly && l.type !== 0)
            return false;
        if (opts.exclude?.has(l.name))
            return false;
        if (opts.include?.has(l.name))
            return true;
        if (names)
            return names.has(l.name);
        if (pred)
            return pred(l.name, l);
        return !opts.visibleOnly || l.visible;
    });
}
/** Names in `wanted` that match no image layer in the file (for warnings). */
export function missingLayerNames(ase, wanted) {
    const present = new Set(ase.layers.filter((l) => l.type === 0).map((l) => l.name));
    return Array.from(wanted).filter((n) => !present.has(n));
}
function inclusiveRange(from, to) {
    const out = [];
    for (let i = from; i <= to; i++)
        out.push(i);
    return out;
}
