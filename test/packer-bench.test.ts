/**
 * Packer scaling benchmark (Phase 4, Step 1 — the gate). Run: npm run test:packer
 *
 * The guillotine packer (src/component/atlas-manager/packer.ts) picks each frame
 * by a linear best-fit scan over sorted free-space buckets plus three array
 * splices per allocation — roughly O(N^2) in frame count. Dedup makes this a
 * non-issue for typical scenes (1 ms for 31 unique frames), so the open question
 * is narrow: does pack time become a problem for many GENUINELY unique frames?
 *
 * This measures full-pack time + packing utilization across frame counts and
 * size distributions, plus the retain-mode incremental path (packFramesInto into
 * one persistent PackerState in batches). It is a measurement harness, not a
 * pass/fail test — it prints a table and exits 0. The numbers decide whether the
 * packer optimizations (Steps 2-3) are warranted or the packer is left as-is.
 *
 * The packer is pure geometry: packFrames/packFramesInto read only frame.size
 * (never the DOM sourceImage), so frames are synthesized headlessly.
 */
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { Vector2D } from '../src/math';
import { packFrames, createPackerState, packFramesInto } from '../src/component/atlas-manager/packer';
import type { UnpackedFrame } from '../src/component/atlas-manager/types';

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
};

// mulberry32 — deterministic PRNG (no Math.random, for reproducible runs).
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Dist = 'uniform' | 'few' | 'random';

// Sizes are kept small so N frames fit in 16 atlases of 4096 (many unique frames
// in real scenes are small — tiles, glyphs, particles). uniform 32px → 124*124
// = 15,376 per atlas; 16 atlases ≈ 246k capacity, so 20k always fits.
function frameSize(dist: Dist, rng: () => number): Vector2D {
  switch (dist) {
    case 'uniform':
      return new Vector2D(32, 32);
    case 'few': {
      const sizes = [16, 32, 48, 64];
      const s = sizes[(rng() * sizes.length) | 0];
      return new Vector2D(s, s);
    }
    case 'random': {
      const w = 8 + ((rng() * 56) | 0); // 8..63
      const h = 8 + ((rng() * 56) | 0);
      return new Vector2D(w, h);
    }
  }
}

function makeFrames(dist: Dist, n: number, seed: number): UnpackedFrame[] {
  const rng = makeRng(seed);
  const frames: UnpackedFrame[] = [];
  for (let i = 0; i < n; i++) {
    frames.push({ size: frameSize(dist, rng) } as unknown as UnpackedFrame);
  }
  return frames;
}

const ATLAS_SIZE = 4096;
const MAX_ATLASES = 16;
const PADDING = 1;

// ── Layout parity ────────────────────────────────────────────────────────────
// Hash each INPUT frame's final placement (atlasIndex, atlasPosition) in input
// order. packFrames mutates the frame objects in place, so this is stable
// regardless of allocation order — it pins WHERE each frame lands. Captured from
// the current array-based packer; the O(N log N) refactor must reproduce it
// byte-for-byte (identical packing → same atlas count / utilization).
function fnv1a(h: number, n: number): number {
  let hash = h;
  // mix 4 bytes of n
  for (let i = 0; i < 4; i++) {
    hash ^= (n >>> (i * 8)) & 0xff;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function hashPacking(frames: UnpackedFrame[]): number {
  let h = 0x811c9dc5;
  for (const f of frames) {
    h = fnv1a(h, f.atlasIndex ?? -1);
    h = fnv1a(h, f.atlasPosition ? f.atlasPosition.x : -1);
    h = fnv1a(h, f.atlasPosition ? f.atlasPosition.y : -1);
  }
  return h >>> 0;
}

interface ParityCase {
  dist: Dist;
  n: number;
  seed: number;
}

const PARITY_CASES: ParityCase[] = [];
for (const dist of ['uniform', 'few', 'random'] as Dist[]) {
  for (const n of [500, 2000, 8000]) {
    for (const seed of [1, 2, 3]) {
      PARITY_CASES.push({ dist, n, seed });
    }
  }
}

// Captured from the current (array-based) packer. The O(N log N) refactor must
// reproduce these exactly. Set to {} to re-capture (prints a paste-ready block).
const GOLDENS: Record<string, number> = {
  'uniform-500-1': 1882073653,
  'uniform-500-2': 1882073653,
  'uniform-500-3': 1882073653,
  'uniform-2000-1': 3801090557,
  'uniform-2000-2': 3801090557,
  'uniform-2000-3': 3801090557,
  'uniform-8000-1': 2867122353,
  'uniform-8000-2': 2867122353,
  'uniform-8000-3': 2867122353,
  'few-500-1': 3597354628,
  'few-500-2': 2237373687,
  'few-500-3': 369823040,
  'few-2000-1': 715817746,
  'few-2000-2': 3624484888,
  'few-2000-3': 3207822108,
  'few-8000-1': 3709777116,
  'few-8000-2': 3030523522,
  'few-8000-3': 2206312934,
  'random-500-1': 4151994965,
  'random-500-2': 795078067,
  'random-500-3': 3552034576,
  'random-2000-1': 2586407695,
  'random-2000-2': 518130844,
  'random-2000-3': 98365021,
  'random-8000-1': 385028678,
  'random-8000-2': 877777612,
  'random-8000-3': 257453726,
};

function utilization(frames: UnpackedFrame[], atlasCount: number): number {
  if (atlasCount === 0) return 0;
  let area = 0;
  for (const f of frames) area += f.size.x * f.size.y;
  return area / (atlasCount * ATLAS_SIZE * ATLAS_SIZE);
}

function atlasCountOf(frames: UnpackedFrame[]): number {
  let max = -1;
  for (const f of frames) {
    if (f.atlasIndex !== undefined && f.atlasIndex > max) max = f.atlasIndex;
  }
  return max + 1;
}

interface Row {
  dist: Dist;
  n: number;
  ms: number;
  atlases: number;
  utilPct: number;
  overflow: boolean;
}

function benchFull(dist: Dist, n: number): Row {
  const frames = makeFrames(dist, n, 0x1234 + n);
  let overflow = false;
  let ms = 0;
  let atlases = 0;
  let utilPct = 0;
  try {
    const t0 = performance.now();
    const packed = packFrames(frames, ATLAS_SIZE, MAX_ATLASES, PADDING);
    ms = performance.now() - t0;
    atlases = atlasCountOf(packed);
    utilPct = utilization(packed, atlases) * 100;
  } catch {
    overflow = true;
  }
  return { dist, n, ms, atlases, utilPct, overflow };
}

interface IncRow {
  dist: Dist;
  n: number;
  batches: number;
  totalMs: number;
  avgBatchMs: number;
  maxBatchMs: number;
  overflow: boolean;
}

// Retain-mode path: pack N frames through ONE persistent state in `batches`
// equal chunks (simulating repeated runtime adds).
function benchIncremental(dist: Dist, n: number, batches: number): IncRow {
  const frames = makeFrames(dist, n, 0x9abc + n);
  const state = createPackerState(ATLAS_SIZE, MAX_ATLASES, PADDING);
  const per = Math.ceil(n / batches);
  let totalMs = 0;
  let maxBatchMs = 0;
  let overflow = false;
  try {
    for (let i = 0; i < n; i += per) {
      const chunk = frames.slice(i, i + per);
      const t0 = performance.now();
      packFramesInto(state, chunk);
      const dt = performance.now() - t0;
      totalMs += dt;
      if (dt > maxBatchMs) maxBatchMs = dt;
    }
  } catch {
    overflow = true;
  }
  const actualBatches = Math.ceil(n / per);
  return {
    dist,
    n,
    batches: actualBatches,
    totalMs,
    avgBatchMs: totalMs / actualBatches,
    maxBatchMs,
    overflow,
  };
}

function fmt(ms: number): string {
  return ms.toFixed(ms < 10 ? 2 : ms < 100 ? 1 : 0);
}

// Returns true if all parity cases match goldens (or capture mode). Prints a
// paste-ready GOLDENS block when capturing or on mismatch.
export function runParity(): boolean {
  console.log(`${colors.bright}Layout parity (packing must be byte-identical)${colors.reset}`);
  const captured: Record<string, number> = {};
  let allPass = true;
  let haveGoldens = Object.keys(GOLDENS).length > 0;
  for (const c of PARITY_CASES) {
    const key = `${c.dist}-${c.n}-${c.seed}`;
    const frames = makeFrames(c.dist, c.n, c.seed);
    try {
      packFrames(frames, ATLAS_SIZE, MAX_ATLASES, PADDING);
    } catch {
      // overflow shouldn't happen at these N with small frames; treat as fail.
    }
    const h = hashPacking(frames);
    captured[key] = h;
    if (haveGoldens) {
      const want = GOLDENS[key];
      const ok = want === h;
      if (!ok) allPass = false;
      console.log(
        `  ${ok ? colors.green + 'PASS' : colors.red + 'FAIL'}${colors.reset} ${key.padEnd(16)} ${h}` +
          (ok ? '' : ` (expected ${want})`),
      );
    }
  }
  if (!haveGoldens) {
    console.log(`  ${colors.yellow}capture mode${colors.reset} — paste into GOLDENS:`);
    console.log('const GOLDENS: Record<string, number> = {');
    for (const c of PARITY_CASES) {
      const key = `${c.dist}-${c.n}-${c.seed}`;
      console.log(`  '${key}': ${captured[key]},`);
    }
    console.log('};');
  }
  console.log('');
  return allPass;
}

export function runPackerBench(): boolean {
  console.log(
    `\n${colors.bright}${colors.cyan}Packer scaling benchmark${colors.reset} ` +
      `(atlas ${ATLAS_SIZE}, maxAtlases ${MAX_ATLASES}, padding ${PADDING})\n`,
  );

  const dists: Dist[] = ['uniform', 'few', 'random'];
  const counts = [1000, 5000, 10000, 20000, 50000];

  console.log(`${colors.bright}Full pack — time vs frame count${colors.reset}`);
  console.log(
    `${'dist'.padEnd(8)}${'N'.padStart(7)}${'pack ms'.padStart(10)}${'atlases'.padStart(9)}${'util%'.padStart(8)}`,
  );
  for (const dist of dists) {
    for (const n of counts) {
      const r = benchFull(dist, n);
      const msCol = r.overflow ? `${colors.red}overflow${colors.reset}` : fmt(r.ms).padStart(10);
      const tail = r.overflow
        ? ''
        : `${String(r.atlases).padStart(9)}${r.utilPct.toFixed(1).padStart(8)}`;
      console.log(`${dist.padEnd(8)}${String(n).padStart(7)}${msCol}${tail}`);
    }
  }

  console.log(
    `\n${colors.bright}Incremental pack (retain path) — N in 50-frame batches${colors.reset}`,
  );
  console.log(
    `${'dist'.padEnd(8)}${'N'.padStart(7)}${'batches'.padStart(9)}${'total ms'.padStart(10)}${'avg/batch'.padStart(11)}${'max batch'.padStart(11)}`,
  );
  for (const dist of dists) {
    for (const n of [1000, 5000, 10000, 20000]) {
      const batches = Math.max(1, Math.round(n / 50));
      const r = benchIncremental(dist, n, batches);
      if (r.overflow) {
        console.log(
          `${dist.padEnd(8)}${String(n).padStart(7)}${`${colors.red}overflow${colors.reset}`.padStart(9)}`,
        );
        continue;
      }
      console.log(
        `${dist.padEnd(8)}${String(n).padStart(7)}${String(r.batches).padStart(9)}` +
          `${fmt(r.totalMs).padStart(10)}${fmt(r.avgBatchMs).padStart(11)}${fmt(r.maxBatchMs).padStart(11)}`,
      );
    }
  }

  console.log(
    `\n${colors.yellow}Gate:${colors.reset} if full-pack stays well under a frame budget (~16 ms) ` +
      `at the largest realistic N, and incremental max-batch stays small, the packer needs no\n` +
      `optimization (Steps 2-3 parked). Otherwise the curve shows where to optimize.\n`,
  );

  return true;
}

// Entry guard — pathToFileURL handles Windows paths (backslashes/drive letters)
// correctly, unlike a raw `file://${argv[1]}` string compare.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const parityOk = runParity();
  runPackerBench();
  process.exit(parityOk ? 0 : 1);
}
