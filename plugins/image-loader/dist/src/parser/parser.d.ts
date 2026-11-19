import type { AseCel, AseFile } from './types.js';
import { type FrameSelector, type LayerSelection } from '../selection.js';
/**
 * Indexes an Aseprite file without decoding any pixels. Every returned cel has
 * `pixels: null` (linked cels also `w = h = 0`) until `materializeCels` fills it.
 * The index keeps a reference to `buffer` for later materialization.
 *
 * @param buffer - The .aseprite file contents (e.g. from fetch().arrayBuffer()).
 */
export declare function indexAseprite(buffer: ArrayBuffer): AseFile;
/**
 * The cel for `layerIndex` on `frame`, or null. On an indexed file this is an
 * O(1) lookup; its `pixels` are null until materialized.
 */
export declare function getCel(ase: AseFile, frame: number, layerIndex: number): AseCel | null;
/**
 * Inflates (and link-resolves) the cels of `layerIndices` on `frameIndices`,
 * filling their `pixels`. Already-materialized cels are skipped, so calling this
 * again for a wider selection only pays for what's new. A linked cel pulls in
 * its source cel even when the source's frame isn't in the selection.
 *
 * @throws if `ase` didn't come from `indexAseprite` / `parseAseprite`.
 */
export declare function materializeCels(ase: AseFile, frameIndices: Iterable<number>, layerIndices: Iterable<number>): Promise<void>;
/**
 * Drops the decoded pixels of `layerIndices` on `frameIndices` (and of any cel
 * they link to), so a long-lived index doesn't keep every decoded cel in memory.
 * A later `materializeCels` re-decodes them.
 */
export declare function dropPixels(ase: AseFile, frameIndices: Iterable<number>, layerIndices: Iterable<number>): void;
/** Which slice of a file `parseAseprite` should decode. */
export interface AseSelection {
    /** Layer names (all same-named layers match) or a predicate. Default: every layer. */
    layers?: LayerSelection;
    /** Tags, absolute frame numbers, or tag-local frames (`'walk:3'`). Default: every frame. */
    frames?: FrameSelector[];
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
export declare function parseAseprite(buffer: ArrayBuffer, selection?: AseSelection): Promise<AseFile>;
