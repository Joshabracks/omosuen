/**
 * Little-endian cursor over an ArrayBuffer, with the primitive readers the
 * Aseprite binary format uses. Pure and environment-agnostic (no engine or DOM
 * coupling beyond DataView / TextDecoder, which exist everywhere).
 */
export class ByteReader {
  private readonly view: DataView;
  private readonly bytes: Uint8Array;
  private offset = 0;
  private static readonly decoder = new TextDecoder('utf-8');

  constructor(buffer: ArrayBuffer) {
    this.view = new DataView(buffer);
    this.bytes = new Uint8Array(buffer);
  }

  /** Reads an unsigned 8-bit integer and advances 1 byte. */
  readByte(): number {
    const v = this.view.getUint8(this.offset);
    this.offset += 1;
    return v;
  }

  /** Reads an unsigned 16-bit LE integer and advances 2 bytes. */
  readWord(): number {
    const v = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return v;
  }

  /** Reads a signed 16-bit LE integer and advances 2 bytes. */
  readShort(): number {
    const v = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return v;
  }

  /** Reads an unsigned 32-bit LE integer and advances 4 bytes. */
  readDword(): number {
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }

  /** Reads a signed 32-bit LE integer and advances 4 bytes. */
  readLong(): number {
    const v = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return v;
  }

  /**
   * Reads `n` bytes into a fresh Uint8Array (a copy, so it does not retain the
   * whole file buffer) and advances `n` bytes.
   */
  readBytes(n: number): Uint8Array {
    const out = new Uint8Array(n);
    out.set(this.bytes.subarray(this.offset, this.offset + n));
    this.offset += n;
    return out;
  }

  /** Reads an Aseprite STRING (WORD length prefix + UTF-8 bytes). */
  readString(): string {
    const len = this.readWord();
    const slice = this.bytes.subarray(this.offset, this.offset + len);
    this.offset += len;
    return ByteReader.decoder.decode(slice);
  }

  /** Advances `n` bytes without reading. */
  skip(n: number): void {
    this.offset += n;
  }

  /** Moves the cursor to an absolute byte offset. */
  seek(pos: number): void {
    this.offset = pos;
  }

  /** Returns the current absolute byte offset. */
  tell(): number {
    return this.offset;
  }
}
