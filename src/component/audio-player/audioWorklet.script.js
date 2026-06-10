// WSOLA Pitch/Speed Separation — AudioWorklet shell over the omosuen-audio WASM crate.
//
// This is a standalone worklet script (its own realm: AudioWorkletGlobalScope).
// It is NOT imported by the engine — webpack reads it as text, inlines the
// base64-encoded omosuen-audio wasm in place of the WASM_BASE64 sentinel below,
// and ships the finished source via DefinePlugin as __AUDIO_WORKLET_SCRIPT__
// (see webpack.config.js). methods.ts builds a Blob from that string and calls
// audioWorklet.addModule().
//
// The DSP + harness (SampleBuffer / RateTransposer / Stretch / AudioStretcher +
// the StretcherProcessor feed/transition/output logic) live in the WASM crate;
// this shell only wires the worklet API to the `stretcher_*` ABI.

// ── omosuen-audio WASM (one instance per AudioWorkletGlobalScope realm) ──
// atob/fetch are unavailable here, so the base64 (injected by webpack) is decoded
// inline. The string literal below is replaced at build time.
const __AUDIO_WASM_B64 = "__AUDIO_WASM_BASE64__";
function __b64ToBytes(s) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lut = new Int16Array(256).fill(-1);
  for (let i = 0; i < chars.length; i++) lut[chars.charCodeAt(i)] = i;
  const len = s.length;
  let pad = 0;
  if (len > 0 && s[len - 1] === '=') pad++;
  if (len > 1 && s[len - 2] === '=') pad++;
  const outLen = ((len / 4) | 0) * 3 - pad;
  const out = new Uint8Array(outLen);
  let o = 0;
  for (let i = 0; i < len; i += 4) {
    const a = lut[s.charCodeAt(i)], b = lut[s.charCodeAt(i + 1)];
    const c = lut[s.charCodeAt(i + 2)], d = lut[s.charCodeAt(i + 3)];
    const n = (a << 18) | (b << 12) | ((c & 63) << 6) | (d & 63);
    if (o < outLen) out[o++] = (n >> 16) & 255;
    if (o < outLen) out[o++] = (n >> 8) & 255;
    if (o < outLen) out[o++] = n & 255;
  }
  return out;
}
let __wasm = null;
let __wasmReady = false;
const __pending = [];
(function () {
  try {
    WebAssembly.instantiate(__b64ToBytes(__AUDIO_WASM_B64), {}).then((res) => {
      __wasm = res.instance.exports;
      __wasmReady = true;
      for (const p of __pending) p._onWasmReady();
      __pending.length = 0;
    }).catch((e) => { console.error('[omosuen-audio] WASM instantiate failed', e); });
  } catch (e) { console.error('[omosuen-audio] WASM decode failed', e); }
})();

class StretcherProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.id = -1;
    this.created = false;
    this.initMsg = null;
    this.queued = [];
    this.posCounter = 0;
    // Cached view over the WASM output region; rebuilt only after memory.grow
    // (detected via buffer identity) so steady-state process() allocates nothing.
    this.outView = null;
    this.outBuf = null;
    this.port.onmessage = (e) => this._handle(e.data);
  }

  _handle(msg) {
    if (msg.type === 'init') {
      this.initMsg = msg;
      if (__wasmReady) this._create();
      else __pending.push(this);
      return;
    }
    if (!this.created) { this.queued.push(msg); return; }
    this._apply(msg);
  }

  _onWasmReady() {
    if (this.initMsg && !this.created) this._create();
  }

  _create() {
    const m = this.initMsg;
    const frames = m.channelL.length;
    this.id = __wasm.stretcher_create(
      sampleRate,
      m.sourcePos,
      Math.pow(2, m.pitchShift / 12),
      m.tempo,
      m.repeat ? 1 : 0,
      m.transitionBuffer
    );
    __wasm.stretcher_alloc_channels(this.id, frames);
    new Float32Array(__wasm.memory.buffer, __wasm.stretcher_channel_l_ptr(this.id), frames).set(m.channelL);
    new Float32Array(__wasm.memory.buffer, __wasm.stretcher_channel_r_ptr(this.id), frames).set(m.channelR);
    this.created = true;
    for (const qm of this.queued) this._apply(qm);
    this.queued.length = 0;
  }

  _apply(msg) {
    switch (msg.type) {
      case 'pitch': __wasm.stretcher_set_pitch(this.id, Math.pow(2, msg.value / 12)); break;
      case 'tempo': __wasm.stretcher_set_tempo(this.id, msg.value); break;
      case 'repeat': __wasm.stretcher_set_repeat(this.id, msg.value ? 1 : 0); break;
      case 'stop': __wasm.stretcher_stop(this.id); break;
    }
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length < 2) return true;
    // Not yet instantiated/created → output silence (buffers are pre-zeroed).
    if (!this.created) return true;

    const outputL = output[0];
    const outputR = output[1];
    const n = outputL.length;

    const status = __wasm.stretcher_process(this.id, n);
    if (status !== 2) {
      // Rebuild the cached view only when linear memory grew (buffer swapped).
      if (this.outView === null || this.outBuf !== __wasm.memory.buffer) {
        this.outBuf = __wasm.memory.buffer;
        this.outView = new Float32Array(this.outBuf, __wasm.stretcher_output_ptr(this.id), n * 2);
      }
      const mem = this.outView;
      for (let i = 0; i < n; i++) {
        outputL[i] = mem[i];
        outputR[i] = mem[n + i];
      }

      this.posCounter++;
      if (this.posCounter >= 8) {
        this.posCounter = 0;
        this.port.postMessage({ type: 'position', value: __wasm.stretcher_position(this.id) });
      }
    }

    if (status === 1) {
      this.port.postMessage({ type: 'ended' });
      __wasm.stretcher_destroy(this.id);
      this.created = false;
      return false;
    }
    if (status === 2) {
      __wasm.stretcher_destroy(this.id);
      this.created = false;
      return false;
    }
    return true;
  }
}

registerProcessor('stretcher-processor', StretcherProcessor);
