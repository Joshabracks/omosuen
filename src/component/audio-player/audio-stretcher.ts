/**
 * Minimal WSOLA (Waveform Similarity Overlap-Add) implementation for
 * independent pitch shifting and time stretching of interleaved stereo audio.
 *
 * Based on the algorithms in SoundTouch (Olli Parviainen, LGPL) and
 * SoX tempo.c. Stripped to essential DSP code only.
 *
 * Key idea: time-stretching (Stretch) changes tempo without pitch,
 * resampling (RateTransposer) changes pitch+speed together.
 * The orchestrator (AudioStretcher) combines them so that setting
 * `pitch` compensates tempo to keep speed constant, and setting
 * `tempo` changes speed without affecting pitch.
 */

// ── Constants ──

const DEFAULT_OVERLAP_MS = 8;

/** Hierarchical scan offsets for quick cross-correlation seeking. */
const SCAN_OFFSETS: number[][] = [
  [
    124, 186, 248, 310, 372, 434, 496, 558, 620, 682, 744, 806, 868, 930, 992,
    1054, 1116, 1178, 1240, 1302, 1364, 1426, 1488, 0,
  ],
  [
    -100, -75, -50, -25, 25, 50, 75, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0,
  ],
  [
    -20, -15, -10, -5, 5, 10, 15, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0,
  ],
  [
    -4, -3, -2, -1, 1, 2, 3, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0,
  ],
];

// Auto sequence/seek parameters keyed to tempo range 0.5 – 2.0
const AUTOSEQ_TEMPO_LOW = 0.5;
const AUTOSEQ_TEMPO_TOP = 2.0;
const AUTOSEQ_AT_MIN = 125.0;
const AUTOSEQ_AT_MAX = 50.0;
const AUTOSEQ_K =
  (AUTOSEQ_AT_MAX - AUTOSEQ_AT_MIN) / (AUTOSEQ_TEMPO_TOP - AUTOSEQ_TEMPO_LOW);
const AUTOSEQ_C = AUTOSEQ_AT_MIN - AUTOSEQ_K * AUTOSEQ_TEMPO_LOW;

const AUTOSEEK_AT_MIN = 25.0;
const AUTOSEEK_AT_MAX = 15.0;
const AUTOSEEK_K =
  (AUTOSEEK_AT_MAX - AUTOSEEK_AT_MIN) /
  (AUTOSEQ_TEMPO_TOP - AUTOSEQ_TEMPO_LOW);
const AUTOSEEK_C = AUTOSEEK_AT_MIN - AUTOSEEK_K * AUTOSEQ_TEMPO_LOW;

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

// ── SampleBuffer ──

export class SampleBuffer {
  private _vector = new Float32Array(0);
  private _position = 0;
  private _frameCount = 0;

  get vector(): Float32Array {
    return this._vector;
  }
  get startIndex(): number {
    return this._position * 2;
  }
  get frameCount(): number {
    return this._frameCount;
  }
  get endIndex(): number {
    return (this._position + this._frameCount) * 2;
  }

  clear(): void {
    this.receive(this._frameCount);
    this.rewind();
  }

  put(numFrames: number): void {
    this._frameCount += numFrames;
  }

  putSamples(
    samples: Float32Array,
    position: number = 0,
    numFrames?: number,
  ): void {
    const sourceOffset = position * 2;
    if (numFrames === undefined || numFrames < 0) {
      numFrames = (samples.length - sourceOffset) / 2;
    }
    this.ensureCapacity(numFrames + this._frameCount);
    const destOffset = this.endIndex;
    this._vector.set(
      samples.subarray(sourceOffset, sourceOffset + numFrames * 2),
      destOffset,
    );
    this._frameCount += numFrames;
  }

  putBuffer(
    buffer: SampleBuffer,
    position: number = 0,
    numFrames?: number,
  ): void {
    if (numFrames === undefined || numFrames < 0) {
      numFrames = buffer.frameCount - position;
    }
    this.putSamples(buffer.vector, buffer._position + position, numFrames);
  }

  receive(numFrames?: number): void {
    if (numFrames === undefined || numFrames < 0 || numFrames > this._frameCount) {
      numFrames = this._frameCount;
    }
    this._frameCount -= numFrames;
    this._position += numFrames;
  }

  receiveSamples(output: Float32Array, numFrames: number): void {
    const sourceOffset = this.startIndex;
    output.set(
      this._vector.subarray(sourceOffset, sourceOffset + numFrames * 2),
    );
    this.receive(numFrames);
  }

  extract(
    output: Float32Array,
    position: number,
    numFrames: number,
  ): void {
    const sourceOffset = this.startIndex + position * 2;
    output.set(
      this._vector.subarray(sourceOffset, sourceOffset + numFrames * 2),
    );
  }

  ensureCapacity(numFrames: number): void {
    const minLength = numFrames * 2;
    if (this._vector.length < minLength) {
      const newVector = new Float32Array(minLength);
      newVector.set(this._vector.subarray(this.startIndex, this.endIndex));
      this._vector = newVector;
      this._position = 0;
    } else {
      this.rewind();
    }
  }

  ensureAdditionalCapacity(numFrames: number): void {
    this.ensureCapacity(this.frameCount + numFrames);
  }

  rewind(): void {
    if (this._position > 0) {
      this._vector.set(this._vector.subarray(this.startIndex, this.endIndex));
      this._position = 0;
    }
  }
}

// ── RateTransposer ──

class RateTransposer {
  inputBuffer: SampleBuffer;
  outputBuffer: SampleBuffer;
  private _rate = 1;
  private slopeCount = 0;
  private prevSampleL = 0;
  private prevSampleR = 0;

  constructor() {
    this.inputBuffer = new SampleBuffer();
    this.outputBuffer = new SampleBuffer();
  }

  set rate(r: number) {
    this._rate = r;
  }

  clear(): void {
    this.slopeCount = 0;
    this.prevSampleL = 0;
    this.prevSampleR = 0;
    this.inputBuffer.clear();
    this.outputBuffer.clear();
  }

  process(): void {
    const numFrames = this.inputBuffer.frameCount;
    this.outputBuffer.ensureAdditionalCapacity(
      Math.ceil(numFrames / this._rate) + 1,
    );
    const numFramesOutput = this.transpose(numFrames);
    this.inputBuffer.receive();
    this.outputBuffer.put(numFramesOutput);
  }

  private transpose(numFrames: number): number {
    if (numFrames === 0) return 0;

    const src = this.inputBuffer.vector;
    const srcOffset = this.inputBuffer.startIndex;
    const dest = this.outputBuffer.vector;
    const destOffset = this.outputBuffer.endIndex;
    let used = 0;
    let i = 0;

    while (this.slopeCount < 1.0) {
      dest[destOffset + 2 * i] =
        (1.0 - this.slopeCount) * this.prevSampleL +
        this.slopeCount * src[srcOffset];
      dest[destOffset + 2 * i + 1] =
        (1.0 - this.slopeCount) * this.prevSampleR +
        this.slopeCount * src[srcOffset + 1];
      i++;
      this.slopeCount += this._rate;
    }
    this.slopeCount -= 1.0;

    if (numFrames !== 1) {
      while (true) {
        while (this.slopeCount > 1.0) {
          this.slopeCount -= 1.0;
          used++;
        }
        if (used >= numFrames - 1) break;
        const srcIndex = srcOffset + 2 * used;
        dest[destOffset + 2 * i] =
          (1.0 - this.slopeCount) * src[srcIndex] +
          this.slopeCount * src[srcIndex + 2];
        dest[destOffset + 2 * i + 1] =
          (1.0 - this.slopeCount) * src[srcIndex + 1] +
          this.slopeCount * src[srcIndex + 3];
        i++;
        this.slopeCount += this._rate;
      }
    }

    this.prevSampleL = src[srcOffset + 2 * numFrames - 2];
    this.prevSampleR = src[srcOffset + 2 * numFrames - 1];
    return i;
  }
}

// ── Stretch ──

class Stretch {
  inputBuffer: SampleBuffer;
  outputBuffer: SampleBuffer;

  private sampleRate = 44100;
  private sequenceMs = 0;
  private seekWindowMs = 0;
  private overlapMs = DEFAULT_OVERLAP_MS;
  private _tempo = 1;
  private overlapLength = 0;
  private seekLength = 0;
  private seekWindowLength = 0;
  private nominalSkip = 0;
  private skipFract = 0;
  private sampleReq = 0;
  private pMidBuffer: Float32Array | null = null;
  private pRefMidBuffer: Float32Array = new Float32Array(0);

  constructor() {
    this.inputBuffer = new SampleBuffer();
    this.outputBuffer = new SampleBuffer();
    this.setParameters(44100);
  }

  setParameters(sampleRate: number): void {
    if (sampleRate > 0) this.sampleRate = sampleRate;
    this.calcSeqParameters();
    this.calculateOverlapLength(this.overlapMs);
    this.tempo = this._tempo;
  }

  set tempo(newTempo: number) {
    this._tempo = newTempo;
    this.calcSeqParameters();
    this.nominalSkip =
      this._tempo * (this.seekWindowLength - this.overlapLength);
    this.skipFract = 0;
    const intskip = Math.floor(this.nominalSkip + 0.5);
    this.sampleReq =
      Math.max(intskip + this.overlapLength, this.seekWindowLength) +
      this.seekLength;
  }

  clear(): void {
    this.pMidBuffer = null;
    this.inputBuffer.clear();
    this.outputBuffer.clear();
  }

  process(): void {
    if (this.pMidBuffer === null) {
      if (this.inputBuffer.frameCount < this.overlapLength) return;
      this.pMidBuffer = new Float32Array(this.overlapLength * 2);
      this.inputBuffer.receiveSamples(this.pMidBuffer, this.overlapLength);
    }

    while (this.inputBuffer.frameCount >= this.sampleReq) {
      const offset = this.seekBestOverlapPosition();

      this.outputBuffer.ensureAdditionalCapacity(this.overlapLength);
      this.overlapStereo(2 * offset);
      this.outputBuffer.put(this.overlapLength);

      const temp = this.seekWindowLength - 2 * this.overlapLength;
      if (temp > 0) {
        this.outputBuffer.putBuffer(
          this.inputBuffer,
          offset + this.overlapLength,
          temp,
        );
      }

      const start =
        this.inputBuffer.startIndex +
        2 * (offset + this.seekWindowLength - this.overlapLength);
      this.pMidBuffer.set(
        this.inputBuffer.vector.subarray(
          start,
          start + 2 * this.overlapLength,
        ),
      );

      this.skipFract += this.nominalSkip;
      const ovlSkip = Math.floor(this.skipFract);
      this.skipFract -= ovlSkip;
      this.inputBuffer.receive(ovlSkip);
    }
  }

  // Hierarchical quick-seek for best overlap position
  private seekBestOverlapPosition(): number {
    this.precalcCorrReferenceStereo();
    let bestCorr = Number.MIN_VALUE;
    let bestOffs = 0;
    let corrOffset = 0;

    for (let scanCount = 0; scanCount < 4; scanCount++) {
      let j = 0;
      while (SCAN_OFFSETS[scanCount][j]) {
        const tempOffset = corrOffset + SCAN_OFFSETS[scanCount][j];
        if (tempOffset >= this.seekLength) break;
        const corr = this.calcCrossCorrStereo(2 * tempOffset);
        if (corr > bestCorr) {
          bestCorr = corr;
          bestOffs = tempOffset;
        }
        j++;
      }
      corrOffset = bestOffs;
    }
    return bestOffs;
  }

  private precalcCorrReferenceStereo(): void {
    for (let i = 0; i < this.overlapLength; i++) {
      const temp = i * (this.overlapLength - i);
      const cnt2 = i * 2;
      this.pRefMidBuffer[cnt2] = this.pMidBuffer![cnt2] * temp;
      this.pRefMidBuffer[cnt2 + 1] = this.pMidBuffer![cnt2 + 1] * temp;
    }
  }

  private calcCrossCorrStereo(mixingPos: number): number {
    const mixing = this.inputBuffer.vector;
    mixingPos += this.inputBuffer.startIndex;
    let corr = 0;
    for (let i = 2; i < 2 * this.overlapLength; i += 2) {
      const offset = i + mixingPos;
      corr +=
        mixing[offset] * this.pRefMidBuffer[i] +
        mixing[offset + 1] * this.pRefMidBuffer[i + 1];
    }
    return corr;
  }

  private overlapStereo(pInputPos: number): void {
    const pInput = this.inputBuffer.vector;
    pInputPos += this.inputBuffer.startIndex;
    const pOutput = this.outputBuffer.vector;
    const pOutputPos = this.outputBuffer.endIndex;
    const fScale = 1 / this.overlapLength;

    for (let i = 0; i < this.overlapLength; i++) {
      const fTemp = (this.overlapLength - i) * fScale;
      const fi = i * fScale;
      const cnt2 = 2 * i;
      const inOff = cnt2 + pInputPos;
      const outOff = cnt2 + pOutputPos;
      pOutput[outOff] =
        pInput[inOff] * fi + this.pMidBuffer![cnt2] * fTemp;
      pOutput[outOff + 1] =
        pInput[inOff + 1] * fi + this.pMidBuffer![cnt2 + 1] * fTemp;
    }
  }

  private calculateOverlapLength(overlapInMsec: number): void {
    let newOvl = (this.sampleRate * overlapInMsec) / 1000;
    if (newOvl < 16) newOvl = 16;
    newOvl -= newOvl % 8;
    this.overlapLength = newOvl;
    this.pRefMidBuffer = new Float32Array(this.overlapLength * 2);
    this.pMidBuffer = new Float32Array(this.overlapLength * 2);
  }

  private calcSeqParameters(): void {
    const seq = clamp(
      AUTOSEQ_C + AUTOSEQ_K * this._tempo,
      AUTOSEQ_AT_MAX,
      AUTOSEQ_AT_MIN,
    );
    this.sequenceMs = Math.floor(seq + 0.5);

    const seek = clamp(
      AUTOSEEK_C + AUTOSEEK_K * this._tempo,
      AUTOSEEK_AT_MAX,
      AUTOSEEK_AT_MIN,
    );
    this.seekWindowMs = Math.floor(seek + 0.5);

    this.seekWindowLength = Math.floor(
      (this.sampleRate * this.sequenceMs) / 1000,
    );
    this.seekLength = Math.floor(
      (this.sampleRate * this.seekWindowMs) / 1000,
    );
  }
}

// ── AudioStretcher ──

/**
 * Combines time-stretching (Stretch) and resampling (RateTransposer)
 * to provide independent pitch and tempo control.
 *
 * - `tempo` changes playback speed without affecting pitch.
 * - `pitch` / `pitchSemitones` changes pitch without affecting speed.
 *
 * Feed interleaved stereo samples into `inputBuffer`, call `process()`,
 * then read results from `outputBuffer`.
 */
export class AudioStretcher {
  private rateTransposer = new RateTransposer();
  private stretch = new Stretch();

  private _inputBuffer = new SampleBuffer();
  private _intermediateBuffer = new SampleBuffer();
  private _outputBuffer = new SampleBuffer();

  virtualPitch = 1.0;
  virtualTempo = 1.0;
  virtualRate = 1.0;

  private _rate = 0;
  private _tempo = 0;

  constructor(sampleRate: number = 44100) {
    this.stretch.setParameters(sampleRate);
    this._calculateEffective();
  }

  get inputBuffer(): SampleBuffer {
    return this._inputBuffer;
  }

  get outputBuffer(): SampleBuffer {
    return this._outputBuffer;
  }

  set tempo(t: number) {
    this.virtualTempo = t;
    this._calculateEffective();
  }

  set pitch(p: number) {
    this.virtualPitch = p;
    this._calculateEffective();
  }

  set pitchSemitones(semitones: number) {
    this.pitch = Math.pow(2, semitones / 12);
  }

  clear(): void {
    this.rateTransposer.clear();
    this.stretch.clear();
  }

  process(): void {
    if (this._rate > 1.0) {
      this.stretch.process();
      this.rateTransposer.process();
    } else {
      this.rateTransposer.process();
      this.stretch.process();
    }
  }

  private _calculateEffective(): void {
    const prevTempo = this._tempo;
    const prevRate = this._rate;

    this._tempo = this.virtualTempo / this.virtualPitch;
    this._rate = this.virtualRate * this.virtualPitch;

    if (Math.abs(this._tempo - prevTempo) > 1e-10) {
      this.stretch.tempo = this._tempo;
    }
    if (Math.abs(this._rate - prevRate) > 1e-10) {
      this.rateTransposer.rate = this._rate;
    }

    if (this._rate > 1.0) {
      if (this._outputBuffer !== this.rateTransposer.outputBuffer) {
        this._intermediateBuffer.clear();
        this.stretch.inputBuffer = this._inputBuffer;
        this.stretch.outputBuffer = this._intermediateBuffer;
        this.rateTransposer.inputBuffer = this._intermediateBuffer;
        this.rateTransposer.outputBuffer = this._outputBuffer;
      }
    } else {
      if (this._outputBuffer !== this.stretch.outputBuffer) {
        this._intermediateBuffer.clear();
        this.rateTransposer.inputBuffer = this._inputBuffer;
        this.rateTransposer.outputBuffer = this._intermediateBuffer;
        this.stretch.inputBuffer = this._intermediateBuffer;
        this.stretch.outputBuffer = this._outputBuffer;
      }
    }
  }
}

// ── AudioWorklet Processor Source ──

/**
 * Returns the full JavaScript source for the stretcher AudioWorkletProcessor.
 * Includes all WSOLA classes (SampleBuffer, RateTransposer, Stretch, AudioStretcher)
 * plus the processor registration. Used via Blob URL + audioWorklet.addModule().
 */
export function getWorkletProcessorSource(): string {
  return `\
// WSOLA Pitch/Speed Separation — AudioWorklet Processor
// Based on SoundTouch (Olli Parviainen, LGPL) and SoX tempo.c

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

class SampleBuffer {
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
    while (this.inputBuffer.frameCount >= this.sampleReq) {
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

class AudioStretcher {
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

class StretcherProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
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
    this.posCounter = 0;
    this.reverse = false;

    this.port.onmessage = (e) => {
      const msg = e.data;
      switch (msg.type) {
        case 'init':
          this.channelL = msg.channelL;
          this.channelR = msg.channelR;
          this.totalFrames = this.channelL.length;
          this.repeat = msg.repeat;
          this.sourcePos = msg.sourcePos;
          this.stretcher = new AudioStretcher(sampleRate);
          this.stretcher.pitchSemitones = msg.pitchShift;
          this.reverse = msg.tempo < 0;
          this.stretcher.tempo = Math.abs(msg.tempo);
          this.feedBuffer = new Float32Array(16384);
          this.outputSourcePos = msg.sourcePos;
          this.ended = false;
          this.stopped = false;
          this.initialized = true;
          break;
        case 'pitch':
          if (this.stretcher) {
            this.stretcher.pitchSemitones = msg.value;
            this.stretcher.outputBuffer.clear();
          }
          break;
        case 'tempo':
          if (this.stretcher) {
            const newReverse = msg.value < 0;
            if (newReverse !== this.reverse) {
              this.reverse = newReverse;
              this.stretcher.clear();
            }
            this.stretcher.tempo = Math.abs(msg.value);
            this.stretcher.outputBuffer.clear();
          }
          break;
        case 'repeat':
          this.repeat = msg.value;
          break;
        case 'stop':
          this.stopped = true;
          break;
      }
    };
  }

  process(inputs, outputs) {
    if (!this.initialized || this.stopped) return !this.stopped;

    const output = outputs[0];
    if (!output || output.length < 2) return true;
    const outputL = output[0];
    const outputR = output[1];
    const numFrames = outputL.length;

    // Feed source samples scaled by effective tempo+pitch to prevent starvation
    if (!this.ended) {
      const effectiveRate = Math.max(1, this.stretcher.virtualTempo * this.stretcher.virtualPitch);
      const framesToFeed = Math.min(Math.ceil(numFrames * effectiveRate) + 128, 8192);

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

    const available = this.stretcher.outputBuffer.frameCount;
    const toPull = Math.min(numFrames, available);

    if (toPull > 0) {
      if (this.extractBuffer.length < toPull * 2) {
        this.extractBuffer = new Float32Array(toPull * 2);
      }
      this.stretcher.outputBuffer.extract(this.extractBuffer, 0, toPull);
      this.stretcher.outputBuffer.receive(toPull);
      for (let i = 0; i < toPull; i++) {
        outputL[i] = this.extractBuffer[i * 2];
        outputR[i] = this.extractBuffer[i * 2 + 1];
      }
    }
    for (let i = toPull; i < numFrames; i++) { outputL[i] = 0; outputR[i] = 0; }

    // Track output-derived source position (accounts for WSOLA pipeline buffering)
    if (toPull > 0) {
      if (this.reverse) {
        this.outputSourcePos -= toPull * this.stretcher.virtualTempo;
        if (this.repeat && this.outputSourcePos < 0) {
          this.outputSourcePos = this.totalFrames + (this.outputSourcePos % this.totalFrames);
        }
      } else {
        this.outputSourcePos += toPull * this.stretcher.virtualTempo;
        if (this.repeat && this.outputSourcePos >= this.totalFrames) {
          this.outputSourcePos %= this.totalFrames;
        }
      }
    }

    // Report position periodically (~every 23ms at 128-frame quantum)
    this.posCounter++;
    if (this.posCounter >= 8) {
      this.posCounter = 0;
      this.port.postMessage({ type: 'position', value: this.outputSourcePos });
    }

    if (this.ended && available === 0) {
      this.port.postMessage({ type: 'ended' });
      return false;
    }

    return true;
  }
}

registerProcessor('stretcher-processor', StretcherProcessor);
`;
}
