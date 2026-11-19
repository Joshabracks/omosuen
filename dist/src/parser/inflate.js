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
// Length codes 257..285: base lengths and extra bits.
const LENGTH_BASE = new Uint16Array([
    3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67,
    83, 99, 115, 131, 163, 195, 227, 258,
]);
const LENGTH_EXTRA = new Uint8Array([
    0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5,
    5, 5, 0,
]);
// Distance codes 0..29: base distances and extra bits.
const DIST_BASE = new Uint16Array([
    1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769,
    1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
]);
const DIST_EXTRA = new Uint8Array([
    0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11,
    11, 12, 12, 13, 13,
]);
// Order code-length code lengths are transmitted in (dynamic blocks).
const CL_ORDER = new Uint8Array([
    16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15,
]);
const MAX_BITS = 15;
/**
 * Builds a canonical Huffman decoder from per-symbol code lengths. Returns the
 * number of unused codes: 0 = complete, > 0 = incomplete (legal only for a
 * single-code distance tree), < 0 = over-subscribed (always invalid).
 */
function buildHuffman(h, lengths, n) {
    h.count.fill(0);
    for (let s = 0; s < n; s++)
        h.count[lengths[s]]++;
    if (h.count[0] === n)
        return 0; // no codes at all — complete, but unusable
    let left = 1;
    for (let len = 1; len <= MAX_BITS; len++) {
        left <<= 1;
        left -= h.count[len];
        if (left < 0)
            return left;
    }
    const offs = new Uint16Array(MAX_BITS + 1);
    for (let len = 1; len < MAX_BITS; len++) {
        offs[len + 1] = offs[len] + h.count[len];
    }
    for (let s = 0; s < n; s++) {
        if (lengths[s] !== 0)
            h.symbol[offs[lengths[s]]++] = s;
    }
    return left;
}
function newHuffman(symbols) {
    return {
        count: new Uint16Array(MAX_BITS + 1),
        symbol: new Uint16Array(symbols),
    };
}
let fixedLit = null;
let fixedDist = null;
/** The fixed literal/length + distance codes (RFC 1951 §3.2.6), built once. */
function fixedTables() {
    if (!fixedLit || !fixedDist) {
        const lengths = new Uint8Array(288);
        let s = 0;
        for (; s < 144; s++)
            lengths[s] = 8;
        for (; s < 256; s++)
            lengths[s] = 9;
        for (; s < 280; s++)
            lengths[s] = 7;
        for (; s < 288; s++)
            lengths[s] = 8;
        fixedLit = newHuffman(288);
        buildHuffman(fixedLit, lengths, 288);
        const dl = new Uint8Array(30).fill(5);
        fixedDist = newHuffman(30);
        buildHuffman(fixedDist, dl, 30);
    }
    return [fixedLit, fixedDist];
}
/** Bit-level reader + bounded output writer for one stream. */
class InflateState {
    constructor(input, out, start) {
        this.input = input;
        this.out = out;
        this.bitBuf = 0;
        this.bitCnt = 0;
        this.outPos = 0;
        this.inPos = start;
    }
    bits(need) {
        let val = this.bitBuf;
        while (this.bitCnt < need) {
            if (this.inPos >= this.input.length) {
                throw new Error('inflate: unexpected end of input');
            }
            val |= this.input[this.inPos++] << this.bitCnt;
            this.bitCnt += 8;
        }
        this.bitBuf = val >>> need;
        this.bitCnt -= need;
        return val & ((1 << need) - 1);
    }
    /** Drops any bits left in the current byte (start of a stored block). */
    alignToByte() {
        this.bitBuf = 0;
        this.bitCnt = 0;
    }
    byte() {
        if (this.inPos >= this.input.length) {
            throw new Error('inflate: unexpected end of input');
        }
        return this.input[this.inPos++];
    }
    decode(h) {
        let code = 0;
        let first = 0;
        let index = 0;
        for (let len = 1; len <= MAX_BITS; len++) {
            code |= this.bits(1);
            const count = h.count[len];
            if (code - count < first)
                return h.symbol[index + (code - first)];
            index += count;
            first += count;
            first <<= 1;
            code <<= 1;
        }
        throw new Error('inflate: invalid Huffman code');
    }
    put(byte) {
        if (this.outPos >= this.out.length) {
            throw new Error('inflate: output exceeds expected size');
        }
        this.out[this.outPos++] = byte;
    }
}
function stored(s) {
    s.alignToByte();
    const len = s.byte() | (s.byte() << 8);
    const nlen = s.byte() | (s.byte() << 8);
    if (len !== (~nlen & 0xffff)) {
        throw new Error('inflate: stored block length mismatch');
    }
    for (let i = 0; i < len; i++)
        s.put(s.byte());
}
function codes(s, lit, dist) {
    const out = s.out;
    for (;;) {
        const sym = s.decode(lit);
        if (sym < 256) {
            s.put(sym);
            continue;
        }
        if (sym === 256)
            return;
        const li = sym - 257;
        if (li >= 29)
            throw new Error('inflate: invalid length symbol');
        const len = LENGTH_BASE[li] + s.bits(LENGTH_EXTRA[li]);
        const di = s.decode(dist);
        if (di >= 30)
            throw new Error('inflate: invalid distance symbol');
        const d = DIST_BASE[di] + s.bits(DIST_EXTRA[di]);
        if (d > s.outPos)
            throw new Error('inflate: distance too far back');
        if (s.outPos + len > out.length) {
            throw new Error('inflate: output exceeds expected size');
        }
        // Byte-by-byte so an overlapping copy (d < len) repeats correctly.
        let from = s.outPos - d;
        for (let i = 0; i < len; i++)
            out[s.outPos++] = out[from++];
    }
}
function dynamic(s) {
    const nlen = s.bits(5) + 257;
    const ndist = s.bits(5) + 1;
    const ncode = s.bits(4) + 4;
    if (nlen > 286 || ndist > 30) {
        throw new Error('inflate: bad dynamic code counts');
    }
    const lengths = new Uint8Array(320);
    for (let i = 0; i < ncode; i++)
        lengths[CL_ORDER[i]] = s.bits(3);
    const clCode = newHuffman(19);
    if (buildHuffman(clCode, lengths, 19) !== 0) {
        throw new Error('inflate: incomplete code-length code');
    }
    lengths.fill(0);
    let index = 0;
    while (index < nlen + ndist) {
        let sym = s.decode(clCode);
        if (sym < 16) {
            lengths[index++] = sym;
            continue;
        }
        let len = 0;
        if (sym === 16) {
            if (index === 0)
                throw new Error('inflate: repeat with no first length');
            len = lengths[index - 1];
            sym = 3 + s.bits(2);
        }
        else if (sym === 17) {
            sym = 3 + s.bits(3);
        }
        else {
            sym = 11 + s.bits(7);
        }
        if (index + sym > nlen + ndist) {
            throw new Error('inflate: too many code lengths');
        }
        while (sym--)
            lengths[index++] = len;
    }
    if (lengths[256] === 0)
        throw new Error('inflate: no end-of-block code');
    const lit = newHuffman(286);
    const litLeft = buildHuffman(lit, lengths, nlen);
    if (litLeft < 0 || (litLeft > 0 && nlen - lit.count[0] !== 1)) {
        throw new Error('inflate: bad literal/length code');
    }
    const dist = newHuffman(30);
    const distLeft = buildHuffman(dist, lengths.subarray(nlen), ndist);
    if (distLeft < 0 || (distLeft > 0 && ndist - dist.count[0] !== 1)) {
        throw new Error('inflate: bad distance code');
    }
    codes(s, lit, dist);
}
/**
 * Decodes a zlib-wrapped DEFLATE stream whose decompressed length is known.
 *
 * @param data - zlib stream (2-byte header, DEFLATE blocks, Adler-32 trailer).
 * @param expectedSize - Exact decompressed size in bytes.
 * @throws on any malformed stream, a preset dictionary, or a size mismatch.
 */
export function inflateZlib(data, expectedSize) {
    if (data.length < 2)
        throw new Error('inflate: truncated zlib header');
    const cmf = data[0];
    const flg = data[1];
    if ((cmf & 0x0f) !== 8 || cmf >> 4 > 7 || ((cmf << 8) | flg) % 31 !== 0) {
        throw new Error('inflate: bad zlib header');
    }
    if (flg & 0x20)
        throw new Error('inflate: preset dictionary unsupported');
    const out = new Uint8Array(expectedSize);
    const s = new InflateState(data, out, 2);
    let last = 0;
    do {
        last = s.bits(1);
        const type = s.bits(2);
        if (type === 0) {
            stored(s);
        }
        else if (type === 1) {
            const [lit, dist] = fixedTables();
            codes(s, lit, dist);
        }
        else if (type === 2) {
            dynamic(s);
        }
        else {
            throw new Error('inflate: invalid block type');
        }
    } while (!last);
    if (s.outPos !== expectedSize) {
        throw new Error(`inflate: produced ${s.outPos} bytes, expected ${expectedSize}`);
    }
    return out;
}
