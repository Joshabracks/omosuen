/**
 * Synchronous zlib (RFC 1950) / DEFLATE (RFC 1951) decoder — an in-house port
 * of the canonical-Huffman "puff" approach, so the plugin stays dependency-free.
 *
 * Why it exists: Aseprite stores every cel as its own zlib stream. Inflating
 * them through `DecompressionStream` costs a Blob → stream → Response round trip
 * of ~0.2 ms *per cel* regardless of size, which dominates large files (55k
 * cels ≈ 11 s). Typical sprite cels are a few hundred bytes, which this decodes
 * synchronously in microseconds.
 *
 * The output size is always known up front for a cel (w × h × bytes-per-pixel),
 * so the output buffer is allocated once and any stream that over- or
 * under-runs it is rejected. The parser treats any throw from here as "use the
 * browser-native path instead" — this decoder never has to be the last word.
 *
 * The Adler-32 trailer is not verified (the exact-length check already catches
 * truncation and most corruption, and the fallback re-decodes anything odd).
 */
/**
 * Decodes a zlib-wrapped DEFLATE stream whose decompressed length is known.
 *
 * @param data - zlib stream (2-byte header, DEFLATE blocks, Adler-32 trailer).
 * @param expectedSize - Exact decompressed size in bytes.
 * @throws on any malformed stream, a preset dictionary, or a size mismatch.
 */
export declare function inflateZlib(data: Uint8Array, expectedSize: number): Uint8Array;
