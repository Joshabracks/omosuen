import { ByteReader } from './byte-reader.js';
import type { AseCel, AseFile, AseFrame, AseLayer, AseTag } from './types.js';

/**
 * Dependency-free .aseprite/.ase parser. Returns a fully-materialized model:
 * compressed cels are inflated (via the browser-native DecompressionStream) and
 * linked cels resolved before the promise resolves.
 *
 * The format is chunk-based: a 128-byte header, then one block per frame, each a
 * 16-byte frame header followed by typed chunks. The cardinal robustness rule is
 * to seek to `chunkStart + chunkSize` after each chunk, so unknown/extra chunks
 * are skipped exactly.
 */

const HEADER_MAGIC = 0xa5e0;
const FRAME_MAGIC = 0xf1fa;

const CHUNK_LAYER = 0x2004;
const CHUNK_CEL = 0x2005;
const CHUNK_TAGS = 0x2018;

const CEL_RAW = 0;
const CEL_LINKED = 1;
const CEL_COMPRESSED_IMAGE = 2;

interface PendingInflate {
  cel: AseCel;
  compressed: Uint8Array;
}

/**
 * Parses an Aseprite file from its raw bytes.
 *
 * @param buffer - The .aseprite file contents (e.g. from fetch().arrayBuffer()).
 * @returns The fully-resolved file model.
 */
export async function parseAseprite(buffer: ArrayBuffer): Promise<AseFile> {
  const r = new ByteReader(buffer);

  // --- Header (128 bytes, fixed) ---
  r.readDword(); // file size
  const magic = r.readWord();
  if (magic !== HEADER_MAGIC) {
    throw new Error(
      `[aseprite] not an Aseprite file (bad header magic 0x${magic.toString(16)})`,
    );
  }
  const frameCount = r.readWord();
  const width = r.readWord();
  const height = r.readWord();
  const colorDepth = r.readWord();
  // The remaining header fields (flags, speed, transparent index, palette size,
  // grid, reserved) are not needed here — skip to the fixed 128-byte boundary.
  r.seek(128);

  const layers: AseLayer[] = [];
  const tags: AseTag[] = [];
  const frames: AseFrame[] = [];
  const pending: PendingInflate[] = [];

  // --- Frames ---
  for (let f = 0; f < frameCount; f++) {
    const frameStart = r.tell();
    const frameBytes = r.readDword();
    const frameMagic = r.readWord();
    if (frameMagic !== FRAME_MAGIC) {
      throw new Error(
        `[aseprite] bad frame magic 0x${frameMagic.toString(16)} at frame ${f}`,
      );
    }
    let chunkCount = r.readWord(); // old 16-bit count
    const durationMs = r.readWord();
    r.skip(2); // reserved
    const newChunkCount = r.readDword(); // 32-bit count (0 ⇒ use old)
    if (newChunkCount !== 0) chunkCount = newChunkCount;

    const cels: AseCel[] = [];

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
      } else if (chunkType === CHUNK_CEL) {
        const layerIndex = r.readWord();
        const x = r.readShort();
        const y = r.readShort();
        const opacity = r.readByte();
        const celType = r.readWord();
        r.readShort(); // z-index
        r.skip(5); // reserved

        if (celType === CEL_RAW || celType === CEL_COMPRESSED_IMAGE) {
          const w = r.readWord();
          const h = r.readWord();
          const cel: AseCel = { layerIndex, x, y, w, h, opacity, pixels: null };
          if (celType === CEL_RAW) {
            cel.pixels = r.readBytes(w * h * 4);
          } else {
            // Remaining chunk bytes are the zlib-compressed RGBA rows.
            const compressed = r.readBytes(chunkEnd - r.tell());
            pending.push({ cel, compressed });
          }
          cels.push(cel);
        } else if (celType === CEL_LINKED) {
          const linkedFrame = r.readWord();
          cels.push({
            layerIndex,
            x,
            y,
            w: 0,
            h: 0,
            opacity,
            pixels: null,
            linkedFrame,
          });
        }
        // celType 3 (compressed tilemap) is unsupported for these RGBA sprite
        // assets; the chunk-boundary seek below skips it.
      } else if (chunkType === CHUNK_TAGS) {
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
      // unparsed/unknown chunk (palette, profile, user data, tileset, …) and any
      // trailing bytes are stepped over exactly.
      r.seek(chunkEnd);
    }

    frames.push({ durationMs, cels });
    r.seek(frameStart + frameBytes);
  }

  // --- Phase 2: inflate compressed cels, then resolve linked cels ---
  await Promise.all(
    pending.map(async (p) => {
      p.cel.pixels = await inflate(p.compressed);
    }),
  );
  resolveLinkedCels(frames);

  return { width, height, colorDepth, frameCount, layers, frames, tags };
}

/**
 * Inflates zlib-wrapped (deflate) data using the browser-native
 * DecompressionStream. No third-party dependency. Requires an evergreen browser.
 */
async function inflate(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error(
      '[aseprite] DecompressionStream is unavailable; decoding .aseprite pixel ' +
        'data requires an evergreen browser (Chrome 80+, Safari 16.4+, Firefox 113+).',
    );
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
 * Resolves linked cels (celType 1): a cel that reuses another frame's cel for
 * the same layer. Copies the source rect + pixels onto the link. Run after
 * inflation so the source pixels are materialized. Follows chains to the
 * ultimate (non-linked) source and tolerates a missing source.
 */
function resolveLinkedCels(frames: AseFrame[]): void {
  for (const frame of frames) {
    for (const cel of frame.cels) {
      if (cel.linkedFrame === undefined) continue;
      const source = findSourceCel(frames, cel.linkedFrame, cel.layerIndex);
      if (source) {
        cel.x = source.x;
        cel.y = source.y;
        cel.w = source.w;
        cel.h = source.h;
        cel.pixels = source.pixels;
      }
    }
  }
}

/**
 * Follows a link chain to the first non-linked cel for `layerIndex`, starting at
 * `frameIndex`. Bounded by frame count to avoid cycles.
 */
function findSourceCel(
  frames: AseFrame[],
  frameIndex: number,
  layerIndex: number,
): AseCel | null {
  let index = frameIndex;
  for (let guard = 0; guard <= frames.length; guard++) {
    if (index < 0 || index >= frames.length) return null;
    const cel = frames[index].cels.find((c) => c.layerIndex === layerIndex);
    if (!cel) return null;
    if (cel.linkedFrame === undefined) return cel;
    index = cel.linkedFrame;
  }
  return null;
}
