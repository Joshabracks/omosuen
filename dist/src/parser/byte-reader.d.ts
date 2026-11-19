/**
 * Little-endian cursor over an ArrayBuffer, with the primitive readers the
 * Aseprite binary format uses. Pure and environment-agnostic (no engine or DOM
 * coupling beyond DataView / TextDecoder, which exist everywhere).
 */
export declare class ByteReader {
    private readonly view;
    private readonly bytes;
    private offset;
    private static readonly decoder;
    constructor(buffer: ArrayBuffer);
    /** Reads an unsigned 8-bit integer and advances 1 byte. */
    readByte(): number;
    /** Reads an unsigned 16-bit LE integer and advances 2 bytes. */
    readWord(): number;
    /** Reads a signed 16-bit LE integer and advances 2 bytes. */
    readShort(): number;
    /** Reads an unsigned 32-bit LE integer and advances 4 bytes. */
    readDword(): number;
    /** Reads a signed 32-bit LE integer and advances 4 bytes. */
    readLong(): number;
    /**
     * Reads `n` bytes into a fresh Uint8Array (a copy, so it does not retain the
     * whole file buffer) and advances `n` bytes.
     */
    readBytes(n: number): Uint8Array;
    /** Reads an Aseprite STRING (WORD length prefix + UTF-8 bytes). */
    readString(): string;
    /** Advances `n` bytes without reading. */
    skip(n: number): void;
    /** Moves the cursor to an absolute byte offset. */
    seek(pos: number): void;
    /** Returns the current absolute byte offset. */
    tell(): number;
}
