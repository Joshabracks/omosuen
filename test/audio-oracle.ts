/* eslint-disable */
// @ts-nocheck
/**
 * Differential-test ORACLE for the omosuen-audio WASM port.
 *
 * This is a faithful, runnable extraction of the WSOLA DSP from the AudioWorklet
 * source STRING in src/component/audio-player/audio-stretcher.ts
 * (getWorkletProcessorSource) — i.e. the runtime truth, including
 * `bestCorr = -Infinity` in seekBestOverlapPosition (NOT the stale TS-class copy
 * which used Number.MIN_VALUE). The Rust port is asserted byte-exact against this.
 *
 * `set pitch(p)` takes the pitch RATIO (Math.pow stays JS-side), matching the
 * WASM ABI. Do not "clean up" this file — it must track the string verbatim.
 */

const DEFAULT_OVERLAP_MS = 8;
const SCAN_OFFSETS = [
  [124,186,248,310,372,434,496,558,620,682,744,806,868,930,992,1054,1116,1178,1240,1302,1364,1426,1488,0],
  [-100,-75,-50,-25,25,50,75,100,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  [-20,-15,-10,-5,5,10,15,20,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  [-4,-3,-2,-1,1,2,3,4,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]
];
const AUTOSEQ_TEMPO_LOW = 0.5;
const AUTOSEQ_TEMPO_TOP = 2.0;
const AUTOSEQ_AT_MIN = 125.0;
const AUTOSEQ_AT_MAX = 50.0;
const AUTOSEQ_K = (AUTOSEQ_AT_MAX - AUTOSEQ_AT_MIN) / (AUTOSEQ_TEMPO_TOP - AUTOSEQ_TEMPO_LOW);
const AUTOSEQ_C = AUTOSEQ_AT_MIN - AUTOSEQ_K * AUTOSEQ_TEMPO_LOW;
const AUTOSEEK_AT_MIN = 25.0;
const AUTOSEEK_AT_MAX = 15.0;
const AUTOSEEK_K = (AUTOSEEK_AT_MAX - AUTOSEEK_AT_MIN) / (AUTOSEQ_TEMPO_TOP - AUTOSEQ_TEMPO_LOW);
const AUTOSEEK_C = AUTOSEEK_AT_MIN - AUTOSEEK_K * AUTOSEQ_TEMPO_LOW;

function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }

export class SampleBuffer {
  constructor() {
    this._vector = new Float32Array(0);
    this._position = 0;
    this._frameCount = 0;
  }
  get vector() { return this._vector; }
  get startIndex() { return this._position * 2; }
  get frameCount() { return this._frameCount; }
  get endIndex() { return (this._position + this._frameCount) * 2; }
  clear() { this.receive(this._frameCount); this.rewind(); }
  put(numFrames) { this._frameCount += numFrames; }
  putSamples(samples, position = 0, numFrames) {
    const sourceOffset = position * 2;
    if (numFrames === undefined || numFrames < 0) numFrames = (samples.length - sourceOffset) / 2;
    this.ensureCapacity(numFrames + this._frameCount);
    const destOffset = this.endIndex;
    this._vector.set(samples.subarray(sourceOffset, sourceOffset + numFrames * 2), destOffset);
    this._frameCount += numFrames;
  }
  putBuffer(buffer, position = 0, numFrames) {
    if (numFrames === undefined || numFrames < 0) numFrames = buffer.frameCount - position;
    this.putSamples(buffer.vector, buffer._position + position, numFrames);
  }
  receive(numFrames) {
    if (numFrames === undefined || numFrames < 0 || numFrames > this._frameCount) numFrames = this._frameCount;
    this._frameCount -= numFrames;
    this._position += numFrames;
  }
  receiveSamples(output, numFrames) {
    const sourceOffset = this.startIndex;
    output.set(this._vector.subarray(sourceOffset, sourceOffset + numFrames * 2));
    this.receive(numFrames);
  }
  extract(output, position, numFrames) {
    const sourceOffset = this.startIndex + position * 2;
    output.set(this._vector.subarray(sourceOffset, sourceOffset + numFrames * 2));
  }
  ensureCapacity(numFrames) {
    const minLength = numFrames * 2;
    if (this._vector.length < minLength) {
      const newVector = new Float32Array(minLength);
      newVector.set(this._vector.subarray(this.startIndex, this.endIndex));
      this._vector = newVector;
      this._position = 0;
    } else { this.rewind(); }
  }
  ensureAdditionalCapacity(numFrames) { this.ensureCapacity(this.frameCount + numFrames); }
  rewind() {
    if (this._position > 0) {
      this._vector.set(this._vector.subarray(this.startIndex, this.endIndex));
      this._position = 0;
    }
  }
}

class RateTransposer {
  constructor() {
    this.inputBuffer = new SampleBuffer();
    this.outputBuffer = new SampleBuffer();
    this._rate = 1;
    this.slopeCount = 0;
    this.prevSampleL = 0;
    this.prevSampleR = 0;
  }
  set rate(r) { this._rate = r; }
  clear() {
    this.slopeCount = 0; this.prevSampleL = 0; this.prevSampleR = 0;
    this.inputBuffer.clear(); this.outputBuffer.clear();
  }
  process() {
    const numFrames = this.inputBuffer.frameCount;
    this.outputBuffer.ensureAdditionalCapacity(Math.ceil(numFrames / this._rate) + 1);
    const out = this._transpose(numFrames);
    this.inputBuffer.receive();
    this.outputBuffer.put(out);
  }
  _transpose(numFrames) {
    if (numFrames === 0) return 0;
    const src = this.inputBuffer.vector;
    const srcOff = this.inputBuffer.startIndex;
    const dest = this.outputBuffer.vector;
    const destOff = this.outputBuffer.endIndex;
    let used = 0, i = 0;
    while (this.slopeCount < 1.0) {
      dest[destOff + 2*i] = (1-this.slopeCount)*this.prevSampleL + this.slopeCount*src[srcOff];
      dest[destOff + 2*i+1] = (1-this.slopeCount)*this.prevSampleR + this.slopeCount*src[srcOff+1];
      i++; this.slopeCount += this._rate;
    }
    this.slopeCount -= 1.0;
    if (numFrames !== 1) {
      while (true) {
        while (this.slopeCount > 1.0) { this.slopeCount -= 1.0; used++; }
        if (used >= numFrames - 1) break;
        const si = srcOff + 2*used;
        dest[destOff + 2*i] = (1-this.slopeCount)*src[si] + this.slopeCount*src[si+2];
        dest[destOff + 2*i+1] = (1-this.slopeCount)*src[si+1] + this.slopeCount*src[si+3];
        i++; this.slopeCount += this._rate;
      }
    }
    this.prevSampleL = src[srcOff + 2*numFrames - 2];
    this.prevSampleR = src[srcOff + 2*numFrames - 1];
    return i;
  }
}

class Stretch {
  constructor() {
    this.inputBuffer = new SampleBuffer();
    this.outputBuffer = new SampleBuffer();
    this.sampleRate = 44100;
    this.sequenceMs = 0; this.seekWindowMs = 0;
    this.overlapMs = DEFAULT_OVERLAP_MS;
    this._tempo = 1; this.overlapLength = 0;
    this.seekLength = 0; this.seekWindowLength = 0;
    this.nominalSkip = 0; this.skipFract = 0; this.sampleReq = 0;
    this.pMidBuffer = null;
    this.pRefMidBuffer = new Float32Array(0);
    this.setParameters(44100);
  }
  setParameters(sr) {
    if (sr > 0) this.sampleRate = sr;
    this._calcSeqParameters();
    this._calculateOverlapLength(this.overlapMs);
    this.tempo = this._tempo;
  }
  set tempo(t) {
    this._tempo = t; this._calcSeqParameters();
    this.nominalSkip = this._tempo * (this.seekWindowLength - this.overlapLength);
    this.skipFract = 0;
    const intskip = Math.floor(this.nominalSkip + 0.5);
    this.sampleReq = Math.max(intskip + this.overlapLength, this.seekWindowLength) + this.seekLength;
  }
  clear() { this.pMidBuffer = null; this.inputBuffer.clear(); this.outputBuffer.clear(); }
  process() {
    if (this.pMidBuffer === null) {
      if (this.inputBuffer.frameCount < this.overlapLength) return;
      this.pMidBuffer = new Float32Array(this.overlapLength * 2);
      this.inputBuffer.receiveSamples(this.pMidBuffer, this.overlapLength);
    }
    let iters = 0;
    while (this.inputBuffer.frameCount >= this.sampleReq && iters < 8) {
      iters++;
      const offset = this._seekBestOverlapPosition();
      this.outputBuffer.ensureAdditionalCapacity(this.overlapLength);
      this._overlapStereo(2 * offset);
      this.outputBuffer.put(this.overlapLength);
      const temp = this.seekWindowLength - 2 * this.overlapLength;
      if (temp > 0) this.outputBuffer.putBuffer(this.inputBuffer, offset + this.overlapLength, temp);
      const start = this.inputBuffer.startIndex + 2 * (offset + this.seekWindowLength - this.overlapLength);
      this.pMidBuffer.set(this.inputBuffer.vector.subarray(start, start + 2 * this.overlapLength));
      this.skipFract += this.nominalSkip;
      const ovlSkip = Math.floor(this.skipFract);
      this.skipFract -= ovlSkip;
      this.inputBuffer.receive(ovlSkip);
    }
  }
  _seekBestOverlapPosition() {
    this._precalcCorrReferenceStereo();
    let bestCorr = -Infinity, bestOffs = 0, corrOffset = 0;
    for (let sc = 0; sc < 4; sc++) {
      let j = 0;
      while (SCAN_OFFSETS[sc][j]) {
        const to = corrOffset + SCAN_OFFSETS[sc][j];
        if (to >= this.seekLength) break;
        const corr = this._calcCrossCorrStereo(2 * to);
        if (corr > bestCorr) { bestCorr = corr; bestOffs = to; }
        j++;
      }
      corrOffset = bestOffs;
    }
    return bestOffs;
  }
  _precalcCorrReferenceStereo() {
    for (let i = 0; i < this.overlapLength; i++) {
      const t = i * (this.overlapLength - i), c = i * 2;
      this.pRefMidBuffer[c] = this.pMidBuffer[c] * t;
      this.pRefMidBuffer[c+1] = this.pMidBuffer[c+1] * t;
    }
  }
  _calcCrossCorrStereo(mixingPos) {
    const mix = this.inputBuffer.vector;
    mixingPos += this.inputBuffer.startIndex;
    let corr = 0;
    for (let i = 2; i < 2 * this.overlapLength; i += 2) {
      const off = i + mixingPos;
      corr += mix[off] * this.pRefMidBuffer[i] + mix[off+1] * this.pRefMidBuffer[i+1];
    }
    return corr;
  }
  _overlapStereo(pInputPos) {
    const pIn = this.inputBuffer.vector;
    pInputPos += this.inputBuffer.startIndex;
    const pOut = this.outputBuffer.vector;
    const pOutPos = this.outputBuffer.endIndex;
    const fScale = 1 / this.overlapLength;
    for (let i = 0; i < this.overlapLength; i++) {
      const fT = (this.overlapLength - i) * fScale, fi = i * fScale, c = 2*i;
      const inO = c + pInputPos, outO = c + pOutPos;
      pOut[outO] = pIn[inO] * fi + this.pMidBuffer[c] * fT;
      pOut[outO+1] = pIn[inO+1] * fi + this.pMidBuffer[c+1] * fT;
    }
  }
  _calculateOverlapLength(ms) {
    let newOvl = (this.sampleRate * ms) / 1000;
    if (newOvl < 16) newOvl = 16;
    newOvl -= newOvl % 8;
    this.overlapLength = newOvl;
    this.pRefMidBuffer = new Float32Array(this.overlapLength * 2);
    this.pMidBuffer = new Float32Array(this.overlapLength * 2);
  }
  _calcSeqParameters() {
    const seq = clamp(AUTOSEQ_C + AUTOSEQ_K * this._tempo, AUTOSEQ_AT_MAX, AUTOSEQ_AT_MIN);
    this.sequenceMs = Math.floor(seq + 0.5);
    const seek = clamp(AUTOSEEK_C + AUTOSEEK_K * this._tempo, AUTOSEEK_AT_MAX, AUTOSEEK_AT_MIN);
    this.seekWindowMs = Math.floor(seek + 0.5);
    this.seekWindowLength = Math.floor((this.sampleRate * this.sequenceMs) / 1000);
    this.seekLength = Math.floor((this.sampleRate * this.seekWindowMs) / 1000);
  }
}

export class AudioStretcher {
  constructor(sr = 44100) {
    this._rateTransposer = new RateTransposer();
    this._stretch = new Stretch();
    this._inputBuffer = new SampleBuffer();
    this._intermediateBuffer = new SampleBuffer();
    this._outputBuffer = new SampleBuffer();
    this.virtualPitch = 1.0; this.virtualTempo = 1.0; this.virtualRate = 1.0;
    this._rate = 0; this._tempo = 0;
    this._stretch.setParameters(sr);
    this._calculateEffective();
  }
  get inputBuffer() { return this._inputBuffer; }
  get outputBuffer() { return this._outputBuffer; }
  set tempo(t) { this.virtualTempo = t; this._calculateEffective(); }
  set pitch(p) { this.virtualPitch = p; this._calculateEffective(); }
  set pitchSemitones(st) { this.pitch = Math.pow(2, st / 12); }
  clear() { this._rateTransposer.clear(); this._stretch.clear(); }
  process() {
    if (this._rate > 1.0) { this._stretch.process(); this._rateTransposer.process(); }
    else { this._rateTransposer.process(); this._stretch.process(); }
  }
  _calculateEffective() {
    const pT = this._tempo, pR = this._rate;
    this._tempo = this.virtualTempo / this.virtualPitch;
    this._rate = this.virtualRate * this.virtualPitch;
    if (Math.abs(this._tempo - pT) > 1e-10) this._stretch.tempo = this._tempo;
    if (Math.abs(this._rate - pR) > 1e-10) this._rateTransposer.rate = this._rate;
    if (this._rate > 1.0) {
      if (this._outputBuffer !== this._rateTransposer.outputBuffer) {
        this._intermediateBuffer.clear();
        this._stretch.inputBuffer = this._inputBuffer;
        this._stretch.outputBuffer = this._intermediateBuffer;
        this._rateTransposer.inputBuffer = this._intermediateBuffer;
        this._rateTransposer.outputBuffer = this._outputBuffer;
      }
    } else {
      if (this._outputBuffer !== this._stretch.outputBuffer) {
        this._intermediateBuffer.clear();
        this._rateTransposer.inputBuffer = this._inputBuffer;
        this._rateTransposer.outputBuffer = this._intermediateBuffer;
        this._stretch.inputBuffer = this._intermediateBuffer;
        this._stretch.outputBuffer = this._outputBuffer;
      }
    }
  }
}

/**
 * Runnable extraction of `StretcherProcessor` (the worklet harness): feed loop,
 * pre-buffer + transition/crossfade/fade-out, output, pending params, position.
 * port/AudioWorkletProcessor I/O is replaced by explicit methods
 * (init/msgPitch/msgTempo/msgRepeat/stop + process(outL, outR)) so it can be
 * driven offline. `process` returns true to continue, false to terminate
 * (ended OR stopped) — matching the JS return. Position is `outputSourcePos`.
 */
export class Processor {
  constructor() {
    this.stretcher = null;
    this.channelL = null;
    this.channelR = null;
    this.sourcePos = 0;
    this.totalFrames = 0;
    this.repeat = false;
    this.ended = false;
    this.initialized = false;
    this.stopped = false;
    this.feedBuffer = null;
    this.extractBuffer = new Float32Array(256);
    this.outputSourcePos = 0;
    this.reverse = false;

    this.preBuffer = null;
    this.transitionBufferFrames = 0;
    this.fadeOutBuffer = null;
    this.fadeOutLen = 0;
    this.fadeOutPos = 0;
    this.transitioning = false;
    this.newAudioArrived = false;
    this.crossfadePos = 0;
    this.crossfadeLen = 0;
    this.pendingPitch = null;
    this.pendingTempo = null;
  }

  get position() { return this.outputSourcePos; }

  init(sampleRate, channelL, channelR, sourcePos, pitchShift, tempo, repeat, transitionBuffer) {
    this.sampleRate = sampleRate;
    this.channelL = channelL;
    this.channelR = channelR;
    this.totalFrames = this.channelL.length;
    this.repeat = repeat;
    this.sourcePos = sourcePos;
    this.stretcher = new AudioStretcher(sampleRate);
    this.stretcher.pitchSemitones = pitchShift;
    this.reverse = tempo < 0;
    this.stretcher.tempo = Math.max(0.05, Math.abs(tempo));
    this.feedBuffer = new Float32Array(16384);
    this.outputSourcePos = sourcePos;
    this.ended = false;
    this.stopped = false;
    if (transitionBuffer > 0) {
      this.transitionBufferFrames = Math.ceil((sampleRate * transitionBuffer) / 1000);
      this.preBuffer = new SampleBuffer();
    }
    this.initialized = true;
  }

  msgPitch(value) {
    if (this.stretcher) {
      if (this.preBuffer) {
        this.pendingPitch = value;
      } else {
        this.sourcePos = Math.round(this.outputSourcePos);
        this.stretcher.pitchSemitones = value;
        this.stretcher.clear();
      }
    }
  }

  msgTempo(value) {
    if (this.stretcher) {
      if (this.preBuffer) {
        this.pendingTempo = value;
      } else {
        this.sourcePos = Math.round(this.outputSourcePos);
        this.reverse = value < 0;
        this.stretcher.tempo = Math.max(0.05, Math.abs(value));
        this.stretcher.clear();
      }
    }
  }

  msgRepeat(value) { this.repeat = value; }
  stop() { this.stopped = true; }

  _beginTransition() {
    if (this.preBuffer && this.preBuffer.frameCount > 0) {
      this.fadeOutLen = this.preBuffer.frameCount;
      this.fadeOutBuffer = new Float32Array(this.fadeOutLen * 2);
      this.preBuffer.extract(this.fadeOutBuffer, 0, this.fadeOutLen);
      this.preBuffer.receive(this.fadeOutLen);
      this.fadeOutPos = 0;
      this.transitioning = true;
      this.newAudioArrived = false;
      this.crossfadePos = 0;
      this.crossfadeLen = 0;
    }
  }

  process(outputL, outputR) {
    if (!this.initialized || this.stopped) return !this.stopped;

    const numFrames = outputL.length;

    const skipFeed = this.preBuffer && this.preBuffer.frameCount > this.transitionBufferFrames * 2;
    if (!this.ended && !skipFeed) {
      const effectiveRate = Math.max(0.1, this.stretcher.virtualTempo * this.stretcher.virtualPitch);
      const preDeficit = this.preBuffer ? Math.max(0, this.transitionBufferFrames - this.preBuffer.frameCount) : 0;
      const framesToFeed = Math.min(Math.ceil((numFrames + preDeficit) * effectiveRate) + 128, 16384);

      if (this.feedBuffer.length < framesToFeed * 2) {
        this.feedBuffer = new Float32Array(framesToFeed * 2);
      }

      let fed = 0;
      while (fed < framesToFeed) {
        if (this.reverse) {
          if (this.sourcePos <= 0) {
            if (this.repeat) { this.sourcePos = this.totalFrames; }
            else { this.ended = true; break; }
          }
          const remaining = this.sourcePos;
          const chunk = Math.min(framesToFeed - fed, remaining);
          for (let i = 0; i < chunk; i++) {
            this.feedBuffer[(fed + i) * 2] = this.channelL[this.sourcePos - 1 - i];
            this.feedBuffer[(fed + i) * 2 + 1] = this.channelR[this.sourcePos - 1 - i];
          }
          this.sourcePos -= chunk;
          fed += chunk;
        } else {
          if (this.sourcePos >= this.totalFrames) {
            if (this.repeat) { this.sourcePos = 0; }
            else { this.ended = true; break; }
          }
          const remaining = this.totalFrames - this.sourcePos;
          const chunk = Math.min(framesToFeed - fed, remaining);
          for (let i = 0; i < chunk; i++) {
            this.feedBuffer[(fed + i) * 2] = this.channelL[this.sourcePos + i];
            this.feedBuffer[(fed + i) * 2 + 1] = this.channelR[this.sourcePos + i];
          }
          this.sourcePos += chunk;
          fed += chunk;
        }
      }
      if (fed > 0) this.stretcher.inputBuffer.putSamples(this.feedBuffer, 0, fed);
    }

    this.stretcher.process();

    let outputFrames = 0;

    if (this.preBuffer) {
      const strAvail = this.stretcher.outputBuffer.frameCount;
      if (strAvail > 0) {
        if (this.extractBuffer.length < strAvail * 2) {
          this.extractBuffer = new Float32Array(strAvail * 2);
        }
        this.stretcher.outputBuffer.extract(this.extractBuffer, 0, strAvail);
        this.stretcher.outputBuffer.receive(strAvail);
        this.preBuffer.putSamples(this.extractBuffer, 0, strAvail);
      }

      if (this.transitioning) {
        let written = 0;

        while (written < numFrames && this.transitioning) {
          const hasOld = this.fadeOutPos < this.fadeOutLen;
          const hasNew = this.preBuffer.frameCount > 0;

          if (!this.newAudioArrived) {
            if (hasNew) {
              this.newAudioArrived = true;
              const remainingOld = this.fadeOutLen - this.fadeOutPos;
              this.crossfadeLen = Math.min(remainingOld, 2048);
              this.crossfadePos = 0;
            } else if (hasOld) {
              const n = Math.min(numFrames - written, this.fadeOutLen - this.fadeOutPos);
              for (let i = 0; i < n; i++) {
                const idx = (this.fadeOutPos + i) * 2;
                outputL[written + i] = this.fadeOutBuffer[idx];
                outputR[written + i] = this.fadeOutBuffer[idx + 1];
              }
              this.fadeOutPos += n;
              written += n;
              break;
            } else {
              this.transitioning = false;
              break;
            }
          }

          if (this.newAudioArrived && this.transitioning) {
            if (hasOld && this.crossfadePos < this.crossfadeLen && hasNew) {
              const n = Math.min(
                numFrames - written,
                this.crossfadeLen - this.crossfadePos,
                this.fadeOutLen - this.fadeOutPos,
                this.preBuffer.frameCount
              );
              if (n <= 0) break;

              if (this.extractBuffer.length < n * 2) {
                this.extractBuffer = new Float32Array(n * 2);
              }
              this.preBuffer.extract(this.extractBuffer, 0, n);
              this.preBuffer.receive(n);

              for (let i = 0; i < n; i++) {
                const t = (this.crossfadePos + i) / this.crossfadeLen;
                const oldIdx = (this.fadeOutPos + i) * 2;
                outputL[written + i] = this.fadeOutBuffer[oldIdx] * (1 - t) + this.extractBuffer[i * 2] * t;
                outputR[written + i] = this.fadeOutBuffer[oldIdx + 1] * (1 - t) + this.extractBuffer[i * 2 + 1] * t;
              }
              this.fadeOutPos += n;
              this.crossfadePos += n;
              written += n;
            } else {
              this.transitioning = false;
            }
          }
        }

        if (!this.transitioning && written < numFrames) {
          const n = Math.min(numFrames - written, this.preBuffer.frameCount);
          if (n > 0) {
            if (this.extractBuffer.length < n * 2) this.extractBuffer = new Float32Array(n * 2);
            this.preBuffer.extract(this.extractBuffer, 0, n);
            this.preBuffer.receive(n);
            for (let i = 0; i < n; i++) {
              outputL[written + i] = this.extractBuffer[i * 2];
              outputR[written + i] = this.extractBuffer[i * 2 + 1];
            }
            written += n;
          }
        }

        for (let i = written; i < numFrames; i++) { outputL[i] = 0; outputR[i] = 0; }
        outputFrames = written;
      } else {
        const avail = this.preBuffer.frameCount;
        const toPull = Math.min(numFrames, avail);
        if (toPull > 0) {
          if (this.extractBuffer.length < toPull * 2) this.extractBuffer = new Float32Array(toPull * 2);
          this.preBuffer.extract(this.extractBuffer, 0, toPull);
          this.preBuffer.receive(toPull);
          for (let i = 0; i < toPull; i++) {
            outputL[i] = this.extractBuffer[i * 2];
            outputR[i] = this.extractBuffer[i * 2 + 1];
          }
        }
        for (let i = toPull; i < numFrames; i++) { outputL[i] = 0; outputR[i] = 0; }
        outputFrames = toPull;
      }
    } else {
      const available = this.stretcher.outputBuffer.frameCount;
      const toPull = Math.min(numFrames, available);
      if (toPull > 0) {
        if (this.extractBuffer.length < toPull * 2) this.extractBuffer = new Float32Array(toPull * 2);
        this.stretcher.outputBuffer.extract(this.extractBuffer, 0, toPull);
        this.stretcher.outputBuffer.receive(toPull);
        for (let i = 0; i < toPull; i++) {
          outputL[i] = this.extractBuffer[i * 2];
          outputR[i] = this.extractBuffer[i * 2 + 1];
        }
      }
      for (let i = toPull; i < numFrames; i++) { outputL[i] = 0; outputR[i] = 0; }
      outputFrames = toPull;
    }

    for (let i = 0; i < numFrames; i++) {
      if (!(outputL[i] >= -1 && outputL[i] <= 1)) outputL[i] = 0;
      if (!(outputR[i] >= -1 && outputR[i] <= 1)) outputR[i] = 0;
    }

    if (this.preBuffer && !this.transitioning) {
      const hasPending = this.pendingPitch !== null || this.pendingTempo !== null;
      if (hasPending && this.preBuffer.frameCount >= this.transitionBufferFrames / 2) {
        this._beginTransition();
        this.sourcePos = Math.round(this.outputSourcePos);
        if (this.pendingPitch !== null) {
          this.stretcher.pitchSemitones = this.pendingPitch;
          this.pendingPitch = null;
        }
        if (this.pendingTempo !== null) {
          this.reverse = this.pendingTempo < 0;
          this.stretcher.tempo = Math.max(0.05, Math.abs(this.pendingTempo));
          this.pendingTempo = null;
        }
        this.stretcher.clear();
      }
    }

    if (outputFrames > 0) {
      if (this.reverse) {
        this.outputSourcePos -= outputFrames * this.stretcher.virtualTempo;
        if (this.repeat && this.outputSourcePos < 0) {
          this.outputSourcePos = this.totalFrames + (this.outputSourcePos % this.totalFrames);
        }
      } else {
        this.outputSourcePos += outputFrames * this.stretcher.virtualTempo;
        if (this.repeat && this.outputSourcePos >= this.totalFrames) {
          this.outputSourcePos %= this.totalFrames;
        }
      }
    }

    const stretcherEmpty = this.stretcher.outputBuffer.frameCount === 0;
    const preEmpty = !this.preBuffer || this.preBuffer.frameCount === 0;
    if (this.ended && stretcherEmpty && preEmpty) {
      return false;
    }

    return true;
  }
}
