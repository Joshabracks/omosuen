/**
 * Sprite palette remap: validation and packing (src/component/sprite/palette.ts).
 *
 * Also replays the shader's lookup (`applyPaletteRemap` in unified.frag) on the
 * packed arrays exactly as the GPU reads them — four packed colours per uvec4,
 * entry i at [i >> 2][i & 3] — so a packing/indexing mismatch shows up here
 * rather than as wrong colours on screen.
 *
 * Run: npx tsx test/sprite-palette.test.ts
 */

import {
  MAX_PALETTE_ENTRIES,
  PALETTE_UNIFORM_VECTORS,
  clonePaletteRemap,
  normalizePaletteRemap,
  packPaletteRemap,
  PALETTE_FLAG_ALPHA,
  PALETTE_FLAG_KEEP_RGB,
  packRgb8,
  unpackRgb8,
  type PackedPalette,
  type PaletteEntry,
  type Rgb8,
} from '../src/component/sprite/palette';

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ''}`);
  }
}

function collectWarnings(): { warn: (m: string) => void; messages: string[] } {
  const messages: string[] = [];
  return { warn: (m) => messages.push(m), messages };
}

/**
 * CPU replay of unified.frag's applyPaletteRemap plus the discard after it:
 * returns the texel's RGB and alpha (0-1), or null when it is discarded.
 */
function remapTexel(
  p: PackedPalette,
  rgb: Rgb8,
  alpha = 1,
): { rgb: Rgb8; alpha: number } | null {
  // The uniform arrays as the shader sees them: uvec4[12].
  const vec = (arr: Uint32Array, i: number): number => {
    const slot = i >> 2;
    const lane = i & 3;
    return arr[slot * 4 + lane];
  };
  const key = packRgb8(rgb);
  let outRgb = rgb;
  let outA = alpha;
  for (let i = 0; i < 48; i++) {
    if (i >= p.count) break;
    const from = vec(p.from, i);
    if ((from & 0xffffff) === key) {
      const to = vec(p.to, i);
      if ((from & PALETTE_FLAG_KEEP_RGB) === 0) outRgb = unpackRgb8(to);
      if ((from & PALETTE_FLAG_ALPHA) !== 0) outA = alpha * ((to >>> 24) / 255);
      break;
    }
  }
  return outA < 0.01 ? null : { rgb: outRgb, alpha: outA };
}

/** RGB after the remap (texel assumed opaque and not discarded). */
function shaderLookup(p: PackedPalette, rgb: Rgb8): Rgb8 {
  return remapTexel(p, rgb)?.rgb ?? [-1, -1, -1];
}

const same = (a: Rgb8, b: Rgb8): boolean =>
  a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

console.log('\npacking');
check('MAX_PALETTE_ENTRIES is 48', MAX_PALETTE_ENTRIES === 48);
check('fits 12 uvec4 slots', PALETTE_UNIFORM_VECTORS === 12);
for (const rgb of [
  [0, 0, 0],
  [255, 255, 255],
  [248, 192, 144],
  [1, 2, 3],
  [255, 0, 128],
] as Rgb8[]) {
  check(`pack/unpack round-trip ${rgb}`, same(unpackRgb8(packRgb8(rgb)), rgb));
}
check('white packs to 0xffffff', packRgb8([255, 255, 255]) === 0xffffff);

console.log('\nnormalize');
{
  const w = collectWarnings();
  check('null -> null', normalizePaletteRemap(null, 't', w.warn) === null);
  check('undefined -> null', normalizePaletteRemap(undefined, 't', w.warn) === null);
  check('[] -> null', normalizePaletteRemap([], 't', w.warn) === null);
  check('no warnings for empty inputs', w.messages.length === 0, w.messages.join('; '));
}
{
  const w = collectWarnings();
  check('non-array -> null + warning', normalizePaletteRemap({}, 't', w.warn) === null && w.messages.length === 1);
}
{
  const w = collectWarnings();
  const out = normalizePaletteRemap(
    [{ from: [-5, 300, 12.6], to: [0.4, 254.5, 128] }],
    't',
    w.warn,
  );
  check(
    'clamps and rounds',
    !!out && same(out[0].from, [0, 255, 13]) && same(out[0].to, [0, 255, 128]),
    JSON.stringify(out),
  );
}
{
  const w = collectWarnings();
  const out = normalizePaletteRemap(
    [
      { from: [1, 2, 3], to: [4, 5, 6] },
      { from: [1, 2], to: [4, 5, 6] },
      { from: [1, 2, 'x'], to: [4, 5, 6] },
      null,
      { to: [4, 5, 6] },
      { from: [1, 2, NaN], to: [4, 5, 6] },
    ],
    't',
    w.warn,
  );
  check('malformed entries dropped', out?.length === 1, JSON.stringify(out));
  check('one warning for the malformed batch', w.messages.length === 1, w.messages.join('; '));
}
{
  const w = collectWarnings();
  const out = normalizePaletteRemap(
    [
      { from: [10, 10, 10], to: [1, 1, 1] },
      { from: [10, 10, 10], to: [2, 2, 2] },
    ],
    't',
    w.warn,
  );
  check(
    'duplicate from: first wins',
    out?.length === 1 && same(out[0].to, [1, 1, 1]),
    JSON.stringify(out),
  );
  check('duplicate warned', w.messages.length === 1);
}
{
  const w = collectWarnings();
  const many: PaletteEntry[] = [];
  for (let i = 0; i < 60; i++) many.push({ from: [i, 0, 0], to: [0, i, 0] });
  const out = normalizePaletteRemap(many, 't', w.warn);
  check('truncated to 48', out?.length === 48);
  check('keeps the first 48', !!out && same(out[47].from, [47, 0, 0]));
  check('overflow warned', w.messages.length === 1 && /12 dropped/.test(w.messages[0]), w.messages.join('; '));
}
{
  const input: PaletteEntry[] = [{ from: [1, 2, 3], to: [4, 5, 6] }];
  const out = normalizePaletteRemap(input, 't', () => {});
  input[0].from[0] = 99;
  check('normalize copies (caller mutation does not leak)', !!out && out[0].from[0] === 1);
  const clone = clonePaletteRemap(out);
  if (clone) clone[0].to[0] = 77;
  check('clonePaletteRemap is deep', !!out && out[0].to[0] === 4);
  check('clonePaletteRemap(null) is null', clonePaletteRemap(null) === null);
}

console.log('\nshader lookup on packed uniforms');
{
  // A role palette shaped like Colony Forever's: several roles x 3 shades,
  // filling every lane of every uvec4 slot.
  const entries: PaletteEntry[] = [];
  for (let i = 0; i < 48; i++) {
    entries.push({ from: [200, i, 255 - i], to: [i * 5, 100, i] });
  }
  const packed = packPaletteRemap(normalizePaletteRemap(entries, 't', () => {})!);
  check('count 48', packed.count === 48);
  let allHit = true;
  for (let i = 0; i < 48; i++) {
    const got = shaderLookup(packed, [200, i, 255 - i]);
    if (!same(got, [i * 5, 100, i])) {
      allHit = false;
      console.log(`    entry ${i}: got ${got}`);
    }
  }
  check('every entry, every lane, maps to its own `to`', allHit);
  check('unmapped colour passes through', same(shaderLookup(packed, [1, 1, 1]), [1, 1, 1]));
  check('near miss (off by one) passes through', same(shaderLookup(packed, [200, 0, 254]), [200, 0, 254]));
}
{
  const packed = packPaletteRemap(
    normalizePaletteRemap([{ from: [92, 62, 40], to: [235, 235, 225] }], 't', () => {})!,
  );
  check('unused slots stay zero', packed.from.slice(1).every((v) => v === 0));
  check(
    'black is not matched by the zero padding past count',
    same(shaderLookup(packed, [0, 0, 0]), [0, 0, 0]),
  );
  check('brown hair -> white', same(shaderLookup(packed, [92, 62, 40]), [235, 235, 225]));
}
{
  // A swap chain must not cascade: a -> b and b -> c applies once per texel.
  const packed = packPaletteRemap(
    normalizePaletteRemap(
      [
        { from: [10, 0, 0], to: [20, 0, 0] },
        { from: [20, 0, 0], to: [30, 0, 0] },
      ],
      't',
      () => {},
    )!,
  );
  check('swaps do not chain', same(shaderLookup(packed, [10, 0, 0]), [20, 0, 0]));
}

console.log('\nalpha');
{
  const w = collectWarnings();
  const out = normalizePaletteRemap(
    [
      { from: [1, 0, 0], alpha: 0 },
      { from: [2, 0, 0], to: [9, 9, 9], alpha: 127.6 },
      { from: [3, 0, 0], alpha: 300 },
      { from: [4, 0, 0], to: [5, 5, 5] },
      { from: [5, 0, 0] },
      { from: [6, 0, 0], alpha: 'x' },
      { from: [7, 0, 0], to: [1, 2], alpha: 10 },
    ],
    't',
    w.warn,
  );
  check('alpha-only, colour+alpha, colour-only kept', out?.length === 4, JSON.stringify(out));
  check('alpha rounded and clamped', out?.[1].alpha === 128 && out?.[2].alpha === 255);
  check('alpha-only entry has no `to`', !!out && out[0].to === undefined && out[0].alpha === 0);
  check('colour-only entry has no `alpha`', !!out && out[3].alpha === undefined);
  check('neither to nor alpha / bad alpha / bad to: dropped with one warning', w.messages.length === 1, w.messages.join('; '));
  const clone = clonePaletteRemap(out);
  check(
    'clone keeps optional fields exactly',
    JSON.stringify(clone) === JSON.stringify(out),
    JSON.stringify(clone),
  );
}
{
  const packed = packPaletteRemap(
    normalizePaletteRemap(
      [
        { from: [10, 20, 30], alpha: 0 },
        { from: [40, 50, 60], alpha: 128 },
        { from: [70, 80, 90], to: [1, 2, 3], alpha: 64 },
        { from: [100, 110, 120], to: [4, 5, 6] },
        { from: [255, 255, 255], alpha: 2 },
      ],
      't',
      () => {},
    )!,
  );
  check('alpha 0 discards the texel', remapTexel(packed, [10, 20, 30]) === null);
  const half = remapTexel(packed, [40, 50, 60]);
  check(
    'alpha-only keeps the RGB and scales alpha',
    !!half && same(half.rgb, [40, 50, 60]) && Math.abs(half.alpha - 128 / 255) < 1e-9,
    JSON.stringify(half),
  );
  const both = remapTexel(packed, [70, 80, 90]);
  check(
    'colour + alpha applies both',
    !!both && same(both.rgb, [1, 2, 3]) && Math.abs(both.alpha - 64 / 255) < 1e-9,
  );
  const plain = remapTexel(packed, [100, 110, 120]);
  check('colour-only leaves alpha alone', !!plain && same(plain.rgb, [4, 5, 6]) && plain.alpha === 1);
  const semi = remapTexel(packed, [40, 50, 60], 0.5);
  check('alpha multiplies the texel own alpha', !!semi && Math.abs(semi.alpha - 0.5 * (128 / 255)) < 1e-9);
  check('alpha 2 is below the discard threshold too', remapTexel(packed, [255, 255, 255]) === null);
  check('flags never leak into the colour match', same(shaderLookup(packed, [99, 99, 99]), [99, 99, 99]));
  check(
    'flag bits set as documented',
    (packed.from[0] & PALETTE_FLAG_ALPHA) !== 0 &&
      (packed.from[0] & PALETTE_FLAG_KEEP_RGB) !== 0 &&
      (packed.from[3] & (PALETTE_FLAG_ALPHA | PALETTE_FLAG_KEEP_RGB)) === 0 &&
      packed.to[2] >>> 24 === 64,
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
