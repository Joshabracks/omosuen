/**
 * Instanced sprite pass: the draw-order sort and the palette table
 * (src/component/camera/render/sprite-instances.ts).
 *
 * The sort decides which sprite draws over which, so it is checked against a
 * reference stable sort on random input, with the two properties the renderer
 * leans on called out separately: equal depths keep their order (a composited
 * entity's layers), and the phantom depth bias survives at world-scale depths.
 *
 * The palette table is replayed the way unified.frag reads it -- slot `s` at
 * column `(s % 64) * 24`, row `s / 64`, entry `i` in texel `i >> 2`, component
 * `i & 3`, `to` twelve texels after `from` -- so a layout mismatch between the
 * two shows up here rather than as wrong colours on screen.
 *
 * Run: npx tsx test/sprite-batch.test.ts
 */

import {
  SPRITE_INSTANCE_FLOATS,
  SPRITE_INSTANCE_TEXELS,
  SPRITE_INSTANCE_TEX_WIDTH,
  SPRITE_PALETTE_SLOTS_PER_ROW,
  SPRITE_PALETTE_SLOT_TEXELS,
  beginSpritePalettes,
  sortDrawOrder,
  spriteInstanceBuffer,
  spriteInstanceRows,
  spritePaletteSlot,
  spritePaletteTable,
} from '../src/component/camera/render/sprite-instances';
import {
  MAX_PALETTE_ENTRIES,
  packPaletteRemap,
  type PaletteEntry,
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

// Deterministic PRNG (mulberry32) so a failure reproduces.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Reference: Array.prototype.sort is stable (ES2019+). */
function referenceOrder(depths: Float64Array, count: number): number[] {
  const idx = Array.from({ length: count }, (_, i) => i);
  return idx.sort((a, b) => depths[a] - depths[b]);
}

function sameOrder(got: Uint32Array, want: number[]): boolean {
  for (let i = 0; i < want.length; i++) if (got[i] !== want[i]) return false;
  return true;
}

console.log('\nsortDrawOrder');
{
  check('empty input', sortDrawOrder(new Float64Array(0), 0).length >= 0);

  const one = sortDrawOrder(new Float64Array([5]), 1);
  check('single entry', one[0] === 0);

  const asc = new Float64Array([1, 2, 3, 4, 5]);
  check('already sorted stays put', sameOrder(sortDrawOrder(asc, 5), [0, 1, 2, 3, 4]));

  const desc = new Float64Array([5, 4, 3, 2, 1]);
  check('reversed input', sameOrder(sortDrawOrder(desc, 5), [4, 3, 2, 1, 0]));

  // Only the first `count` entries are sorted; the rest is stale scratch.
  const partial = new Float64Array([3, 1, 2, -100, -200]);
  check('ignores entries past count', sameOrder(sortDrawOrder(partial, 3), [1, 2, 0]));

  // A composited entity's layers share one depth and must keep their order.
  const ties = new Float64Array([7, 3, 7, 3, 7, 3, 1]);
  check(
    'equal depths keep their original order',
    sameOrder(sortDrawOrder(ties, 7), [6, 1, 3, 5, 0, 2, 4]),
  );

  // The phantom tie-break: a memory draw is nudged 1e-4 further away than the
  // coincident live sprite, and must sort before it whichever was collected
  // first. At this magnitude float32 could not tell the two apart.
  const bias = 1e-4;
  const world = 48213.75;
  const liveFirst = new Float64Array([world, world - bias]);
  const memoryFirst = new Float64Array([world - bias, world]);
  check('memory bias orders a pair collected live-first', sameOrder(sortDrawOrder(liveFirst, 2), [1, 0]));
  check('memory bias orders a pair collected memory-first', sameOrder(sortDrawOrder(memoryFirst, 2), [0, 1]));
  check('float32 would have lost that bias', Math.fround(world) === Math.fround(world - bias));

  // Random input against the reference, across sizes that exercise uneven
  // final runs, and with heavy duplication to stress stability.
  const random = rng(0xc0ffee);
  let allMatch = true;
  let detail = '';
  for (const n of [2, 3, 7, 8, 9, 63, 64, 65, 1000, 4097]) {
    for (const distinct of [n * 4, Math.max(1, n >> 3), 2]) {
      const depths = new Float64Array(n);
      for (let i = 0; i < n; i++) depths[i] = Math.floor(random() * distinct);
      const got = sortDrawOrder(depths, n);
      if (!sameOrder(got, referenceOrder(depths, n))) {
        allMatch = false;
        detail = `n=${n} distinct=${distinct}`;
      }
    }
  }
  check('matches a reference stable sort on random input', allMatch, detail);

  // The scratch arrays grow; an earlier, larger sort must not leak into a
  // later, smaller one.
  const small = new Float64Array([2, 1]);
  check('a small sort after a large one', sameOrder(sortDrawOrder(small, 2), [1, 0]));
}

console.log('\ninstance buffer');
{
  check('a record is 11 texels / 44 floats', SPRITE_INSTANCE_TEXELS === 11 && SPRITE_INSTANCE_FLOATS === 44);
  check('texture width is a power of two', (SPRITE_INSTANCE_TEX_WIDTH & (SPRITE_INSTANCE_TEX_WIDTH - 1)) === 0);
  check('zero sprites still needs one row', spriteInstanceRows(0) === 1);
  // 93 records = 1023 texels (fits a row); 94 = 1034 (spills into a second).
  check('93 records fit one row', spriteInstanceRows(93) === 1);
  check('94 records need two rows', spriteInstanceRows(94) === 2);

  const rowFloats = SPRITE_INSTANCE_TEX_WIDTH * 4;
  for (const n of [1, 93, 94, 5000, 20000]) {
    const buf = spriteInstanceBuffer(n);
    check(
      `buffer holds ${n} records in whole rows`,
      buf.length >= n * SPRITE_INSTANCE_FLOATS &&
        buf.length % rowFloats === 0 &&
        buf.length >= spriteInstanceRows(n) * rowFloats,
    );
  }
  check('buffer never shrinks', spriteInstanceBuffer(1).length >= 20000 * SPRITE_INSTANCE_FLOATS);
}

console.log('\npalette table');
{
  /** Reads entry `i` of slot `slot` exactly as unified.frag's texelFetch does. */
  const texWidth = SPRITE_PALETTE_SLOT_TEXELS * SPRITE_PALETTE_SLOTS_PER_ROW;
  function shaderRead(data: Uint32Array, slot: number, i: number, to: boolean): number {
    const baseX = (slot % SPRITE_PALETTE_SLOTS_PER_ROW) * SPRITE_PALETTE_SLOT_TEXELS;
    const baseY = Math.floor(slot / SPRITE_PALETTE_SLOTS_PER_ROW);
    const x = baseX + (to ? 12 : 0) + (i >> 2);
    return data[(baseY * texWidth + x) * 4 + (i & 3)];
  }

  function makeRemap(seed: number, count: number): PaletteEntry[] {
    const random = rng(seed);
    const out: PaletteEntry[] = [];
    for (let i = 0; i < count; i++) {
      // Distinct `from` per entry (i in the red channel).
      out.push({
        from: [i, Math.floor(random() * 256), Math.floor(random() * 256)],
        to: [Math.floor(random() * 256), Math.floor(random() * 256), Math.floor(random() * 256)],
        alpha: Math.floor(random() * 256),
      });
    }
    return out;
  }

  check('a slot is 24 texels: 12 from + 12 to', SPRITE_PALETTE_SLOT_TEXELS === 24 && MAX_PALETTE_ENTRIES === 48);

  beginSpritePalettes();
  const first = spritePaletteTable().count;

  const a = packPaletteRemap(makeRemap(1, 48));
  const b = packPaletteRemap(makeRemap(2, 5));
  const slotA = spritePaletteSlot(a);
  const slotB = spritePaletteSlot(b);
  check('new remaps take consecutive slots', slotA === first && slotB === first + 1);
  check('a remap keeps its slot', spritePaletteSlot(a) === slotA && spritePaletteSlot(b) === slotB);
  check('the table counts them once', spritePaletteTable().count === first + 2);

  // Enough remaps to cross several texture rows and force the store to grow.
  const many = [a, b];
  const slots = [slotA, slotB];
  for (let s = 0; s < 200; s++) {
    const p = packPaletteRemap(makeRemap(100 + s, 1 + (s % 48)));
    many.push(p);
    slots.push(spritePaletteSlot(p));
  }
  const table = spritePaletteTable();
  check('slots span more than one row', slots[slots.length - 1] >= SPRITE_PALETTE_SLOTS_PER_ROW * 3);

  let layoutOk = true;
  let layoutDetail = '';
  for (let p = 0; p < many.length && layoutOk; p++) {
    for (let i = 0; i < MAX_PALETTE_ENTRIES; i++) {
      if (
        shaderRead(table.data, slots[p], i, false) !== many[p].from[i] ||
        shaderRead(table.data, slots[p], i, true) !== many[p].to[i]
      ) {
        layoutOk = false;
        layoutDetail = `slot ${slots[p]} entry ${i}`;
        break;
      }
    }
  }
  check('every slot reads back through the shader addressing', layoutOk, layoutDetail);

  // Past the reset threshold the table empties at the next pass, and slots
  // are handed out again from zero.
  for (let s = 0; s < 4200; s++) spritePaletteSlot(packPaletteRemap(makeRemap(5000 + s, 1)));
  check('table grows past the reset threshold within a pass', spritePaletteTable().count > 4096);
  beginSpritePalettes();
  check('next pass starts an empty table', spritePaletteTable().count === 0);
  const again = spritePaletteSlot(a);
  check('a remap seen before the reset is re-added', again === 0);
  check(
    'and reads back correctly',
    shaderRead(spritePaletteTable().data, again, 47, false) === a.from[47] &&
      shaderRead(spritePaletteTable().data, again, 47, true) === a.to[47],
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
