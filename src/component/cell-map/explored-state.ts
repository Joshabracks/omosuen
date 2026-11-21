/**
 * The portable form of the fog-of-war "explored" map: which world cells a
 * vision source has ever seen, for a game that saves and loads its own state
 * rather than the engine's scene serialization.
 *
 * Keyed by WORLD chunk coordinate, never by window slot, so a snapshot can be
 * restored into a map whose resident window sits somewhere else entirely (or
 * has not streamed in yet). Plain numbers, arrays and strings throughout, so it
 * round-trips through JSON as-is.
 *
 * Leaf module (no registry imports) so it can be unit-tested headless.
 */

/**
 * One chunk's cells, packed whichever way came out smaller:
 *
 * - `number[]`: alternating run lengths over the chunk's cells (x fastest, then
 *   y, then z), starting with an UNEXPLORED run. A fully explored chunk of N
 *   cells is `[0, N]`.
 * - `string`: base64 of a one-bit-per-cell mask (cell `i` is bit `i & 7` of
 *   byte `i >> 3`), for a ragged chunk whose run list would be longer.
 */
export type ExploredChunkData = number[] | string;

/** A whole explored map. See the module comment. */
export interface ExploredState {
  version: 1;
  /** Cells per chunk on each axis; fixes how `chunks` is addressed. */
  chunkSize: { x: number; y: number; z: number };
  /** Every chunk holding at least one explored cell: world-chunk coordinate + cells. */
  chunks: Array<[cx: number, cy: number, cz: number, data: ExploredChunkData]>;
}

const BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Standard padded base64. In-house so this runs anywhere, with no globals. */
function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += BASE64_ALPHABET[b0 >> 2];
    out += BASE64_ALPHABET[((b0 & 3) << 4) | (b1 >> 4)];
    out +=
      i + 1 < bytes.length
        ? BASE64_ALPHABET[((b1 & 15) << 2) | (b2 >> 6)]
        : '=';
    out += i + 2 < bytes.length ? BASE64_ALPHABET[b2 & 63] : '=';
  }
  return out;
}

/** Inverse of {@link bytesToBase64}; null for anything that is not base64. */
function base64ToBytes(text: string): Uint8Array | null {
  if (text.length % 4 !== 0) return null;
  let padding = 0;
  if (text.endsWith('==')) padding = 2;
  else if (text.endsWith('=')) padding = 1;
  const bytes = new Uint8Array((text.length / 4) * 3 - padding);
  let o = 0;
  for (let i = 0; i < text.length; i += 4) {
    let word = 0;
    for (let k = 0; k < 4; k++) {
      const ch = text[i + k];
      const isPad = ch === '=' && i + k >= text.length - padding;
      const value = isPad ? 0 : BASE64_ALPHABET.indexOf(ch);
      if (value < 0) return null;
      word = (word << 6) | value;
    }
    if (o < bytes.length) bytes[o++] = (word >> 16) & 0xff;
    if (o < bytes.length) bytes[o++] = (word >> 8) & 0xff;
    if (o < bytes.length) bytes[o++] = word & 0xff;
  }
  return bytes;
}

function encodeBits(cells: ArrayLike<number>, count: number): string {
  const bytes = new Uint8Array(Math.ceil(count / 8));
  for (let i = 0; i < count; i++) {
    if (cells[i] !== 0) bytes[i >> 3] |= 1 << (i & 7);
  }
  return bytesToBase64(bytes);
}

/**
 * Packs the first `count` values of `cells` (non-zero = explored).
 *
 * Chooses by the length each form takes once written as JSON, which is what a
 * save actually pays for.
 */
export function encodeExploredChunk(
  cells: ArrayLike<number>,
  count: number,
): ExploredChunkData {
  // 4 base64 characters per 3 bytes, plus the two quotes.
  const maskLength = Math.ceil(Math.ceil(count / 8) / 3) * 4 + 2;

  const runs: number[] = [];
  // Brackets, then one comma per run after the first.
  let runsLength = 1;
  let explored = false;
  let run = 0;
  for (let i = 0; i <= count; i++) {
    const value = i < count && cells[i] !== 0;
    if (i < count && value === explored) {
      run++;
      continue;
    }
    runs.push(run);
    runsLength += String(run).length + 1;
    // Already longer than the mask and only growing: stop counting.
    if (runsLength > maskLength) return encodeBits(cells, count);
    explored = value;
    run = 1;
  }
  return runs;
}

/**
 * Unpacks one chunk into `out` as 0 / 1, filling exactly `out.length` cells.
 *
 * Returns false, leaving `out` in an unspecified state, when `data` does not
 * describe a chunk of that size -- a hand-edited or truncated save.
 */
export function decodeExploredChunk(data: unknown, out: Uint32Array): boolean {
  const count = out.length;
  if (typeof data === 'string') {
    const bytes = base64ToBytes(data);
    if (!bytes || bytes.length !== Math.ceil(count / 8)) return false;
    for (let i = 0; i < count; i++) {
      out[i] = (bytes[i >> 3] >> (i & 7)) & 1;
    }
    return true;
  }
  if (!Array.isArray(data)) return false;
  let index = 0;
  let value = 0;
  for (const run of data) {
    if (typeof run !== 'number' || !Number.isInteger(run) || run < 0) {
      return false;
    }
    if (index + run > count) return false;
    out.fill(value, index, index + run);
    index += run;
    value = value === 0 ? 1 : 0;
  }
  return index === count;
}

function isPositiveInteger(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/**
 * Whether `value` has the outer shape of an {@link ExploredState}. Individual
 * chunks are checked as they are decoded, so one bad entry costs only itself.
 */
export function isExploredState(value: unknown): value is ExploredState {
  if (!value || typeof value !== 'object') return false;
  const state = value as {
    version?: unknown;
    chunkSize?: { x?: unknown; y?: unknown; z?: unknown } | null;
    chunks?: unknown;
  };
  if (state.version !== 1) return false;
  const size = state.chunkSize;
  if (!size || typeof size !== 'object') return false;
  if (
    !isPositiveInteger(size.x) ||
    !isPositiveInteger(size.y) ||
    !isPositiveInteger(size.z)
  ) {
    return false;
  }
  return Array.isArray(state.chunks);
}

/** Whether one `chunks` entry is `[integer, integer, integer, data]`. */
export function isExploredChunkEntry(
  entry: unknown,
): entry is [number, number, number, ExploredChunkData] {
  return (
    Array.isArray(entry) &&
    entry.length === 4 &&
    Number.isInteger(entry[0]) &&
    Number.isInteger(entry[1]) &&
    Number.isInteger(entry[2])
  );
}
