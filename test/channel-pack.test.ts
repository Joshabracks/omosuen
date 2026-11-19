/**
 * Channel-packing kernel.
 *
 * Drives `interleaveChannels` and its helpers — pure Uint8ClampedArray math, no
 * DOM, no canvas, no engine. The canvas wrappers around it (`packChannels`,
 * `packMaterial`) can only be exercised in a browser; this covers the part that
 * actually decides pixel values.
 *
 * Run: npx tsx test/channel-pack.test.ts
 */

import {
  ChannelPlane,
  interleaveChannels,
  quantizeByte,
  readOffset,
  unitToByte,
} from '../src/component/texture-map/channel-pack';

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.error(`  FAIL  ${label}${detail ? ` -- ${detail}` : ''}`);
  }
}

/** An opaque single-texel-per-entry RGBA plane built from grayscale values. */
function grayPlane(
  values: number[],
  from: ChannelPlane['from'] = 0,
  defaultByte = 0,
  quantize?: number,
): ChannelPlane {
  const data = new Uint8ClampedArray(values.length * 4);
  values.forEach((v, i) => {
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  });
  return { data, from, defaultByte, quantize };
}

// ── helpers ────────────────────────────────────────────────────────────────

console.log('\nunitToByte');
check('0 -> 0', unitToByte(0) === 0);
check('1 -> 255', unitToByte(1) === 255);
check('0.5 -> 128', unitToByte(0.5) === 128, `got ${unitToByte(0.5)}`);
check('clamps above 1', unitToByte(4) === 255);
check('clamps below 0', unitToByte(-2) === 0);
check('NaN -> 0', unitToByte(NaN) === 0);

console.log('\nreadOffset');
check('r -> 0', readOffset('r') === 0);
check('g -> 1', readOffset('g') === 1);
check('b -> 2', readOffset('b') === 2);
check('a -> 3', readOffset('a') === 3);
check('luminance passes through', readOffset('luminance') === 'luminance');

console.log('\nquantizeByte');
check('4 levels snap to 0/85/170/255',
  quantizeByte(0, 4) === 0 &&
  quantizeByte(100, 4) === 85 &&
  quantizeByte(200, 4) === 170 &&
  quantizeByte(255, 4) === 255,
  `got ${[0, 100, 200, 255].map((v) => quantizeByte(v, 4)).join(',')}`);
check('2 levels are pure black/white',
  quantizeByte(100, 2) === 0 && quantizeByte(200, 2) === 255,
  `got ${quantizeByte(100, 2)}, ${quantizeByte(200, 2)}`);
check('a value drifted off a band centre still snaps back',
  quantizeByte(84, 4) === 85 && quantizeByte(86, 4) === 85,
  `got ${quantizeByte(84, 4)}, ${quantizeByte(86, 4)}`);
check('levels < 2 is a no-op', quantizeByte(123, 1) === 123);

// ── interleave ─────────────────────────────────────────────────────────────

console.log('\ninterleaveChannels');

{
  // Three distinct grayscale sources into R, G, B of two texels.
  const out = interleaveChannels(
    {
      r: grayPlane([10, 20]),
      g: grayPlane([30, 40]),
      b: grayPlane([50, 60]),
    },
    2,
    1,
  );
  check('three sources land in their own destination channels',
    out[0] === 10 && out[1] === 30 && out[2] === 50 &&
    out[4] === 20 && out[5] === 40 && out[6] === 60,
    `got [${Array.from(out).join(',')}]`);
  check('alpha defaults to fully opaque',
    out[3] === 255 && out[7] === 255,
    `got ${out[3]}, ${out[7]}`);
}

{
  // A channel with no plane at all must not be written.
  const out = interleaveChannels({ r: grayPlane([200]) }, 1, 1);
  check('an unsupplied channel stays 0',
    out[0] === 200 && out[1] === 0 && out[2] === 0,
    `got [${Array.from(out).join(',')}]`);
}

{
  // THE load-bearing case. The shader defaults roughness to 1.0 (fully rough);
  // packing an unauthored roughness as 0 is a mirror finish, not matte.
  const out = interleaveChannels(
    {
      r: { data: null, from: 0, defaultByte: 0 },     // metallic 0
      g: { data: null, from: 0, defaultByte: 255 },   // roughness 1
    },
    1,
    1,
  );
  check('constant planes: metallic 0, roughness 255 (matte, NOT mirror)',
    out[0] === 0 && out[1] === 255,
    `got metallic=${out[0]}, roughness=${out[1]}`);
}

{
  // A fully transparent source texel carries no authored value, so it must
  // resolve to the channel default rather than to premultiplied black.
  const data = new Uint8ClampedArray([0, 0, 0, 0, 90, 90, 90, 255]);
  const out = interleaveChannels(
    { g: { data, from: 0, defaultByte: 255 } },
    2,
    1,
  );
  check('a transparent source texel falls back to the default',
    out[1] === 255 && out[5] === 90,
    `got ${out[1]}, ${out[5]}`);
}

{
  const out = interleaveChannels(
    { b: grayPlane([100, 200], 0, 0, 4) },
    2,
    1,
  );
  check('quantize applies to the destination channel',
    out[2] === 85 && out[6] === 170,
    `got ${out[2]}, ${out[6]}`);
}

{
  // Pure red read as luminance: 255 * 0.299 = 76.245 -> 76
  const data = new Uint8ClampedArray([255, 0, 0, 255]);
  const out = interleaveChannels(
    { r: { data, from: 'luminance', defaultByte: 0 } },
    1,
    1,
  );
  check('luminance uses Rec.601 weights',
    out[0] === 76,
    `expected 76 for pure red, got ${out[0]}`);
}

{
  // Reading a non-default source channel.
  const data = new Uint8ClampedArray([10, 20, 30, 255]);
  const out = interleaveChannels(
    { r: { data, from: 2, defaultByte: 0 } },
    1,
    1,
  );
  check('from selects which source channel is read',
    out[0] === 30,
    `expected 30 (source blue), got ${out[0]}`);
}

{
  const out = interleaveChannels({ r: grayPlane([5]) }, 1, 1, 0.5);
  check('an explicit alpha value is honoured',
    out[3] === 128,
    `got ${out[3]}`);
}

{
  // Short buffer: reading past the end must fall back, not produce garbage.
  const out = interleaveChannels(
    { r: { data: new Uint8ClampedArray(4), from: 0, defaultByte: 77 } },
    4,
    1,
  );
  check('out-of-bounds texels fall back to the default',
    out[4] === 77 && out[8] === 77 && out[12] === 77,
    `got ${out[4]}, ${out[8]}, ${out[12]}`);
}

{
  const out = interleaveChannels({ r: grayPlane([1, 2, 3, 4, 5, 6]) }, 3, 2);
  check('output is sized width * height * 4',
    out.length === 24,
    `got ${out.length}`);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
