/**
 * Retain-mode atlas space reclamation.
 *
 * Drives the packer's `freeFrameSlot` and the atlas-manager's
 * `reclaimUnreferenced` sweep headlessly — pure geometry, no DOM, no canvas. The
 * harness mirrors what `incrementalSteps` does with them: keep a `packedByKey`
 * map of live regions, compute the live key set, reclaim, then pack the new
 * frames into the same persistent PackerState.
 *
 * Invariants checked throughout: every live region's padded rect sits inside its
 * atlas and overlaps no other live region, freed space is actually reused, and
 * steady-state churn never grows the atlas count.
 *
 * Run: npx tsx test/atlas-reclaim.test.ts
 */

import { Vector2D } from '../src/math';
import {
  createPackerState,
  freeFrameSlot,
  packFramesInto,
} from '../src/component/atlas-manager/packer';
import {
  paddedRect,
  reclaimUnreferenced,
} from '../src/component/atlas-manager/reclaim';
import type {
  PackedRegion,
  PackerState,
  UnpackedFrame,
} from '../src/component/atlas-manager/types';

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

// mulberry32 — deterministic PRNG.
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function frame(w: number, h: number): UnpackedFrame {
  // The packer reads only `size`; sourceImage is never touched headlessly.
  return { size: new Vector2D(w, h) } as unknown as UnpackedFrame;
}

/** Mirrors incrementalSteps: a persistent pack state + live-region map. */
class Harness {
  readonly state: PackerState;
  readonly regions = new Map<string, PackedRegion>();
  private nextId = 0;

  constructor(
    readonly atlasSize: number,
    readonly maxAtlases: number,
    readonly padding: number,
  ) {
    this.state = createPackerState(atlasSize, maxAtlases, padding);
  }

  /** Packs new frames; returns their keys in input order. */
  add(frames: UnpackedFrame[]): string[] {
    packFramesInto(this.state, frames);
    return frames.map((f) => {
      const key = `f${this.nextId++}`;
      this.regions.set(key, {
        atlasIndex: f.atlasIndex!,
        atlasPosition: f.atlasPosition!,
        size: f.size,
        slot: f.slot,
      });
      return key;
    });
  }

  /** Releases `keys` the way a compile does: by leaving them out of the live set. */
  release(keys: Iterable<string>): number {
    const drop = new Set(keys);
    const live = new Set<string>();
    for (const k of this.regions.keys()) if (!drop.has(k)) live.add(k);
    return reclaimUnreferenced(this.state, this.regions, live);
  }

  atlasCount(): number {
    let max = -1;
    for (const r of this.regions.values()) max = Math.max(max, r.atlasIndex);
    return max + 1;
  }

  /** Null if every live padded rect is in-bounds and disjoint, else a reason. */
  overlapError(): string | null {
    const grids = new Map<number, Uint8Array>();
    for (const [key, r] of this.regions) {
      const x0 = r.atlasPosition.x;
      const y0 = r.atlasPosition.y;
      const x1 = x0 + r.size.x + this.padding;
      const y1 = y0 + r.size.y + this.padding;
      if (x0 < 0 || y0 < 0 || x1 > this.atlasSize || y1 > this.atlasSize) {
        return `${key} out of bounds (${x0},${y0})-(${x1},${y1})`;
      }
      let g = grids.get(r.atlasIndex);
      if (!g) {
        g = new Uint8Array(this.atlasSize * this.atlasSize);
        grids.set(r.atlasIndex, g);
      }
      for (let y = y0; y < y1; y++) {
        const row = y * this.atlasSize;
        for (let x = x0; x < x1; x++) {
          if (g[row + x]) return `${key} overlaps at atlas ${r.atlasIndex} (${x},${y})`;
          g[row + x] = 1;
        }
      }
    }
    return null;
  }
}

const posKey = (r: { atlasIndex: number; atlasPosition: Vector2D }): string =>
  `${r.atlasIndex}:${r.atlasPosition.x},${r.atlasPosition.y}`;

// ── 1. Every packed frame records its slot, across all allocation branches ──
console.log('\nslot bookkeeping');
{
  const rng = makeRng(7);
  const frames: UnpackedFrame[] = [];
  for (let i = 0; i < 2000; i++) {
    frames.push(frame(4 + ((rng() * 60) | 0), 4 + ((rng() * 60) | 0)));
  }
  // Exact-fit case too: one frame filling a whole atlas (minus padding).
  const state = createPackerState(1024, 4, 1);
  packFramesInto(state, [frame(1023, 1023)]);
  const st2 = createPackerState(4096, 4, 1);
  packFramesInto(st2, frames);
  const allHaveSlots = frames.every((f) => f.slot && f.slot['0'] === f);
  check('mixed-size frames each record the node holding them', allHaveSlots);
  check(
    'perfect-fit frame records the root space as its slot',
    state.rootSpaces[0]['0'] !== null && state.rootSpaces[0]['0'] !== undefined &&
      !('position' in (state.rootSpaces[0]['0'] as object)),
  );
}

// ── 2. Same-size frames reuse freed slots exactly ──
console.log('\nsame-size reuse');
{
  const h = new Harness(1024, 4, 1);
  const keys = h.add(Array.from({ length: 300 }, () => frame(32, 32)));
  const freedKeys = keys.filter((_, i) => i % 3 === 0); // 100 scattered slots
  const freedPositions = new Set(freedKeys.map((k) => posKey(h.regions.get(k)!)));
  const before = h.atlasCount();

  const released = h.release(freedKeys);
  check('reclaim reports every released key', released === 100, `got ${released}`);
  check('released keys leave the map', freedKeys.every((k) => !h.regions.has(k)));

  const newKeys = h.add(Array.from({ length: 100 }, () => frame(32, 32)));
  const reused = newKeys.filter((k) => freedPositions.has(posKey(h.regions.get(k)!)));
  check('all 100 new frames land in freed slots', reused.length === 100, `${reused.length}/100`);
  check('atlas count unchanged', h.atlasCount() === before);
  const err = h.overlapError();
  check('no overlap after reuse', err === null, err ?? undefined);
}

// ── 3. Smaller frames reuse freed space ──
console.log('\nsmaller-frame reuse');
{
  const h = new Harness(1024, 4, 1);
  const keys = h.add(Array.from({ length: 200 }, () => frame(32, 32)));
  const freed = keys.slice(50, 70);
  const freedRects = freed.map((k) => {
    const r = h.regions.get(k)!;
    return { a: r.atlasIndex, x: r.atlasPosition.x, y: r.atlasPosition.y };
  });
  h.release(freed);
  const newKeys = h.add(Array.from({ length: 20 }, () => frame(16, 20)));
  const inside = newKeys.filter((k) => {
    const r = h.regions.get(k)!;
    return freedRects.some(
      (f) =>
        f.a === r.atlasIndex &&
        r.atlasPosition.x >= f.x &&
        r.atlasPosition.y >= f.y &&
        r.atlasPosition.x + r.size.x + 1 <= f.x + 33 &&
        r.atlasPosition.y + r.size.y + 1 <= f.y + 33,
    );
  });
  check('20 smaller frames all land inside freed slots', inside.length === 20, `${inside.length}/20`);
  const err = h.overlapError();
  check('no overlap after smaller reuse', err === null, err ?? undefined);
}

// ── 4. Larger frames never squeeze into smaller freed slots ──
console.log('\nlarger frames');
{
  const h = new Harness(1024, 4, 1);
  const keys = h.add(Array.from({ length: 200 }, () => frame(32, 32)));
  h.release(keys.filter((_, i) => i % 2 === 0));
  h.add(Array.from({ length: 50 }, () => frame(48, 40)));
  const err = h.overlapError();
  check('larger frames placed without overlapping live frames', err === null, err ?? undefined);
}

// ── 5. Double free is a no-op ──
console.log('\ndouble free');
{
  const state = createPackerState(1024, 1, 1);
  const f = frame(32, 32);
  packFramesInto(state, [f]);
  const first = freeFrameSlot(state, f.slot!);
  const second = freeFrameSlot(state, f.slot!);
  check('first free returns the new free space', first !== null);
  check('second free of the same slot returns null', second === null);
  check(
    'freed space has the padded frame size',
    first !== null && first.size.x === 33 && first.size.y === 33,
  );
}

// ── 6. Live keys are never touched ──
console.log('\nlive set');
{
  const h = new Harness(1024, 1, 1);
  const keys = h.add(Array.from({ length: 50 }, () => frame(32, 32)));
  const n = reclaimUnreferenced(h.state, h.regions, new Set(keys));
  check('nothing released when every key is live', n === 0 && h.regions.size === 50);
}

// ── 7. Steady-state churn stays inside a fixed budget ──
// One 1024 atlas holds 31×31 = 961 padded 32px frames. 200 cycles of
// release-100 / add-100 over an 800-frame live set is 20,000 adds total — far
// beyond capacity without reclamation.
console.log('\nuniform churn (Colony Forever shape)');
{
  const h = new Harness(1024, 1, 1);
  const rng = makeRng(42);
  let live = h.add(Array.from({ length: 800 }, () => frame(32, 32)));
  let overflowed = false;
  let firstErr: string | null = null;
  for (let cycle = 0; cycle < 200 && !overflowed; cycle++) {
    const drop = new Set<string>();
    while (drop.size < 100) drop.add(live[(rng() * live.length) | 0]);
    h.release(drop);
    live = live.filter((k) => !drop.has(k));
    try {
      live = live.concat(h.add(Array.from({ length: 100 }, () => frame(32, 32))));
    } catch {
      overflowed = true;
    }
    if (cycle % 20 === 0 && !firstErr) firstErr = h.overlapError();
  }
  check('200 churn cycles (20k adds) fit in one 1024 atlas', !overflowed);
  check('still exactly one atlas', h.atlasCount() === 1);
  check('live count stable', h.regions.size === 800, `${h.regions.size}`);
  const err = firstErr ?? h.overlapError();
  check('no overlap during churn', err === null, err ?? undefined);
}

// ── 8. Mixed-size churn stays correct and bounded ──
console.log('\nmixed-size churn');
{
  const sizes = [16, 24, 32, 48];
  const h = new Harness(2048, 16, 1);
  const rng = makeRng(99);
  const pick = (): UnpackedFrame =>
    frame(sizes[(rng() * sizes.length) | 0], sizes[(rng() * sizes.length) | 0]);
  let live = h.add(Array.from({ length: 1000 }, pick));
  let overflowed = false;
  let err: string | null = null;
  let peakAtlases = h.atlasCount();
  for (let cycle = 0; cycle < 100 && !overflowed; cycle++) {
    const drop = new Set<string>();
    while (drop.size < 150) drop.add(live[(rng() * live.length) | 0]);
    h.release(drop);
    live = live.filter((k) => !drop.has(k));
    try {
      live = live.concat(h.add(Array.from({ length: 150 }, pick)));
    } catch {
      overflowed = true;
    }
    peakAtlases = Math.max(peakAtlases, h.atlasCount());
    if (cycle % 10 === 0 && !err) err = h.overlapError();
  }
  err = err ?? h.overlapError();
  check('100 mixed-size churn cycles never overflow', !overflowed);
  check('no overlap during mixed churn', err === null, err ?? undefined);
  // 1000 frames of ≤49px² padded ≈ ≤2.4 MP; one 2048 atlas is 4.2 MP. Without
  // reclamation 16k adds would need several atlases.
  check('stays within one 2048 atlas', peakAtlases === 1, `peak ${peakAtlases}`);
}

// ── 9. paddedRect clamps to the atlas edge ──
console.log('\npaddedRect');
{
  const inner = paddedRect(2, new Vector2D(10, 20), new Vector2D(32, 16), 1, 1024);
  check(
    'interior rect includes the padding gutter',
    inner.atlasIndex === 2 && inner.x === 10 && inner.y === 20 && inner.w === 33 && inner.h === 17,
  );
  const edge = paddedRect(0, new Vector2D(1000, 1010), new Vector2D(24, 14), 2, 1024);
  check('edge rect is clamped to the atlas', edge.w === 24 && edge.h === 14, `${edge.w}x${edge.h}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
