import { ByteReader } from './byte-reader.js';
import { inflateZlib } from './inflate.js';
import { resolveFrameSelectors, resolveLayers, } from '../selection.js';
/**
 * Dependency-free .aseprite/.ase parser, in two phases:
 *
 * 1. **Index** (`indexAseprite`, synchronous): walks the chunk headers once and
 *    records every cel's geometry and the byte range of its pixel data. No pixel
 *    data is copied or inflated, so even a 55k-cel file indexes in milliseconds.
 * 2. **Materialize** (`materializeCels`): inflates just the (frame, layer) cels a
 *    caller asks for, resolving linked cels on the way. Small cels go through the
 *    in-house synchronous inflate; anything it rejects or that's large goes
 *    through the browser-native `DecompressionStream` with bounded concurrency.
 *
 * `parseAseprite` is the one-shot convenience over both: index, select
 * (everything by default), materialize, and return a plain fully-resolved model.
 *
 * The format is chunk-based: a 128-byte header, then one block per frame, each a
 * 16-byte frame header followed by typed chunks. The cardinal robustness rule is
 * to seek to `chunkStart + chunkSize` after each chunk, so unknown/extra chunks
 * (and the pixel data of cels nobody asked for) are skipped exactly.
 */
const HEADER_MAGIC = 0xa5e0;
const FRAME_MAGIC = 0xf1fa;
const CHUNK_LAYER = 0x2004;
const CHUNK_CEL = 0x2005;
const CHUNK_TAGS = 0x2018;
const CEL_RAW = 0;
const CEL_LINKED = 1;
const CEL_COMPRESSED_IMAGE = 2;
/** Decompressed cels at or below this size use the synchronous inflate. */
const SYNC_INFLATE_LIMIT = 1 << 20;
/** Parallel DecompressionStream inflates (large or sync-rejected cels only). */
const ASYNC_INFLATE_CONCURRENCY = 8;
const INDEXES = new WeakMap();
/**
 * Indexes an Aseprite file without decoding any pixels. Every returned cel has
 * `pixels: null` (linked cels also `w = h = 0`) until `materializeCels` fills it.
 * The index keeps a reference to `buffer` for later materialization.
 *
 * @param buffer - The .aseprite file contents (e.g. from fetch().arrayBuffer()).
 */
export function indexAseprite(buffer) {
    const r = new ByteReader(buffer);
    // --- Header (128 bytes, fixed) ---
    r.readDword(); // file size
    const magic = r.readWord();
    if (magic !== HEADER_MAGIC) {
        throw new Error(`[aseprite] not an Aseprite file (bad header magic 0x${magic.toString(16)})`);
    }
    const frameCount = r.readWord();
    const width = r.readWord();
    const height = r.readWord();
    const colorDepth = r.readWord();
    // The remaining header fields (flags, speed, transparent index, palette size,
    // grid, reserved) are not needed here — skip to the fixed 128-byte boundary.
    r.seek(128);
    const layers = [];
    const tags = [];
    const frames = [];
    const grid = [];
    const sources = new WeakMap();
    for (let f = 0; f < frameCount; f++) {
        const frameStart = r.tell();
        const frameBytes = r.readDword();
        const frameMagic = r.readWord();
        if (frameMagic !== FRAME_MAGIC) {
            throw new Error(`[aseprite] bad frame magic 0x${frameMagic.toString(16)} at frame ${f}`);
        }
        let chunkCount = r.readWord(); // old 16-bit count
        const durationMs = r.readWord();
        r.skip(2); // reserved
        const newChunkCount = r.readDword(); // 32-bit count (0 ⇒ use old)
        if (newChunkCount !== 0)
            chunkCount = newChunkCount;
        const cels = [];
        const byLayer = new Map();
        for (let c = 0; c < chunkCount; c++) {
            const chunkStart = r.tell();
            const chunkSize = r.readDword();
            const chunkType = r.readWord();
            const chunkEnd = chunkStart + chunkSize;
            if (chunkType === CHUNK_LAYER) {
                const flags = r.readWord();
                const layerType = r.readWord();
                const childLevel = r.readWord();
                r.readWord(); // default width (ignored)
                r.readWord(); // default height (ignored)
                const blendMode = r.readWord();
                const opacity = r.readByte();
                r.skip(3); // reserved
                const name = r.readString();
                layers.push({
                    index: layers.length,
                    name,
                    visible: (flags & 1) !== 0,
                    type: layerType,
                    childLevel,
                    blendMode,
                    opacity,
                });
            }
            else if (chunkType === CHUNK_CEL) {
                const layerIndex = r.readWord();
                const x = r.readShort();
                const y = r.readShort();
                const opacity = r.readByte();
                const celType = r.readWord();
                r.readShort(); // z-index
                r.skip(5); // reserved
                let cel = null;
                if (celType === CEL_RAW || celType === CEL_COMPRESSED_IMAGE) {
                    const w = r.readWord();
                    const h = r.readWord();
                    cel = { layerIndex, x, y, w, h, opacity, pixels: null };
                    sources.set(cel, {
                        kind: celType === CEL_RAW ? 'raw' : 'compressed',
                        start: r.tell(),
                        end: chunkEnd,
                    });
                }
                else if (celType === CEL_LINKED) {
                    const linkedFrame = r.readWord();
                    cel = { layerIndex, x, y, w: 0, h: 0, opacity, pixels: null, linkedFrame };
                    sources.set(cel, { kind: 'linked', start: 0, end: 0 });
                }
                // celType 3 (compressed tilemap) is unsupported for these RGBA sprite
                // assets; the chunk-boundary seek below skips it.
                if (cel) {
                    cels.push(cel);
                    if (!byLayer.has(layerIndex))
                        byLayer.set(layerIndex, cel);
                }
            }
            else if (chunkType === CHUNK_TAGS) {
                const tagCount = r.readWord();
                r.skip(8); // reserved
                for (let t = 0; t < tagCount; t++) {
                    const from = r.readWord();
                    const to = r.readWord();
                    const loopDir = r.readByte();
                    const repeat = r.readWord();
                    r.skip(6); // reserved
                    r.skip(3); // deprecated tag RGB color
                    r.skip(1); // extra byte
                    const name = r.readString();
                    tags.push({ name, from, to, loopDir, repeat });
                }
            }
            // Cardinal robustness rule: skip to the declared end of the chunk so any
            // unparsed/unknown chunk (palette, profile, user data, tileset, …), any
            // trailing bytes, and every cel's pixel data are stepped over exactly.
            r.seek(chunkEnd);
        }
        frames.push({ durationMs, cels });
        grid.push(byLayer);
        r.seek(frameStart + frameBytes);
    }
    const ase = { width, height, colorDepth, frameCount, layers, frames, tags };
    INDEXES.set(ase, {
        bytes: new Uint8Array(buffer),
        bytesPerPixel: Math.max(1, colorDepth >> 3),
        grid,
        sources,
        pending: new WeakMap(),
    });
    return ase;
}
/**
 * The cel for `layerIndex` on `frame`, or null. On an indexed file this is an
 * O(1) lookup; its `pixels` are null until materialized.
 */
export function getCel(ase, frame, layerIndex) {
    const state = INDEXES.get(ase);
    if (state)
        return state.grid[frame]?.get(layerIndex) ?? null;
    return ase.frames[frame]?.cels.find((c) => c.layerIndex === layerIndex) ?? null;
}
/**
 * Inflates (and link-resolves) the cels of `layerIndices` on `frameIndices`,
 * filling their `pixels`. Already-materialized cels are skipped, so calling this
 * again for a wider selection only pays for what's new. A linked cel pulls in
 * its source cel even when the source's frame isn't in the selection.
 *
 * @throws if `ase` didn't come from `indexAseprite` / `parseAseprite`.
 */
export async function materializeCels(ase, frameIndices, layerIndices) {
    const state = INDEXES.get(ase);
    if (!state) {
        throw new Error('[aseprite] materializeCels needs a model from indexAseprite');
    }
    const layerList = Array.from(layerIndices);
    const links = [];
    const work = new Set();
    for (const f of frameIndices) {
        for (const l of layerList) {
            const cel = state.grid[f]?.get(l);
            if (!cel || cel.pixels)
                continue;
            const src = state.sources.get(cel);
            if (src?.kind === 'linked') {
                const source = followLink(state, f, l);
                if (source) {
                    links.push({ cel, source });
                    if (!source.pixels)
                        work.add(source);
                }
            }
            else {
                work.add(cel);
            }
        }
    }
    const asyncQueue = [];
    const waits = [];
    for (const cel of work) {
        const inFlight = state.pending.get(cel);
        if (inFlight) {
            waits.push(inFlight);
            continue;
        }
        if (!decodeSync(state, cel))
            asyncQueue.push(cel);
    }
    if (asyncQueue.length > 0)
        waits.push(decodeAsync(state, asyncQueue));
    await Promise.all(waits);
    for (const { cel, source } of links) {
        cel.x = source.x;
        cel.y = source.y;
        cel.w = source.w;
        cel.h = source.h;
        cel.pixels = source.pixels;
    }
}
/**
 * Drops the decoded pixels of `layerIndices` on `frameIndices` (and of any cel
 * they link to), so a long-lived index doesn't keep every decoded cel in memory.
 * A later `materializeCels` re-decodes them.
 */
export function dropPixels(ase, frameIndices, layerIndices) {
    const state = INDEXES.get(ase);
    if (!state)
        return;
    const layerList = Array.from(layerIndices);
    for (const f of frameIndices) {
        for (const l of layerList) {
            const cel = state.grid[f]?.get(l);
            if (!cel)
                continue;
            if (cel.linkedFrame !== undefined) {
                const source = followLink(state, f, l);
                if (source) {
                    source.pixels = null;
                    state.pending.delete(source);
                }
            }
            cel.pixels = null;
            state.pending.delete(cel);
        }
    }
}
/** Follows a linked-cel chain to its first non-linked cel. Bounded by frame count. */
function followLink(state, frame, layer) {
    let index = frame;
    for (let guard = 0; guard <= state.grid.length; guard++) {
        const cel = state.grid[index]?.get(layer);
        if (!cel)
            return null;
        if (cel.linkedFrame === undefined)
            return cel;
        index = cel.linkedFrame;
    }
    return null;
}
/** Decodes a raw cel, or a compressed one small enough to inflate synchronously. */
function decodeSync(state, cel) {
    const src = state.sources.get(cel);
    if (!src)
        return true;
    const size = cel.w * cel.h * state.bytesPerPixel;
    if (src.kind === 'raw') {
        cel.pixels = state.bytes.slice(src.start, Math.min(src.end, src.start + size));
        return true;
    }
    if (size > SYNC_INFLATE_LIMIT)
        return false;
    try {
        cel.pixels = inflateZlib(state.bytes.subarray(src.start, src.end), size);
        return true;
    }
    catch {
        // Anything this decoder rejects gets a second opinion from the browser.
        return false;
    }
}
/** Inflates the given compressed cels via DecompressionStream, a few at a time. */
function decodeAsync(state, cels) {
    let next = 0;
    const worker = async () => {
        while (next < cels.length) {
            const cel = cels[next++];
            const src = state.sources.get(cel);
            if (src)
                cel.pixels = await inflateNative(state.bytes.subarray(src.start, src.end));
        }
    };
    const run = Promise.all(Array.from({ length: Math.min(ASYNC_INFLATE_CONCURRENCY, cels.length) }, worker)).then(() => undefined);
    for (const cel of cels)
        state.pending.set(cel, run);
    return run;
}
/**
 * Inflates zlib-wrapped (deflate) data using the browser-native
 * DecompressionStream. No third-party dependency. Requires an evergreen browser.
 */
async function inflateNative(data) {
    if (typeof DecompressionStream === 'undefined') {
        throw new Error('[aseprite] DecompressionStream is unavailable; decoding this .aseprite ' +
            'cel requires an evergreen browser (Chrome 80+, Safari 16.4+, Firefox 113+).');
    }
    const ds = new DecompressionStream('deflate');
    // Copy into a fresh ArrayBuffer-backed view so it's a valid BlobPart (the
    // source view's buffer is typed ArrayBufferLike, which Blob rejects).
    const part = new Uint8Array(data);
    const stream = new Blob([part]).stream().pipeThrough(ds);
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
}
/**
 * Parses an Aseprite file from its raw bytes into a fully-resolved model.
 *
 * With no `selection`, every cel of every layer is decoded — the same result as
 * always. With one, only the selected layers × frames are decoded: `layers` and
 * `tags` still describe the whole file and `frames` keeps its full length (so
 * frame numbers stay absolute), but `frames[f].cels` holds only the selected
 * layers' cels, and only on selected frames.
 *
 * @param buffer - The .aseprite file contents (e.g. from fetch().arrayBuffer()).
 * @param selection - Optional slice to decode.
 */
export async function parseAseprite(buffer, selection) {
    const ase = indexAseprite(buffer);
    if (!selection || (!selection.layers && !selection.frames)) {
        await materializeCels(ase, range(ase.frameCount), ase.layers.map((l) => l.index));
        return ase;
    }
    const layerIndices = selection.layers
        ? resolveLayers(ase, selection.layers, { imageOnly: false }).map((l) => l.index)
        : ase.layers.map((l) => l.index);
    const frameSet = new Set(selection.frames
        ? resolveFrameSelectors(ase, selection.frames).frames
        : range(ase.frameCount));
    await materializeCels(ase, frameSet, layerIndices);
    const keep = new Set(layerIndices);
    return {
        ...ase,
        frames: ase.frames.map((frame, f) => ({
            durationMs: frame.durationMs,
            cels: frameSet.has(f) ? frame.cels.filter((c) => keep.has(c.layerIndex)) : [],
        })),
    };
}
function range(n) {
    const out = [];
    for (let i = 0; i < n; i++)
        out.push(i);
    return out;
}
