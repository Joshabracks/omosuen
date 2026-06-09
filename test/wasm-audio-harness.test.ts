/**
 * Differential parity test for the omosuen-audio WASM processor HARNESS (step 3):
 * the full StretcherProcessor logic — source feed (reverse/repeat/chunked),
 * pre-buffer + transition/crossfade/fade-out, output, pending param changes, and
 * the output-derived source position.
 *
 * Drives the WASM `stretcher_*` ABI (as the worklet shell will) and the runnable
 * oracle (test/audio-oracle.ts Processor, extracted from the worklet string)
 * through identical per-quantum + message scripts, and asserts BYTE-EXACT output
 * streams, bit-exact positions, and identical terminate timing.
 *
 * Run: npm run test:wasm-audio-harness
 */
import { Processor as OracleProcessor } from './audio-oracle';
import { buildAudioWasm } from '../build-tools/wasm.mjs';

const SR = 44100;
const N = 128; // render quantum

interface AudioExports {
  memory: WebAssembly.Memory;
  stretcher_create(
    sr: number,
    sourcePos: number,
    pitchRatio: number,
    tempo: number,
    repeat: number,
    transitionMs: number,
  ): number;
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

interface Msg {
  at: number;
  type: 'pitch' | 'tempo' | 'repeat' | 'stop';
  value?: number;
}

interface Driver {
  init(
    sr: number,
    L: Float32Array,
    R: Float32Array,
    sourcePos: number,
    pitchShift: number,
    tempo: number,
    repeat: boolean,
    transitionBuffer: number,
  ): void;
  msgPitch(semitones: number): void;
  msgTempo(value: number): void;
  msgRepeat(repeat: boolean): void;
  stop(): void;
  process(outL: Float32Array, outR: Float32Array): boolean;
  position: number;
}

class WasmDriver implements Driver {
  id = -1;
  position = 0;
  constructor(private ex: AudioExports) {}
  init(sr, L, R, sourcePos, pitchShift, tempo, repeat, transitionBuffer): void {
    this.id = this.ex.stretcher_create(
      sr,
      sourcePos,
      Math.pow(2, pitchShift / 12),
      tempo,
      repeat ? 1 : 0,
      transitionBuffer,
    );
    const frames = L.length;
    this.ex.stretcher_alloc_channels(this.id, frames);
    new Float32Array(this.ex.memory.buffer, this.ex.stretcher_channel_l_ptr(this.id), frames).set(L);
    new Float32Array(this.ex.memory.buffer, this.ex.stretcher_channel_r_ptr(this.id), frames).set(R);
  }
  msgPitch(semitones): void {
    this.ex.stretcher_set_pitch(this.id, Math.pow(2, semitones / 12));
  }
  msgTempo(value): void {
    this.ex.stretcher_set_tempo(this.id, value);
  }
  msgRepeat(repeat): void {
    this.ex.stretcher_set_repeat(this.id, repeat ? 1 : 0);
  }
  stop(): void {
    this.ex.stretcher_stop(this.id);
  }
  process(outL, outR): boolean {
    const n = outL.length;
    const st = this.ex.stretcher_process(this.id, n);
    if (st !== 2) {
      const ptr = this.ex.stretcher_output_ptr(this.id);
      const mem = new Float32Array(this.ex.memory.buffer, ptr, n * 2);
      outL.set(mem.subarray(0, n));
      outR.set(mem.subarray(n, n * 2));
    }
    this.position = this.ex.stretcher_position(this.id);
    return st === 0;
  }
}

interface Case {
  name: string;
  seed: number;
  frames: number;
  sourcePos: number;
  pitchShift: number;
  tempo: number;
  repeat: boolean;
  transitionBuffer: number; // ms
  quanta: number;
  messages: Msg[];
}

interface RunResult {
  L: number[];
  R: number[];
  positions: number[];
  endedAt: number;
}

function runHarness(driver: Driver, c: Case, L: Float32Array, R: Float32Array): RunResult {
  driver.init(SR, L, R, c.sourcePos, c.pitchShift, c.tempo, c.repeat, c.transitionBuffer);
  const outL: number[] = [];
  const outR: number[] = [];
  const positions: number[] = [];
  let endedAt = -1;
  for (let q = 0; q < c.quanta; q++) {
    for (const m of c.messages) {
      if (m.at !== q) continue;
      if (m.type === 'pitch') driver.msgPitch(m.value!);
      else if (m.type === 'tempo') driver.msgTempo(m.value!);
      else if (m.type === 'repeat') driver.msgRepeat(!!m.value);
      else if (m.type === 'stop') driver.stop();
    }
    const bL = new Float32Array(N);
    const bR = new Float32Array(N);
    const cont = driver.process(bL, bR);
    for (let i = 0; i < N; i++) {
      outL.push(bL[i]);
      outR.push(bR[i]);
    }
    positions.push(driver.position);
    if (!cont) {
      endedAt = q;
      break;
    }
  }
  return { L: outL, R: outR, positions, endedAt };
}

function firstDiff(a: number[], b: number[]): number {
  if (a.length !== b.length) return Math.min(a.length, b.length);
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i] && !(Number.isNaN(a[i]) && Number.isNaN(b[i]))) return i;
  }
  return -1;
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
  for (const c of cases) {
    const { L, R } = makeStereo(c.frames, c.seed);
    const oracle = runHarness(new OracleProcessor() as unknown as Driver, c, L, R);
    const wasm = runHarness(new WasmDriver(ex), c, L, R);

    const dL = firstDiff(oracle.L, wasm.L);
    const dR = firstDiff(oracle.R, wasm.R);
    const dP = firstDiff(oracle.positions, wasm.positions);
    const okEnd = oracle.endedAt === wasm.endedAt;

    if (dL === -1 && dR === -1 && dP === -1 && okEnd) {
      console.log(
        `  ✓ ${c.name} (${oracle.L.length} samples, endedAt=${oracle.endedAt})`,
      );
    } else {
      failed++;
      if (!okEnd) {
        console.error(`  ✗ ${c.name}: endedAt oracle=${oracle.endedAt} wasm=${wasm.endedAt}`);
      }
      if (dL !== -1) console.error(`  ✗ ${c.name}: L[${dL}] oracle=${oracle.L[dL]} wasm=${wasm.L[dL]}`);
      if (dR !== -1) console.error(`  ✗ ${c.name}: R[${dR}] oracle=${oracle.R[dR]} wasm=${wasm.R[dR]}`);
      if (dP !== -1) console.error(`  ✗ ${c.name}: pos[${dP}] oracle=${oracle.positions[dP]} wasm=${wasm.positions[dP]}`);
    }
  }

  if (failed > 0) {
    console.error(`\nWASM audio harness parity: ${failed} FAILED ✗`);
    process.exit(1);
  }
  console.log(`\nWASM audio harness parity: ${cases.length} cases PASSED ✓`);
}

main().catch((e) => {
  console.error('\nWASM audio harness parity FAILED ✗');
  console.error(e);
  process.exit(1);
});
