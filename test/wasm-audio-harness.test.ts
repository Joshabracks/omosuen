/**
 * Golden-snapshot regression for the omosuen-audio WASM processor HARNESS via the
 * high-level `stretcher_*` ABI: source feed (reverse/repeat/chunked), pre-buffer
 * transition/crossfade/fade-out, output, pending param changes, position, ended.
 *
 * Parity vs the worklet-string harness was proven byte-exact during the port
 * (audio + position + ended timing, against a runnable oracle); the JS harness has
 * since been deleted. This pins the WASM output (L/R streams + positions + ended
 * timing) per fixed quantum+message script. To re-baseline after an intentional
 * change, set GOLDENS = {} and re-run to print the captured hashes, then paste back.
 *
 * Run: npm run test:wasm-audio-harness
 */
import { buildAudioWasm } from '../build-tools/wasm.mjs';

const SR = 44100;
const N = 128; // render quantum

// Captured from the parity-proven WASM output. Keyed by case name.
const GOLDENS: Record<string, number> = {
  'direct-end-noloop': 3359329494,
  'direct-pitch-change': 1560823478,
  'direct-tempo-change': 3054008592,
  'prebuf-normal': 431931891,
  'prebuf-pitch-transition': 2249157185,
  'prebuf-tempo-transition': 4200465640,
  'prebuf-reverse-transition': 1457681598,
  'repeat-wrap': 3105225062,
  'reverse-start-repeat': 2070469751,
  'stop-midway': 2934267949,
  'combined-changes': 4279488880,
};

interface AudioExports {
  memory: WebAssembly.Memory;
  stretcher_create(sr: number, sourcePos: number, pitchRatio: number, tempo: number, repeat: number, transitionMs: number): number;
  stretcher_alloc_channels(id: number, frames: number): void;
  stretcher_channel_l_ptr(id: number): number;
  stretcher_channel_r_ptr(id: number): number;
  stretcher_set_pitch(id: number, ratio: number): void;
  stretcher_set_tempo(id: number, value: number): void;
  stretcher_set_repeat(id: number, repeat: number): void;
  stretcher_stop(id: number): void;
  stretcher_process(id: number, n: number): number;
  stretcher_output_ptr(id: number): number;
  stretcher_position(id: number): number;
  stretcher_destroy(id: number): void;
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

function makeStereo(frames: number, seed: number): { L: Float32Array; R: Float32Array } {
  const rng = makeRng(seed);
  const L = new Float32Array(frames);
  const R = new Float32Array(frames);
  const fL = 220 + (seed % 7) * 30;
  const fR = fL * 1.5;
  for (let i = 0; i < frames; i++) {
    const t = i / SR;
    L[i] = 0.6 * Math.sin(2 * Math.PI * fL * t) + 0.05 * (rng() * 2 - 1);
    R[i] = 0.6 * Math.sin(2 * Math.PI * fR * t + 0.3) + 0.05 * (rng() * 2 - 1);
  }
  return { L, R };
}

function fnv1a(h: number, bytes: Uint8Array): number {
  let hash = h;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

interface Msg {
  at: number;
  type: 'pitch' | 'tempo' | 'repeat' | 'stop';
  value?: number;
}

interface Case {
  name: string;
  seed: number;
  frames: number;
  sourcePos: number;
  pitchShift: number;
  tempo: number;
  repeat: boolean;
  transitionBuffer: number;
  quanta: number;
  messages: Msg[];
}

function caseHash(ex: AudioExports, c: Case): number {
  const { L, R } = makeStereo(c.frames, c.seed);
  const id = ex.stretcher_create(SR, c.sourcePos, Math.pow(2, c.pitchShift / 12), c.tempo, c.repeat ? 1 : 0, c.transitionBuffer);
  const frames = L.length;
  ex.stretcher_alloc_channels(id, frames);
  new Float32Array(ex.memory.buffer, ex.stretcher_channel_l_ptr(id), frames).set(L);
  new Float32Array(ex.memory.buffer, ex.stretcher_channel_r_ptr(id), frames).set(R);

  const outL: number[] = [];
  const outR: number[] = [];
  const positions: number[] = [];
  let endedAt = -1;

  for (let q = 0; q < c.quanta; q++) {
    for (const m of c.messages) {
      if (m.at !== q) continue;
      if (m.type === 'pitch') ex.stretcher_set_pitch(id, Math.pow(2, m.value! / 12));
      else if (m.type === 'tempo') ex.stretcher_set_tempo(id, m.value!);
      else if (m.type === 'repeat') ex.stretcher_set_repeat(id, m.value ? 1 : 0);
      else if (m.type === 'stop') ex.stretcher_stop(id);
    }
    const st = ex.stretcher_process(id, N);
    if (st !== 2) {
      const ptr = ex.stretcher_output_ptr(id);
      const mem = new Float32Array(ex.memory.buffer, ptr, N * 2);
      for (let i = 0; i < N; i++) {
        outL.push(mem[i]);
        outR.push(mem[N + i]);
      }
    } else {
      for (let i = 0; i < N; i++) { outL.push(0); outR.push(0); }
    }
    positions.push(ex.stretcher_position(id));
    if (st !== 0) { endedAt = q; break; }
  }
  ex.stretcher_destroy(id);

  const la = Float32Array.from(outL);
  const ra = Float32Array.from(outR);
  const pa = Float64Array.from(positions);
  let h = fnv1a(0x811c9dc5, new Uint8Array(new Int32Array([endedAt, la.length]).buffer));
  h = fnv1a(h, new Uint8Array(la.buffer, la.byteOffset, la.byteLength));
  h = fnv1a(h, new Uint8Array(ra.buffer, ra.byteOffset, ra.byteLength));
  h = fnv1a(h, new Uint8Array(pa.buffer, pa.byteOffset, pa.byteLength));
  return h;
}

async function main(): Promise<void> {
  const ex = await makeWasm();

  const cases: Case[] = [
    { name: 'direct-end-noloop', seed: 1, frames: 2000, sourcePos: 0, pitchShift: 0, tempo: 1.0, repeat: false, transitionBuffer: 0, quanta: 400, messages: [] },
    { name: 'direct-pitch-change', seed: 2, frames: 30000, sourcePos: 0, pitchShift: 0, tempo: 1.0, repeat: false, transitionBuffer: 0, quanta: 150, messages: [{ at: 20, type: 'pitch', value: 4 }] },
    { name: 'direct-tempo-change', seed: 3, frames: 30000, sourcePos: 0, pitchShift: 0, tempo: 1.0, repeat: false, transitionBuffer: 0, quanta: 150, messages: [{ at: 25, type: 'tempo', value: 1.5 }] },
    { name: 'prebuf-normal', seed: 4, frames: 30000, sourcePos: 0, pitchShift: 0, tempo: 1.0, repeat: false, transitionBuffer: 80, quanta: 180, messages: [] },
    { name: 'prebuf-pitch-transition', seed: 5, frames: 40000, sourcePos: 0, pitchShift: 0, tempo: 1.0, repeat: false, transitionBuffer: 80, quanta: 250, messages: [{ at: 40, type: 'pitch', value: 5 }] },
    { name: 'prebuf-tempo-transition', seed: 6, frames: 40000, sourcePos: 0, pitchShift: 0, tempo: 1.0, repeat: false, transitionBuffer: 80, quanta: 250, messages: [{ at: 40, type: 'tempo', value: 0.8 }] },
    { name: 'prebuf-reverse-transition', seed: 7, frames: 40000, sourcePos: 0, pitchShift: 0, tempo: 1.0, repeat: true, transitionBuffer: 80, quanta: 260, messages: [{ at: 40, type: 'tempo', value: -1.0 }] },
    { name: 'repeat-wrap', seed: 8, frames: 1500, sourcePos: 0, pitchShift: 0, tempo: 1.0, repeat: true, transitionBuffer: 0, quanta: 300, messages: [] },
    { name: 'reverse-start-repeat', seed: 9, frames: 3000, sourcePos: 3000, pitchShift: 0, tempo: -1.0, repeat: true, transitionBuffer: 0, quanta: 200, messages: [] },
    { name: 'stop-midway', seed: 10, frames: 30000, sourcePos: 0, pitchShift: 0, tempo: 1.0, repeat: false, transitionBuffer: 0, quanta: 80, messages: [{ at: 30, type: 'stop' }] },
    { name: 'combined-changes', seed: 11, frames: 50000, sourcePos: 0, pitchShift: 2, tempo: 1.1, repeat: false, transitionBuffer: 60, quanta: 300, messages: [{ at: 30, type: 'pitch', value: -3 }, { at: 120, type: 'tempo', value: 1.4 }] },
  ];

  let failed = 0;
  let missing = 0;
  for (const c of cases) {
    const h = caseHash(ex, c);
    const golden = GOLDENS[c.name];
    if (golden === undefined || golden === 0) {
      console.log(`  CAPTURE  '${c.name}': ${h},`);
      missing++;
    } else if (golden !== h) {
      console.error(`  ✗ ${c.name}: golden ${golden} !== ${h}`);
      failed++;
    } else {
      console.log(`  ✓ ${c.name} (${h})`);
    }
  }

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
    console.error(`\nWASM audio harness golden: ${failed} FAILED ✗`);
    process.exit(1);
  }
  console.log(`\nWASM audio harness golden: ${cases.length} cases PASSED ✓`);
}

main().catch((e) => {
  console.error('\nWASM audio harness golden FAILED ✗');
  console.error(e);
  process.exit(1);
});
