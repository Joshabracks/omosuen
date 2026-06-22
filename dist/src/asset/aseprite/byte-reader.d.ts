export declare class ByteReader {
    private readonly view;
    private readonly bytes;
    private offset;
    private static readonly decoder;
    constructor(buffer: ArrayBuffer);
    readByte(): number;
    readWord(): number;
    readShort(): number;
    readDword(): number;
    readLong(): number;
    readBytes(n: number): Uint8Array;
    readString(): string;
    skip(n: number): void;
    seek(pos: number): void;
    tell(): number;
}
//# sourceMappingURL=byte-reader.d.ts.map