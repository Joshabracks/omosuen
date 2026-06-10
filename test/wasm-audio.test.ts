/**
 * Golden-snapshot regression for the omosuen-audio WASM core DSP
 * (SampleBuffer / RateTransposer / Stretch / AudioStretcher) via the low-level
 * `core_*` ABI.
 *
 * Parity vs the in-house TS WSOLA was proven byte-exact during the port (against
 * a runnable oracle extracted from the worklet string); the JS DSP has since been
 * deleted (single source of truth). This pins the WASM output per fixed case via
 * a content hash so regressions are caught. To re-baseline after an intentional
 * DSP change, set GOLDENS = {} and re-run — the test prints the captured hashes —
 * then paste them back.
 *
 * Run: npm run test:wasm-audio
 */
import { buildAudioWasm } from '../build-tools/wasm.mjs';

const SR = 44100;

// Captured from the parity-proven WASM output. Keyed by case name.
const GOLDENS: Record<string, number> = {
  passthrough: 1742283671,
  'pitch-up': 1030187222,
  'pitch-down': 3793877779,
  'tempo-slow': 2916304829,
  'tempo-fast': 2468786648,
  'both-A': 2830985358,
  'both-B': 3134975508,
  'quantum-128': 2080401836,
  'big-4096': 2117384940,
  'extreme-slow': 20752206,
  'extreme-fast': 2083025537,
};

interface AudioExports {
  memory: WebAssembly.Memory;
  core_create(sr: number): number;
  core_destroy(id: number): void;
  core_set_tempo(id: number, t: number): void;
  core_set_pitch(id: number, ratio: number): void;
  core_feed_ptr(id: number, frames: number): number;
  core_feed(id: number, frames: number): void;
  core_process(id: number): void;
  core_output_frames(id: number): number;
  core_pull_ptr(id: number, frames: number): number;
}

async function makeWasm(): Promise<AudioExports> {
  const bytes = buildAudioWasm();
  const module = await WebAssembly.compile(bytes as BufferSource);
  const instance = await WebAssembly.instantiate(module, {});
  return instance.exports as unknown as AudioExports;
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeSource(frames: number, seed: number): Float32Array {
  const rng = makeRng(seed);
  const out = new Float32Array(frames * 2);
  const fL = 220 + (seed % 7) * 30;
  const fR = fL * 1.5;
  for (let i = 0; i < frames; i++) {
    const t = i / SR;
    out[i * 2] = 0.6 * Math.sin(2 * Math.PI * fL * t) + 0.05 * (rng() * 2 - 1);
    out[i * 2 + 1] = 0.6 * Math.sin(2 * Math.PI * fR * t + 0.3) + 0.05 * (rng() * 2 - 1);
  }
  return out;
}

function fnv1a(h: number, bytes: Uint8Array): number {
  let hash = h;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function hashF32(arr: Float32Array): number {
  const meta = new Uint8Array(new Uint32Array([arr.length]).buffer);
  let h = fnv1a(0x811c9dc5, meta);
  h = fnv1a(h, new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength));
  return h;
}

function runWasm(
  ex: AudioExports,
  src: Float32Array,
  frames: number,
  tempo: number,
  pitchRatio: number,
  block: number,
): Float32Array {
  const id = ex.core_create(SR);
  ex.core_set_tempo(id, tempo);
  ex.core_set_pitch(id, pitchRatio);
  const out: number[] = [];
  let pos = 0;
  while (pos < frames) {
    const n = Math.min(block, frames - pos);
    const fptr = ex.core_feed_ptr(id, n);
    new Float32Array(ex.memory.buffer, fptr, n * 2).set(src.subarray(pos * 2, pos * 2 + n * 2));
    ex.core_feed(id, n);
    ex.core_process(id);
    const avail = ex.core_output_frames(id);
    if (avail > 0) {
      const pptr = ex.core_pull_ptr(id, avail);
      const pview = new Float32Array(ex.memory.buffer, pptr, avail * 2);
      for (let i = 0; i < avail * 2; i++) out.push(pview[i]);
    }
    pos += n;
  }
  ex.core_destroy(id);
  return Float32Array.from(out);
}

interface Case {
  name: string;
  seed: number;
  frames: number;
  tempo: number;
  pitchRatio: number;
  block: number;
}

function caseHash(ex: AudioExports, c: Case): number {
  const src = makeSource(c.frames, c.seed);
  return hashF32(runWasm(ex, src, c.frames, c.tempo, c.pitchRatio, c.block));
}

async function main(): Promise<void> {
  const ex = await makeWasm();

  const cases: Case[] = [
    { name: 'passthrough', seed: 1, frames: 12000, tempo: 1.0, pitchRatio: 1.0, block: 1024 },
    { name: 'pitch-up', seed: 2, frames: 12000, tempo: 1.0, pitchRatio: 1.5, block: 1024 },
    { name: 'pitch-down', seed: 3, frames: 12000, tempo: 1.0, pitchRatio: 0.75, block: 1024 },
    { name: 'tempo-slow', seed: 4, frames: 14000, tempo: 0.7, pitchRatio: 1.0, block: 1024 },
    { name: 'tempo-fast', seed: 5, frames: 14000, tempo: 1.4, pitchRatio: 1.0, block: 1024 },
    { name: 'both-A', seed: 6, frames: 16000, tempo: 0.85, pitchRatio: 1.2, block: 1024 },
    { name: 'both-B', seed: 7, frames: 16000, tempo: 1.3, pitchRatio: 0.9, block: 1024 },
    { name: 'quantum-128', seed: 8, frames: 9000, tempo: 0.9, pitchRatio: 1.1, block: 128 },
    { name: 'big-4096', seed: 9, frames: 20000, tempo: 1.25, pitchRatio: 0.8, block: 4096 },
    { name: 'extreme-slow', seed: 10, frames: 14000, tempo: 0.5, pitchRatio: 1.0, block: 512 },
    { name: 'extreme-fast', seed: 11, frames: 14000, tempo: 2.0, pitchRatio: 1.0, block: 512 },
  ];

  let failed = 0;
  let missing = 0;
  for (const c of cases) {
    const h = caseHash(ex, c);
    const golden = GOLDENS[c.name];
    if (golden === undefined) {
      console.log(`  CAPTURE  '${c.name}': ${h},`);
      missing++;
    } else if (golden !== h) {
      console.error(`  ✗ ${c.name}: golden ${golden} !== ${h}`);
      failed++;
    } else {
      console.log(`  ✓ ${c.name} (${h})`);
    }
  }

  // Determinism: a second pass must produce identical hashes.
  for (const c of cases) {
    if (caseHash(ex, c) !== caseHash(ex, c)) {
      console.error(`  ✗ ${c.name}: non-deterministic output`);
      failed++;
    }
  }

  if (missing > 0) {
    console.log(`\n${missing} golden(s) missing — paste the CAPTURE lines into GOLDENS and re-run.`);
    process.exit(1);
  }
  if (failed > 0) {
    console.error(`\nWASM audio core golden: ${failed} FAILED ✗`);
    process.exit(1);
  }
  console.log(`\nWASM audio core golden: ${cases.length} cases PASSED ✓`);
}

main().catch((e) => {
  console.error('\nWASM audio core golden FAILED ✗');
  console.error(e);
  process.exit(1);
});
