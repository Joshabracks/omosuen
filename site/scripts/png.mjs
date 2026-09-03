/**
 * Minimal PNG reader/writer for the Textris screen-data generator.
 *
 * Build tooling only — never bundled, never shipped. Node's `zlib` is the only
 * dependency, so the repo stays free of third-party image libraries.
 *
 * Reading supports what the source art actually is: non-interlaced colour type
 * 3 (indexed, bit depth 4 — the emulator screenshots) and colour type 6
 * (RGBA8 — the NES palette swatch). Anything else throws rather than guessing.
 * Writing always emits RGBA8, used for the round-trip verification dumps.
 */

import { inflateSync, deflateSync } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Paeth predictor from the PNG spec (filter type 4). */
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Reverses the per-scanline filters in place, returning the raw (still
 * bit-packed, for sub-byte depths) image bytes.
 *
 * `bpp` is bytes-per-pixel ROUNDED UP to 1 for sub-byte depths, which is what
 * the spec's filter arithmetic uses — the filters operate on bytes, not pixels.
 */
function unfilter(data, height, bytesPerRow, bpp) {
  const out = Buffer.alloc(height * bytesPerRow);
  let src = 0;
  for (let y = 0; y < height; y++) {
    const filter = data[src++];
    const row = y * bytesPerRow;
    const prev = row - bytesPerRow;
    for (let i = 0; i < bytesPerRow; i++) {
      const raw = data[src + i];
      const a = i >= bpp ? out[row + i - bpp] : 0;
      const b = y > 0 ? out[prev + i] : 0;
      const c = y > 0 && i >= bpp ? out[prev + i - bpp] : 0;
      let value;
      switch (filter) {
        case 0: value = raw; break;
        case 1: value = raw + a; break;
        case 2: value = raw + b; break;
        case 3: value = raw + ((a + b) >> 1); break;
        case 4: value = raw + paeth(a, b, c); break;
        default: throw new Error(`Unsupported PNG filter type ${filter} on row ${y}`);
      }
      out[row + i] = value & 0xff;
    }
    src += bytesPerRow;
  }
  return out;
}

/**
 * Decodes a PNG to `{ width, height, rgb }`, where `rgb` is a Uint8Array of
 * `width * height * 3` bytes. Alpha is dropped — none of the source art uses it.
 */
export function readPng(path) {
  const buf = readFileSync(path);
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (buf[i] !== PNG_SIGNATURE[i]) throw new Error(`${path}: not a PNG`);
  }

  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = 0;
  let plte = null;
  const idat = [];

  let offset = 8;
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const name = buf.toString('ascii', offset + 4, offset + 8);
    const body = buf.subarray(offset + 8, offset + 8 + length);
    if (name === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8];
      colorType = body[9];
      if (body[10] !== 0) throw new Error(`${path}: unsupported compression method`);
      if (body[12] !== 0) throw new Error(`${path}: interlaced PNGs are not supported`);
    } else if (name === 'PLTE') {
      plte = Buffer.from(body);
    } else if (name === 'IDAT') {
      idat.push(Buffer.from(body));
    } else if (name === 'IEND') {
      break;
    }
    offset += 12 + length;
  }

  const raw = inflateSync(Buffer.concat(idat));
  const rgb = new Uint8Array(width * height * 3);

  if (colorType === 3) {
    if (!plte) throw new Error(`${path}: indexed PNG with no PLTE chunk`);
    if (depth !== 4 && depth !== 8) {
      throw new Error(`${path}: unsupported indexed bit depth ${depth}`);
    }
    const bytesPerRow = Math.ceil((width * depth) / 8);
    const pixels = unfilter(raw, height, bytesPerRow, 1);
    for (let y = 0; y < height; y++) {
      const row = y * bytesPerRow;
      for (let x = 0; x < width; x++) {
        let index;
        if (depth === 8) {
          index = pixels[row + x];
        } else {
          const byte = pixels[row + (x >> 1)];
          index = x & 1 ? byte & 0x0f : byte >> 4;
        }
        const dst = (y * width + x) * 3;
        rgb[dst] = plte[index * 3];
        rgb[dst + 1] = plte[index * 3 + 1];
        rgb[dst + 2] = plte[index * 3 + 2];
      }
    }
  } else if (colorType === 2 || colorType === 6) {
    if (depth !== 8) throw new Error(`${path}: unsupported truecolour bit depth ${depth}`);
    const channels = colorType === 6 ? 4 : 3;
    const bytesPerRow = width * channels;
    const pixels = unfilter(raw, height, bytesPerRow, channels);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const src = y * bytesPerRow + x * channels;
        const dst = (y * width + x) * 3;
        rgb[dst] = pixels[src];
        rgb[dst + 1] = pixels[src + 1];
        rgb[dst + 2] = pixels[src + 2];
      }
    }
  } else {
    throw new Error(`${path}: unsupported PNG colour type ${colorType}`);
  }

  return { width, height, rgb };
}

function chunk(name, body) {
  const out = Buffer.alloc(12 + body.length);
  out.writeUInt32BE(body.length, 0);
  out.write(name, 4, 'ascii');
  body.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
}

let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** Writes an RGBA8 PNG. `rgb` is `width * height * 3` bytes; alpha is forced opaque. */
export function writePng(path, width, height, rgb) {
  const bytesPerRow = width * 4;
  const raw = Buffer.alloc(height * (bytesPerRow + 1));
  for (let y = 0; y < height; y++) {
    const dst = y * (bytesPerRow + 1);
    raw[dst] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 3;
      const p = dst + 1 + x * 4;
      raw[p] = rgb[src];
      raw[p + 1] = rgb[src + 1];
      raw[p + 2] = rgb[src + 2];
      raw[p + 3] = 255;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  writeFileSync(
    path,
    Buffer.concat([
      Buffer.from(PNG_SIGNATURE),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}
