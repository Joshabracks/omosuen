/**
 * Differential parity test for the omosuen-audio WASM core DSP (step 2):
 * SampleBuffer / RateTransposer / Stretch / AudioStretcher.
 *
 * Drives the WASM `core_*` ABI and the runnable oracle (test/audio-oracle.ts,
 * extracted from the worklet string) through identical feed/process/pull
 * sequences and asserts the output streams are BYTE-EXACT. The pitch is passed
 * as a ratio (Math.pow stays JS-side) so no transcendental drift can creep in.
 *
 * Run: npm run test:wasm-audio
 */
import { AudioStretcher } from './audio-oracle';
import { buildAudioWasm } from '../build-tools/wasm.mjs';

const SR = 44100;

interface AudioExports {
  memory: WebAssembly.Memory;
  core_create(sr: number): number;
  core_destroy(id: number): void;
  core_set_tempo(id: number, t: number): void;
  core_set_pitch(id: number, ratio: number): void;
  core_clear(id: number): void;
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

/** Deterministic stereo source: two detuned tones + light noise (correlated L/R
 * so cross-correlation has structure to seek on). Stored as f32 so the oracle
 * and WASM read byte-identical inputs. */
function makeSource(frames: number, seed: number): Float32Array {
  const rng = makeRng(seed);
  const out = new Float32Array(frames * 2);
  const fL = 220 + (seed % 7) * 30;
  const fR = fL * 1.5;
  for (let i = 0; i < frames; i++) {
    const t = i / SR;
    const l = 0.6 * Math.sin(2 * Math.PI * fL * t) + 0.05 * (rng() * 2 - 1);
    const r = 0.6 * Math.sin(2 * Math.PI * fR * t + 0.3) + 0.05 * (rng() * 2 - 1);
    out[i * 2] = l;
    out[i * 2 + 1] = r;
  }
  return out;
}

function runOracle(
  src: Float32Array,
  frames: number,
  tempo: number,
  pitchRatio: number,
  block: number,
): Float32Array {
  const s = new AudioStretcher(SR);
  s.tempo = tempo;
  s.pitch = pitchRatio;
  const out: number[] = [];
  let pos = 0;
  while (pos < frames) {
    const n = Math.min(block, frames - pos);
    s.inputBuffer.putSamples(src, pos, n);
    s.process();
    const avail = s.outputBuffer.frameCount;
    if (avail > 0) {
      const tmp = new Float32Array(avail * 2);
      s.outputBuffer.extract(tmp, 0, avail);
      s.outputBuffer.receive(avail);
      for (let i = 0; i < tmp.length; i++) out.push(tmp[i]);
    }
    pos += n;
  }
  return Float32Array.from(out);
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
    // Re-fetch ptr + view each call (memory may have grown → buffer detached).
    const fptr = ex.core_feed_ptr(id, n);
    new Float32Array(ex.memory.buffer, fptr, n * 2).set(
      src.subarray(pos * 2, pos * 2 + n * 2),
    );
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

function firstMismatch(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return Math.min(a.length, b.length);
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i] && !(Number.isNaN(a[i]) && Number.isNaN(b[i]))) return i;
  }
  return -1;
}

async function main(): Promise<void> {
  const ex = await makeWasm();

  const cases: Case[] = [
    { name: 'passthrough', seed: 1, frames: 12000, tempo: 1.0, pitchRatio: 1.0, block: 1024 },
    { name: 'pitch-up(rate>1)', seed: 2, frames: 12000, tempo: 1.0, pitchRatio: 1.5, block: 1024 },
    { name: 'pitch-down(rate<1)', seed: 3, frames: 12000, tempo: 1.0, pitchRatio: 0.75, block: 1024 },
    { name: 'tempo-slow', seed: 4, frames: 14000, tempo: 0.7, pitchRatio: 1.0, block: 1024 },
    { name: 'tempo-fast', seed: 5, frames: 14000, tempo: 1.4, pitchRatio: 1.0, block: 1024 },
    { name: 'both-A', seed: 6, frames: 16000, tempo: 0.85, pitchRatio: 1.2, block: 1024 },
    { name: 'both-B', seed: 7, frames: 16000, tempo: 1.3, pitchRatio: 0.9, block: 1024 },
    { name: 'quantum-block-128', seed: 8, frames: 9000, tempo: 0.9, pitchRatio: 1.1, block: 128 },
    { name: 'big-block-4096', seed: 9, frames: 20000, tempo: 1.25, pitchRatio: 0.8, block: 4096 },
    { name: 'extreme-slow', seed: 10, frames: 14000, tempo: 0.5, pitchRatio: 1.0, block: 512 },
    { name: 'extreme-fast', seed: 11, frames: 14000, tempo: 2.0, pitchRatio: 1.0, block: 512 },
  ];

  let failed = 0;
  for (const c of cases) {
    const src = makeSource(c.frames, c.seed);
    const oracle = runOracle(src, c.frames, c.tempo, c.pitchRatio, c.block);
    const wasm = runWasm(ex, src, c.frames, c.tempo, c.pitchRatio, c.block);
    const mm = firstMismatch(oracle, wasm);
    if (mm === -1 && oracle.length === wasm.length) {
      console.log(`  ✓ ${c.name} (${oracle.length / 2} frames out)`);
    } else if (oracle.length !== wasm.length) {
      console.error(
        `  ✗ ${c.name}: length ${oracle.length} (oracle) !== ${wasm.length} (wasm)`,
      );
      failed++;
    } else {
      console.error(
        `  ✗ ${c.name}: sample ${mm} oracle=${oracle[mm]} wasm=${wasm[mm]}`,
      );
      failed++;
    }
  }

  if (failed > 0) {
    console.error(`\nWASM audio core parity: ${failed} FAILED ✗`);
    process.exit(1);
  }
  console.log(`\nWASM audio core parity: ${cases.length} cases PASSED ✓`);
}

main().catch((e) => {
  console.error('\nWASM audio core parity FAILED ✗');
  console.error(e);
  process.exit(1);
});
